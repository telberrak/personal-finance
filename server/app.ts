/**
 * The Ledger sync API. It stores accounts, sessions, passkeys and encrypted records. It never
 * receives keys or readable financial data: records arrive encrypted on the device, and record
 * keys are HMACs, so the server cannot tell which table or record a change belongs to.
 */
import { createHash, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { HTTPException } from 'hono/http-exception';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
} from '@simplewebauthn/server';
import { LIMITS, type Change, type Me, type PullResponse, type PushResponse, type Session } from '../shared/api.ts';
import type { Sql } from './db.ts';
import type { Mailer } from './mailer.ts';
import { RateLimiter } from './rate-limit.ts';

export interface Config {
  /** WebAuthn relying party: the app's host name, e.g. 'ledger.example.com' or 'localhost'. */
  rpID: string;
  rpName: string;
  /** Origins the app is served from, for WebAuthn checks. */
  origins: string[];
  /** Development only: exposes the last emailed code at /api/dev/last-code. */
  dev?: boolean;
  /** Reported by /api/health, e.g. '0.4.0'. */
  version?: string;
  /** 'production', 'staging' or 'development'. */
  environment?: string;
}

const CODE_TTL_MS = 10 * 60_000;
const CODE_ATTEMPTS = 5;
const CHALLENGE_TTL_MS = 5 * 60_000;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RKEY = /^[A-Za-z0-9_-]{16,128}$/;

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const sameHash = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const fail = (status: 400 | 401 | 403 | 404 | 409 | 413 | 429, error: string): never => {
  throw new HTTPException(status, { res: Response.json({ error }, { status }) });
};

type Env = { Variables: { userId: string; sessionId: string } };

