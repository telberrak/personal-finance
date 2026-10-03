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
import { LIMITS, type Change, type PullResponse, type PushResponse } from '../../shared/api.ts';
import { securityMode } from '../db/crypto';
import { db } from '../db/db';
import { isSynced, outboxId } from '../db/outbox';
import { forgetSpace } from '../db/repo';
import type { OutboxEntry, SyncState } from '../db/types';
import { api, SyncApiError } from './client';
import { syncKeys, type SyncedRecord, type SyncKeys } from './keys';

/** Settings that belong to one device and are never synced. */
export const DEVICE_SETTINGS = ['theme', 'lockAfterMinutes', 'hideAmounts', 'notifications', 'lastBackupAt', 'pinHash', 'pinSalt'] as const;

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

const keyCache = new Map<string, SyncKeys>();
async function keysOf(b64: string): Promise<SyncKeys> {
  let keys = keyCache.get(b64);
  if (!keys) keyCache.set(b64, (keys = await syncKeys(b64)));
  return keys;
}

/**
 * Where records sync: your own stream (everything), and one stream per household you belong to
 * (only shared accounts, their transactions and bills), each under its own key.
 */
interface Stream {
  /** undefined: your own stream; otherwise the household's id. */
  spaceId?: string;
  keys: SyncKeys;
  base: string;
  cursor: number;
}

/** Tables a household may write to on this device. */
const SHARED_TABLES = new Set(['accounts', 'transactions', 'recurring']);

async function streamsFor(state: SyncState): Promise<Stream[]> {
  const spaces = await db.spaceKeys.toArray();
  return [
    { keys: await keysOf(state.syncKey!), base: '/sync', cursor: state.cursor },
    ...(await Promise.all(
      spaces.map(async (s) => ({
        spaceId: s.id,
        keys: await keysOf(s.key),
        base: `/spaces/${s.id}`,
        cursor: state.spaceCursors?.[s.id] ?? 0,
      })),
    )),
  ];
}

async function saveCursor(stream: Stream, cursor: number) {
  if (!stream.spaceId) return db.syncState.update('sync', { cursor });
  const state = await db.syncState.get('sync');
  return db.syncState.update('sync', { spaceCursors: { ...state?.spaceCursors, [stream.spaceId]: cursor } });
}

function withoutDeviceSettings(value: Record<string, unknown>): Record<string, unknown> {
  const copy = { ...value };
  for (const k of DEVICE_SETTINGS) delete copy[k];
  return copy;
}

async function pull(stream: Stream, token: string): Promise<void> {
  let cursor = stream.cursor;
  for (;;) {
    const res = await api<PullResponse>(`${stream.base}/pull?since=${cursor}`, { token });
    const records = res.changes.flatMap((c) => (c.blob ? [stream.keys.open(c.blob)] : []));
    cursor = res.seq;
    await apply(records, stream, cursor);
    if (!res.more) return;
  }
}

/** Writes pulled records, skipping any with changes here still waiting to be pushed. */
async function apply(records: SyncedRecord[], stream: Stream, cursor: number): Promise<void> {
  const known = new Set(syncedTables().map((t) => t.name));
  await db.transaction('rw', [...syncedTables(), db.outbox, db.syncState], async () => {
    const pending = new Set((await db.outbox.toArray()).map((e) => e.id));
    const applied: string[] = [];
    for (const r of records) {
      // A table this version does not know (written by a newer app) is left for later.
      if (!known.has(r.t) || pending.has(outboxId(r.t, r.k))) continue;
      const table = db.table(r.t);
      if (stream.spaceId) {
        // A household can only touch its own shared records, never your private ones.
        if (!SHARED_TABLES.has(r.t)) continue;
        if (r.v && r.v.spaceId !== stream.spaceId) continue;
        const local = (await table.get(r.k)) as { spaceId?: string } | undefined;
        if (local && local.spaceId !== stream.spaceId) continue;
        if (!r.v && !local) continue;
      }
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
    await saveCursor(stream, cursor);
  });
}

async function push(token: string): Promise<void> {
  for (;;) {
    const batch: OutboxEntry[] = await db.outbox.limit(LIMITS.changesPerPush).toArray();
    if (!batch.length) return;
    // Streams are read after the batch: a household's key is saved before anything is shared
    // with it, so every shared record in this batch finds its household.
    const [own, ...spaces] = await streamsFor((await db.syncState.get('sync'))!);
    // Every record goes to your own stream; shared ones also to their household; deletions to all.
    const sealed = await Promise.all(
      batch.map(async (e) => {
        const value = ((await db.table(e.table).get(e.key)) ?? null) as Record<string, unknown> | null;
        const v = value && e.table === 'settings' ? withoutDeviceSettings(value) : value;
        const targets = [own, ...spaces.filter((s) => (v ? SHARED_TABLES.has(e.table) && v.spaceId === s.spaceId : true))];
        return Promise.all(
          targets.map(async (s) => ({
            stream: s,
            change: { rkey: await s.keys.rkey(e.table, e.key), blob: s.keys.seal({ t: e.table, k: e.key, v }) },
          })),
        );
      }),
    );
    // Large records (attachments) are sent a few at a time, under the server's request limit.
    let size = 0;
    let count = 0;
    for (const parts of sealed) {
      const bytes = parts.reduce((sum, p) => sum + p.change.blob.length, 0);
      if (count > 0 && size + bytes > LIMITS.pushChars) break;
      size += bytes;
      count += 1;
    }
    const entries = batch.slice(0, count);
    const byStream = new Map<Stream, Change[]>();
    for (const parts of sealed.slice(0, count))
      for (const p of parts) byStream.set(p.stream, [...(byStream.get(p.stream) ?? []), p.change]);
    const results = await Promise.all(
      [...byStream].map(async ([stream, changes]) => ({
        stream,
        changes,
        res: await api<PushResponse>(`${stream.base}/push`, { body: { changes }, token }),
      })),
    );
    await db.transaction('rw', db.outbox, db.syncState, async () => {
      // Entries that changed again during the push stay queued.
      for (const e of entries) if ((await db.outbox.get(e.id))?.at === e.at) await db.outbox.delete(e.id);
      // If nobody else pushed meanwhile, there is nothing new to pull back.
      const current = await db.syncState.get('sync');
      for (const { stream, changes, res } of results) {
        const cursor = stream.spaceId ? (current?.spaceCursors?.[stream.spaceId] ?? 0) : current?.cursor;
        if (cursor === res.seq - changes.length) await saveCursor(stream, res.seq);
      }
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
    for (const stream of await streamsFor(state)) {
      try {
        await pull(stream, state.token);
      } catch (err) {
        // Removed from a household (or it was deleted): keep your own accounts, drop the others'.
        if (stream.spaceId && err instanceof SyncApiError && err.status === 404) await forgetSpace(stream.spaceId, state.userId);
        else throw err;
      }
    }
    await push(state.token);
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
  keyCache.clear();
  setStatus({ phase: 'off' });
};
