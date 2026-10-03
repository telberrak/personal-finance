/**
 * Keeps this device and the sync server in step: pull what other devices changed, then push
 * what changed here (the outbox).
 *
 * Conflicts are resolved per record. A record changed here and not yet pushed is never
 * overwritten by a pulled version; once pushed it becomes the latest. So the last device to
 * push a record wins, and a record is never left half from one device and half from another.
 * Linked records (split pieces, both sides of a transfer) are written together and so travel
 * in the same push.
 */
import { useSyncExternalStore } from 'react';
import { liveQuery } from 'dexie';
import { LIMITS, type PullResponse, type PushResponse } from '../../shared/api.ts';
import { securityMode } from '../db/crypto';
import { db } from '../db/db';
import { isSynced, outboxId } from '../db/outbox';
import type { OutboxEntry, SyncState } from '../db/types';
import { api, SyncApiError } from './client';
import { syncKeys, type SyncedRecord, type SyncKeys } from './keys';

/** Settings that belong to one device and are never synced. */
export const DEVICE_SETTINGS = ['theme', 'lockAfterMinutes', 'hideAmounts', 'lastBackupAt', 'pinHash', 'pinSalt'] as const;

export type SyncPhase = 'off' | 'needsKey' | 'idle' | 'syncing' | 'offline' | 'signedOut' | 'error';
export interface SyncStatus {
  phase: SyncPhase;
  lastSyncAt?: number;
}

let status: SyncStatus = { phase: 'off' };
const listeners = new Set<() => void>();
function setStatus(next: SyncStatus) {
  status = next;
  listeners.forEach((l) => l());
}
export const useSyncStatus = () =>
  useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => status,
  );

const syncedTables = () => db.tables.filter((t) => isSynced(t.name));

let cachedKeys: { b64: string; keys: SyncKeys } | undefined;
async function keysFor(state: SyncState): Promise<SyncKeys> {
  if (cachedKeys && cachedKeys.b64 === state.syncKey) return cachedKeys.keys;
  const keys = await syncKeys(state.syncKey!);
  cachedKeys = { b64: state.syncKey!, keys };
  return keys;
}

function withoutDeviceSettings(value: Record<string, unknown>): Record<string, unknown> {
  const copy = { ...value };
  for (const k of DEVICE_SETTINGS) delete copy[k];
  return copy;
}

async function pull(state: SyncState, keys: SyncKeys): Promise<void> {
  let cursor = state.cursor;
  for (;;) {
    const res = await api<PullResponse>(`/sync/pull?since=${cursor}`, { token: state.token });
    const records = res.changes.flatMap((c) => (c.blob ? [keys.open(c.blob)] : []));
    cursor = res.seq;
    await apply(records, cursor);
    if (!res.more) return;
  }
}

/** Writes pulled records, skipping any with changes here still waiting to be pushed. */
async function apply(records: SyncedRecord[], cursor: number): Promise<void> {
  const known = new Set(syncedTables().map((t) => t.name));
  await db.transaction('rw', [...syncedTables(), db.outbox, db.syncState], async () => {
    const pending = new Set((await db.outbox.toArray()).map((e) => e.id));
    const applied: string[] = [];
    for (const r of records) {
      // A table this version does not know (written by a newer app) is left for later.
      if (!known.has(r.t) || pending.has(outboxId(r.t, r.k))) continue;
      const table = db.table(r.t);
      if (r.v === null) await table.delete(r.k);
      else if (r.t === 'settings') {
        const local = ((await table.get(r.k)) ?? {}) as Record<string, unknown>;
        const keep = Object.fromEntries(DEVICE_SETTINGS.filter((k) => k in local).map((k) => [k, local[k]]));
        await table.put({ ...r.v, ...keep });
      } else await table.put(r.v);
      applied.push(outboxId(r.t, r.k));
    }
    // Writing pulled records queued them for pushing; they came from the server, so unqueue them.
    await db.outbox.bulkDelete(applied);
    await db.syncState.update('sync', { cursor });
  });
}

