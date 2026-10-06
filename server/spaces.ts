/**
 * Households ("spaces"): shared, end-to-end encrypted record streams. Members push and pull
 * ciphertext exactly like personal sync, under the space's own key, which only members have
 * (it travels in the invite link's #fragment, which browsers never send to servers).
 * The server knows who is in which space, never what they share.
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { LIMITS, type Change, type PullResponse, type Space } from '../shared/api.ts';
import type { Sql } from './db.ts';

const INVITE_TTL_MS = 7 * 86_400_000;
const MAX_MEMBERS = 8;
const RKEY = /^[A-Za-z0-9_-]{16,128}$/;
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const fail = (status: 400 | 403 | 404 | 409, error: string): never => {
  throw new HTTPException(status, { res: Response.json({ error }, { status }) });
};

type Env = { Variables: { userId: string; sessionId: string } };

/**
 * Household (space) routes: create, invite with one-use tokens, join, leave, and a separate encrypted record
 * stream per household.
 */
export function spaceRoutes(authed: Hono<Env>, sql: Sql) {
  async function member(spaceId: string, userId: string) {
    if (!/^[0-9a-f-]{36}$/.test(spaceId)) fail(404, 'No such household.');
    const [row] = await sql.query('SELECT 1 FROM space_members WHERE space_id = $1 AND user_id = $2', [spaceId, userId]);
    if (!row) fail(404, 'No such household.');
  }

  authed.get('/spaces', async (c) => {
    const rows = await sql.query<{ space_id: string; email: string; user_id: string; owner: string }>(
      `SELECT m.space_id, u.email, u.id AS user_id, s.owner_id AS owner
       FROM space_members mine
       JOIN space_members m ON m.space_id = mine.space_id
       JOIN users u ON u.id = m.user_id
       JOIN spaces s ON s.id = m.space_id
       WHERE mine.user_id = $1 ORDER BY m.joined_at`,
      [c.get('userId')],
    );
    const spaces = new Map<string, Space>();
    for (const r of rows) {
      const s = spaces.get(r.space_id) ?? { id: r.space_id, members: [], owner: r.owner === c.get('userId') };
      s.members.push({ email: r.email, you: r.user_id === c.get('userId'), owner: r.user_id === r.owner });
      spaces.set(r.space_id, s);
    }
    return c.json([...spaces.values()]);
  });

  authed.post('/spaces', async (c) => {
    const id = randomUUID();
    await sql.transaction(async (tx) => {
      await tx.query('INSERT INTO spaces (id, owner_id) VALUES ($1, $2)', [id, c.get('userId')]);
      await tx.query('INSERT INTO space_members (space_id, user_id) VALUES ($1, $2)', [id, c.get('userId')]);
    });
    return c.json({ id });
  });

  /** A one-use invitation, valid for a week. The space key is added to the link by the app, not here. */
  authed.post('/spaces/:id/invites', async (c) => {
    const spaceId = c.req.param('id');
    await member(spaceId, c.get('userId'));
    const token = randomBytes(24).toString('base64url');
    await sql.query('INSERT INTO space_invites (token_hash, space_id, expires_at) VALUES ($1, $2, $3)', [
      sha256(token),
      spaceId,
      new Date(Date.now() + INVITE_TTL_MS),
    ]);
    return c.json({ token });
  });

  authed.post('/spaces/join', async (c) => {
    const { token } = (await c.req.json().catch(() => ({}))) as { token?: string };
    if (typeof token !== 'string' || token.length > 100) return fail(400, 'Invalid invitation.');
    const userId = c.get('userId');
    const spaceId = await sql.transaction(async (tx) => {
      const [invite] = await tx.query<{ space_id: string }>(
        'DELETE FROM space_invites WHERE token_hash = $1 AND expires_at > now() RETURNING space_id',
        [sha256(token)],
      );
      if (!invite) return fail(404, 'This invitation has expired or was already used.');
      const [{ n }] = await tx.query<{ n: string }>('SELECT count(*) AS n FROM space_members WHERE space_id = $1', [invite.space_id]);
      if (Number(n) >= MAX_MEMBERS) fail(409, 'This household is full.');
      await tx.query('INSERT INTO space_members (space_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [invite.space_id, userId]);
      return invite.space_id;
    });
    return c.json({ id: spaceId });
  });

  /** Leave a household. When the last member leaves, everything shared in it is deleted. */
  authed.delete('/spaces/:id/membership', async (c) => {
    const spaceId = c.req.param('id');
    await member(spaceId, c.get('userId'));
    await sql.transaction(async (tx) => {
      await tx.query('DELETE FROM space_members WHERE space_id = $1 AND user_id = $2', [spaceId, c.get('userId')]);
      const [{ n }] = await tx.query<{ n: string }>('SELECT count(*) AS n FROM space_members WHERE space_id = $1', [spaceId]);
      if (Number(n) === 0) await tx.query('DELETE FROM spaces WHERE id = $1', [spaceId]);
    });
    return c.json({ ok: true });
  });

  authed.post('/spaces/:id/push', async (c) => {
    const spaceId = c.req.param('id');
    await member(spaceId, c.get('userId'));
    const { changes } = (await c.req.json().catch(() => ({}))) as { changes?: Change[] };
    if (!Array.isArray(changes) || changes.length > LIMITS.changesPerPush) return fail(400, 'Invalid changes.');
    for (const ch of changes) {
      if (typeof ch?.rkey !== 'string' || !RKEY.test(ch.rkey)) fail(400, 'Invalid record key.');
      if (ch.blob !== null && (typeof ch.blob !== 'string' || ch.blob.length > LIMITS.blobChars)) fail(400, 'A record is too large.');
    }
    const seq = await sql.transaction(async (tx) => {
      const [{ seq: start }] = await tx.query<{ seq: string }>('SELECT seq FROM spaces WHERE id = $1 FOR UPDATE', [spaceId]);
      let seq = Number(start);
      for (const ch of changes) {
        seq += 1;
        await tx.query(
          `INSERT INTO space_records (space_id, rkey, seq, blob) VALUES ($1, $2, $3, $4)
           ON CONFLICT (space_id, rkey) DO UPDATE SET seq = excluded.seq, blob = excluded.blob`,
          [spaceId, ch.rkey, seq, ch.blob],
        );
      }
      await tx.query('UPDATE spaces SET seq = $2 WHERE id = $1', [spaceId, seq]);
      return seq;
    });
    return c.json({ seq });
  });

  authed.get('/spaces/:id/pull', async (c) => {
    const spaceId = c.req.param('id');
    await member(spaceId, c.get('userId'));
    const since = Number(c.req.query('since') ?? 0);
    if (!Number.isSafeInteger(since) || since < 0) return fail(400, 'Invalid position.');
    const rows = await sql.query<{ rkey: string; seq: string; blob: string | null }>(
      'SELECT rkey, seq, blob FROM space_records WHERE space_id = $1 AND seq > $2 ORDER BY seq LIMIT $3',
      [spaceId, since, LIMITS.changesPerPull + 1],
    );
    const more = rows.length > LIMITS.changesPerPull;
    const changes = rows.slice(0, LIMITS.changesPerPull).map((r) => ({ rkey: r.rkey, blob: r.blob, seq: Number(r.seq) }));
    const res: PullResponse = { changes, seq: changes.at(-1)?.seq ?? since, more };
    return c.json(res);
  });
}