export function createApp({ sql, mailer, config }: { sql: Sql; mailer: Mailer; config: Config }) {
  const app = new Hono<Env>().basePath('/api');
  const limiter = new RateLimiter();
  const lastCodes = new Map<string, string>();

  const ip = (c: Context) => c.req.header('fly-client-ip') ?? c.req.header('x-forwarded-for')?.split(',')[0].trim() ?? 'local';
  const limit = (key: string, max: number, windowMs: number) => {
    if (!limiter.take(key, max, windowMs)) fail(429, 'Too many attempts. Wait a few minutes and try again.');
  };

  async function json<T>(c: Context): Promise<T> {
    try {
      return (await c.req.json()) as T;
    } catch {
      return fail(400, 'Expected a JSON body.');
    }
  }

  async function newSession(userId: string, deviceName: unknown): Promise<Omit<Session, 'user'>> {
    const name = typeof deviceName === 'string' && deviceName.trim() ? deviceName.trim().slice(0, LIMITS.deviceNameChars) : 'Device';
    const token = randomBytes(32).toString('base64url');
    const id = randomUUID();
    await sql.query('INSERT INTO sessions (id, user_id, token_hash, device_name) VALUES ($1, $2, $3, $4)', [
      id,
      userId,
      sha256(token),
      name,
    ]);
    return { token, deviceId: id };
  }

  async function sessionFor(userId: string, deviceName: unknown): Promise<Session> {
    const [user] = await sql.query<{ id: string; email: string }>('SELECT id, email FROM users WHERE id = $1', [userId]);
    return { ...(await newSession(userId, deviceName)), user };
  }

  app.onError((err, c) => {
    if (err instanceof HTTPException) return err.getResponse();
    // Never log request bodies: they may hold email addresses or encrypted data.
    console.error(`[${c.req.method} ${c.req.routePath}]`, err instanceof Error ? err.message : 'error');
    return c.json({ error: 'Something went wrong.' }, 500);
  });

  app.use(bodyLimit({ maxSize: 8 * 1024 * 1024, onError: (c) => c.json({ error: 'Too much data in one request.' }, 413) }));

  app.get('/health', async (c) => {
    await sql.query('SELECT 1');
    return c.json({ ok: true, version: config.version ?? 'dev', environment: config.environment ?? 'development' });
  });

  // ------------------------------------------------------------ email sign-in

  app.post('/auth/email/start', async (c) => {
    const { email: raw } = await json<{ email?: string }>(c);
    const email = String(raw ?? '')
      .trim()
      .toLowerCase();
    if (!EMAIL.test(email) || email.length > 254) fail(400, 'Enter a valid email address.');
    limit(`start:ip:${ip(c)}`, 20, 60 * 60_000);
    limit(`start:email:${email}`, 5, 15 * 60_000);
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    await sql.query(
      `INSERT INTO email_codes (email, code_hash, expires_at, attempts) VALUES ($1, $2, $3, 0)
       ON CONFLICT (email) DO UPDATE SET code_hash = excluded.code_hash, expires_at = excluded.expires_at, attempts = 0`,
      [email, sha256(`${email}:${code}`), new Date(Date.now() + CODE_TTL_MS)],
    );
    if (config.dev) lastCodes.set(email, code);
    await mailer.sendCode(email, code);
    return c.json({ ok: true });
  });

  app.post('/auth/email/verify', async (c) => {
    const body = await json<{ email?: string; code?: string; deviceName?: string }>(c);
    const email = String(body.email ?? '')
      .trim()
      .toLowerCase();
    const code = String(body.code ?? '').replace(/\D/g, '');
    limit(`verify:ip:${ip(c)}`, 30, 15 * 60_000);
    const [row] = await sql.query<{ code_hash: string; expires_at: Date; attempts: number }>(
      'SELECT code_hash, expires_at, attempts FROM email_codes WHERE email = $1',
      [email],
    );
    if (!row || new Date(row.expires_at).getTime() < Date.now() || row.attempts >= CODE_ATTEMPTS)
      fail(401, 'That code has expired. Ask for a new one.');
    if (!sameHash(row!.code_hash, sha256(`${email}:${code}`))) {
      await sql.query('UPDATE email_codes SET attempts = attempts + 1 WHERE email = $1', [email]);
      fail(401, 'That code is not right.');
    }
    await sql.query('DELETE FROM email_codes WHERE email = $1', [email]);
    let [user] = await sql.query<{ id: string }>('SELECT id FROM users WHERE email = $1', [email]);
    if (!user)
      [user] = await sql.query<{ id: string }>('INSERT INTO users (id, email) VALUES ($1, $2) RETURNING id', [randomUUID(), email]);
    return c.json(await sessionFor(user.id, body.deviceName));
  });

  if (config.dev) app.get('/dev/last-code', (c) => c.json({ code: lastCodes.get(c.req.query('email') ?? '') ?? null }));

  // ------------------------------------------------------------ passkey sign-in

  async function saveChallenge(challenge: string, userId: string | null): Promise<string> {
    const id = randomUUID();
    await sql.query('DELETE FROM challenges WHERE expires_at < now()');
    await sql.query('INSERT INTO challenges (id, challenge, user_id, expires_at) VALUES ($1, $2, $3, $4)', [
      id,
      challenge,
      userId,
      new Date(Date.now() + CHALLENGE_TTL_MS),
    ]);
    return id;
  }

  async function takeChallenge(id: unknown, userId: string | null): Promise<string> {
    if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/.test(id)) return fail(400, 'Sign-in expired. Try again.');
    const [row] = await sql.query<{ challenge: string; user_id: string | null }>(
      'DELETE FROM challenges WHERE id = $1 AND expires_at > now() RETURNING challenge, user_id',
      [id],
    );
    if (!row || row.user_id !== userId) fail(400, 'Sign-in expired. Try again.');
    return row!.challenge;
  }

  app.post('/auth/passkey/options', async (c) => {
    limit(`passkey:ip:${ip(c)}`, 30, 15 * 60_000);
    const options = await generateAuthenticationOptions({ rpID: config.rpID, userVerification: 'required' });
    return c.json({ options, challengeId: await saveChallenge(options.challenge, null) });
  });

  app.post('/auth/passkey/verify', async (c) => {
    const body = await json<{ challengeId?: string; response?: AuthenticationResponseJSON; deviceName?: string }>(c);
    const challenge = await takeChallenge(body.challengeId, null);
    const response = body.response;
    if (!response?.id) return fail(400, 'Missing passkey response.');
    const [key] = await sql.query<{ id: string; user_id: string; public_key: Uint8Array; counter: string; transports: string[] }>(
      'SELECT id, user_id, public_key, counter, transports FROM passkeys WHERE id = $1',
      [response.id],
    );
    if (!key) return fail(401, 'This passkey is not linked to an account.');
    const result = await verifyAuthenticationResponse({
      response,
      expectedChallenge: challenge,
      expectedOrigin: config.origins,
      expectedRPID: config.rpID,
      credential: { id: key.id, publicKey: new Uint8Array(key.public_key), counter: Number(key.counter), transports: key.transports },
      requireUserVerification: true,
    }).catch(() => fail(401, 'The passkey could not be checked.'));
    if (!result.verified) fail(401, 'The passkey could not be checked.');
    await sql.query('UPDATE passkeys SET counter = $2, last_used_at = now() WHERE id = $1', [key.id, result.authenticationInfo.newCounter]);
    return c.json(await sessionFor(key.user_id, body.deviceName));
  });

  // ------------------------------------------------------------ everything below needs a session

  const authed = new Hono<Env>();
  authed.use(async (c, next) => {
    const token = c.req.header('authorization')?.match(/^Bearer (\S+)$/)?.[1];
    if (!token) return fail(401, 'Sign in again.');
    const [s] = await sql.query<{ id: string; user_id: string }>(
      'UPDATE sessions SET last_seen_at = now() WHERE token_hash = $1 RETURNING id, user_id',
      [sha256(token)],
    );
    if (!s) return fail(401, 'Sign in again.');
    c.set('userId', s.user_id);
    c.set('sessionId', s.id);
    await next();
  });

  authed.get('/me', async (c) => {
    const userId = c.get('userId');
    const [user] = await sql.query<{ id: string; email: string }>('SELECT id, email FROM users WHERE id = $1', [userId]);
    const devices = await sql.query<{ id: string; device_name: string; created_at: Date; last_seen_at: Date }>(
      'SELECT id, device_name, created_at, last_seen_at FROM sessions WHERE user_id = $1 ORDER BY last_seen_at DESC',
      [userId],
    );
    const passkeys = await sql.query<{ id: string; created_at: Date; last_used_at: Date | null }>(
      'SELECT id, created_at, last_used_at FROM passkeys WHERE user_id = $1 ORDER BY created_at',
      [userId],
    );
    const [vault] = await sql.query('SELECT 1 FROM vaults WHERE user_id = $1', [userId]);
    const me: Me = {
      user,
      devices: devices.map((d) => ({
        id: d.id,
        name: d.device_name,
        createdAt: new Date(d.created_at).toISOString(),
        lastSeenAt: new Date(d.last_seen_at).toISOString(),
        current: d.id === c.get('sessionId'),
      })),
      passkeys: passkeys.map((p) => ({
        id: p.id,
        createdAt: new Date(p.created_at).toISOString(),
        lastUsedAt: p.last_used_at ? new Date(p.last_used_at).toISOString() : null,
      })),
      hasVault: !!vault,
    };
    return c.json(me);
  });

  authed.post('/auth/logout', async (c) => {
    await sql.query('DELETE FROM sessions WHERE id = $1', [c.get('sessionId')]);
    return c.json({ ok: true });
  });

  authed.delete('/devices/:id', async (c) => {
    const rows = await sql.query('DELETE FROM sessions WHERE id = $1 AND user_id = $2 RETURNING id', [c.req.param('id'), c.get('userId')]);
    if (!rows.length) fail(404, 'No such device.');
    return c.json({ ok: true });
  });

  /** Deletes the account and everything stored for it. */
  authed.delete('/account', async (c) => {
    await sql.query('DELETE FROM users WHERE id = $1', [c.get('userId')]);
    return c.json({ ok: true });
  });

  authed.post('/passkeys/options', async (c) => {
    const userId = c.get('userId');
    const [user] = await sql.query<{ email: string }>('SELECT email FROM users WHERE id = $1', [userId]);
    const existing = await sql.query<{ id: string; transports: string[] }>('SELECT id, transports FROM passkeys WHERE user_id = $1', [
      userId,
    ]);
    const options = await generateRegistrationOptions({
      rpName: config.rpName,
      rpID: config.rpID,
      userName: user.email,
      userID: new TextEncoder().encode(userId),
      attestationType: 'none',
      excludeCredentials: existing.map((k) => ({ id: k.id, transports: k.transports })),
      authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
    });
    return c.json({ options, challengeId: await saveChallenge(options.challenge, userId) });
  });

  authed.post('/passkeys', async (c) => {
    const userId = c.get('userId');
    const body = await json<{ challengeId?: string; response?: RegistrationResponseJSON }>(c);
    const challenge = await takeChallenge(body.challengeId, userId);
    if (!body.response) return fail(400, 'Missing passkey response.');
    const result = await verifyRegistrationResponse({
      response: body.response,
      expectedChallenge: challenge,
      expectedOrigin: config.origins,
      expectedRPID: config.rpID,
      requireUserVerification: true,
    }).catch(() => fail(400, 'The passkey could not be checked.'));
    if (!result.verified) return fail(400, 'The passkey could not be checked.');
    const { credential } = result.registrationInfo;
    await sql.query('INSERT INTO passkeys (id, user_id, public_key, counter, transports) VALUES ($1, $2, $3, $4, $5)', [
      credential.id,
      userId,
      Buffer.from(credential.publicKey),
      credential.counter,
      credential.transports ?? [],
    ]);
    return c.json({ ok: true });
  });

  authed.delete('/passkeys/:id', async (c) => {
    const rows = await sql.query('DELETE FROM passkeys WHERE id = $1 AND user_id = $2 RETURNING id', [c.req.param('id'), c.get('userId')]);
    if (!rows.length) fail(404, 'No such passkey.');
    return c.json({ ok: true });
  });

  // ------------------------------------------------------------ vault (the encrypted sync key)

  authed.get('/vault', async (c) => {
    const [vault] = await sql.query<{ envelope: string }>('SELECT envelope FROM vaults WHERE user_id = $1', [c.get('userId')]);
    if (!vault) return fail(404, 'No synced data yet.');
    return c.json({ envelope: vault.envelope });
  });

  /** Creates the vault. With ?replace=1 replaces it (a new recovery key for the same sync key). */
  authed.put('/vault', async (c) => {
    const { envelope } = await json<{ envelope?: string }>(c);
    if (typeof envelope !== 'string' || !envelope || envelope.length > LIMITS.envelopeChars) return fail(400, 'Invalid vault.');
    const replace = c.req.query('replace') === '1';
    const rows = await sql.query(
      replace
        ? 'UPDATE vaults SET envelope = $2, updated_at = now() WHERE user_id = $1 RETURNING user_id'
        : 'INSERT INTO vaults (user_id, envelope) VALUES ($1, $2) ON CONFLICT (user_id) DO NOTHING RETURNING user_id',
      [c.get('userId'), envelope],
    );
    if (!rows.length) fail(409, replace ? 'No synced data yet.' : 'This account already has synced data.');
    return c.json({ ok: true });
  });

  // ------------------------------------------------------------ sync

  authed.post('/sync/push', async (c) => {
    const { changes } = await json<{ changes?: Change[] }>(c);
    if (!Array.isArray(changes) || changes.length > LIMITS.changesPerPush) return fail(400, 'Invalid changes.');
    for (const ch of changes) {
      if (typeof ch?.rkey !== 'string' || !RKEY.test(ch.rkey)) fail(400, 'Invalid record key.');
      if (ch.blob !== null && (typeof ch.blob !== 'string' || ch.blob.length > LIMITS.blobChars)) fail(413, 'A record is too large.');
    }
    const userId = c.get('userId');
    const seq = await sql.transaction(async (tx) => {
      // Lock this user's row: pushes for one account run one at a time.
      const [{ seq: start }] = await tx.query<{ seq: string }>('SELECT seq FROM users WHERE id = $1 FOR UPDATE', [userId]);
      let seq = Number(start);
      for (const ch of changes) {
        seq += 1;
        await tx.query(
          `INSERT INTO records (user_id, rkey, seq, blob) VALUES ($1, $2, $3, $4)
           ON CONFLICT (user_id, rkey) DO UPDATE SET seq = excluded.seq, blob = excluded.blob`,
          [userId, ch.rkey, seq, ch.blob],
        );
      }
      await tx.query('UPDATE users SET seq = $2 WHERE id = $1', [userId, seq]);
      return seq;
    });
    const res: PushResponse = { seq };
    return c.json(res);
  });

  authed.get('/sync/pull', async (c) => {
    const since = Number(c.req.query('since') ?? 0);
    if (!Number.isSafeInteger(since) || since < 0) return fail(400, 'Invalid position.');
    const rows = await sql.query<{ rkey: string; seq: string; blob: string | null }>(
      'SELECT rkey, seq, blob FROM records WHERE user_id = $1 AND seq > $2 ORDER BY seq LIMIT $3',
      [c.get('userId'), since, LIMITS.changesPerPull + 1],
    );
    const more = rows.length > LIMITS.changesPerPull;
    const changes = rows.slice(0, LIMITS.changesPerPull).map((r) => ({ rkey: r.rkey, blob: r.blob, seq: Number(r.seq) }));
    const res: PullResponse = { changes, seq: changes.at(-1)?.seq ?? since, more };
    return c.json(res);
  });

  app.route('/', authed);
  app.notFound((c) => c.json({ error: 'Not found.' }, 404));
  return app;
}
