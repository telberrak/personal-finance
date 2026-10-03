/**
 * Households: share chosen accounts (with their transactions and bills) with a partner,
 * end-to-end encrypted. Each person keeps their other accounts private.
 *
 * The household key is created on the device and reaches others only inside the invite link's
 * #fragment, which browsers never send to servers. It is kept in your own synced vault, so all
 * your devices have it.
 */
import type { Space } from '../../shared/api.ts';
import { fromB64, randomBytes, toB64 } from '../db/crypto';
import { db } from '../db/db';
import { forgetSpace } from '../db/repo';
import { api, SyncApiError } from './client';
import { syncNow } from './engine';

const b64url = (s: string) => s.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64url = (s: string) => s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4);

async function session() {
  const s = await db.syncState.get('sync');
  if (!s?.token || !s.syncKey) throw new SyncApiError(401, 'signed out');
  return s;
}

export async function listHouseholds(): Promise<Space[]> {
  return api<Space[]>('/spaces', { token: (await session()).token });
}

export async function createHousehold(name: string): Promise<string> {
  const { token } = await session();
  const { id } = await api<{ id: string }>('/spaces', { body: {}, token });
  await db.spaceKeys.put({ id, name: name.trim(), key: toB64(randomBytes(32)), joinedAt: Date.now() });
  return id;
}

/** A one-use link, valid for a week: /join#<household>.<invitation>.<key>.<name> */
export async function inviteLink(spaceId: string): Promise<string> {
  const { token } = await session();
  const space = await db.spaceKeys.get(spaceId);
  if (!space) throw new Error('unknown household');
  const invite = await api<{ token: string }>(`/spaces/${spaceId}/invites`, { body: {}, token });
  return `${window.location.origin}/join#${[spaceId, invite.token, b64url(space.key), encodeURIComponent(space.name)].join('.')}`;
}

export interface Invitation {
  spaceId: string;
  token: string;
  key: string;
  name: string;
}

export function parseInvitation(fragment: string): Invitation | null {
  const [spaceId, token, key, name] = fragment.replace(/^#/, '').split('.');
  if (!spaceId || !token || !key || !/^[0-9a-f-]{36}$/.test(spaceId)) return null;
  try {
    const raw = fromB64url(key);
    if (fromB64(raw).length !== 32) return null;
    return { spaceId, token, key: raw, name: decodeURIComponent(name ?? '') };
  } catch {
    return null;
  }
}

export async function joinHousehold(inv: Invitation): Promise<void> {
  const { token } = await session();
  const { id } = await api<{ id: string }>('/spaces/join', { body: { token: inv.token }, token });
  if (id !== inv.spaceId) throw new Error('mismatched invitation');
  await db.spaceKeys.put({ id, name: inv.name, key: inv.key, joinedAt: Date.now() });
  await syncNow();
}

export async function leaveHousehold(spaceId: string): Promise<void> {
  const s = await session();
  await api(`/spaces/${spaceId}/membership`, { method: 'DELETE', token: s.token }).catch((err) => {
    if (!(err instanceof SyncApiError && err.status === 404)) throw err;
  });
  await forgetSpace(spaceId, s.userId);
}