async function push(state: SyncState, keys: SyncKeys): Promise<void> {
  for (;;) {
    const entries: OutboxEntry[] = await db.outbox.limit(LIMITS.changesPerPush).toArray();
    if (!entries.length) return;
    const changes = await Promise.all(
      entries.map(async (e) => {
        const value = ((await db.table(e.table).get(e.key)) ?? null) as Record<string, unknown> | null;
        const v = value && e.table === 'settings' ? withoutDeviceSettings(value) : value;
        return { rkey: await keys.rkey(e.table, e.key), blob: keys.seal({ t: e.table, k: e.key, v }) };
      }),
    );
    const res = await api<PushResponse>('/sync/push', { body: { changes }, token: state.token });
    await db.transaction('rw', db.outbox, db.syncState, async () => {
      // Entries that changed again during the push stay queued.
      for (const e of entries) if ((await db.outbox.get(e.id))?.at === e.at) await db.outbox.delete(e.id);
      // If nobody else pushed meanwhile, there is nothing new to pull back.
      const current = await db.syncState.get('sync');
      if (current && current.cursor === res.seq - changes.length) await db.syncState.update('sync', { cursor: res.seq });
    });
  }
}

async function syncOnce(): Promise<void> {
  const state = await db.syncState.get('sync');
  if (!state) return setStatus({ phase: 'off' });
  if (!state.token) return setStatus({ phase: 'signedOut', lastSyncAt: state.lastSyncAt });
  if (!state.syncKey) return setStatus({ phase: 'needsKey' });
  setStatus({ phase: 'syncing', lastSyncAt: state.lastSyncAt });
  try {
    const keys = await keysFor(state);
    await pull(state, keys);
    await push((await db.syncState.get('sync'))!, keys);
    const lastSyncAt = Date.now();
    await db.syncState.update('sync', { lastSyncAt });
    setStatus({ phase: 'idle', lastSyncAt });
  } catch (err) {
    if (securityMode() === 'locked') return; // locked mid-sync; it resumes after unlocking
    if (err instanceof SyncApiError && err.status === 401) {
      // Signed out elsewhere (device removed or account deleted): stop, keep the data.
      await db.syncState.update('sync', { token: '' });
      return setStatus({ phase: 'signedOut', lastSyncAt: state.lastSyncAt });
    }
    setStatus({ phase: err instanceof SyncApiError && err.status === 0 ? 'offline' : 'error', lastSyncAt: state.lastSyncAt });
    if (!(err instanceof SyncApiError)) console.error(err);
  }
}

let running: Promise<void> | null = null;
let again = false;

/** Syncs now; if a sync is already running, runs once more after it. */
export function syncNow(): Promise<void> {
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    do {
      again = false;
      await syncOnce();
    } while (again);
  })().finally(() => (running = null));
  return running;
}

/** Queues every record for pushing (first sync from this device). */
export async function queueEverything(): Promise<void> {
  const at = Date.now();
  await db.transaction('rw', [...syncedTables(), db.outbox], async () => {
    for (const table of syncedTables()) {
      const keys = (await table.toCollection().primaryKeys()) as string[];
      await db.outbox.bulkPut(keys.map((k) => ({ id: outboxId(table.name, k), table: table.name, key: String(k), at })));
    }
  });
}

/**
 * Runs sync while the app is unlocked: soon after each change, every minute, and when the
 * app comes back online or into view. Returns a function that stops it.
 */
export function startSync(): () => void {
  let timer: number | undefined;
  const soon = (ms: number) => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => void syncNow(), ms);
  };
  void (async () => {
    // Changes are always recorded; without a sync account they are not needed.
    if (!(await db.syncState.get('sync'))) await db.outbox.clear();
    void syncNow();
  })().catch(() => undefined);
  const sub = liveQuery(() => db.outbox.count()).subscribe({
    next: (n) => {
      if (n > 0 && status.phase !== 'off') soon(1500);
    },
    error: () => undefined,
  });
  const interval = window.setInterval(() => void syncNow(), 60_000);
  const wake = () => document.visibilityState === 'visible' && soon(200);
  window.addEventListener('online', wake);
  document.addEventListener('visibilitychange', wake);
  return () => {
    window.clearTimeout(timer);
    window.clearInterval(interval);
    sub.unsubscribe();
    window.removeEventListener('online', wake);
    document.removeEventListener('visibilitychange', wake);
  };
}

/** For tests. */
export const resetSyncEngine = () => {
  cachedKeys = undefined;
  setStatus({ phase: 'off' });
};
