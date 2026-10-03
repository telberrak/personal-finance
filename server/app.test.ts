// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Me, PullResponse, Session } from '../shared/api.ts';
import { createApp } from './app.ts';
import { openPglite, type Sql } from './db.ts';
import type { Mailer } from './mailer.ts';

let sql: Sql;
let app: ReturnType<typeof createApp>;
const sent: { email: string; code: string }[] = [];
const mailer: Mailer = { sendCode: async (email, code) => void sent.push({ email, code }) };

// One in-memory database for the file (starting PGlite takes a moment); emptied before each test.
beforeAll(async () => {
  sql = await openPglite();
});
afterAll(() => sql?.close());
beforeEach(async () => {
  sent.length = 0;
  await sql.query('TRUNCATE users, email_codes, challenges CASCADE');
  app = createApp({ sql, mailer, config: { rpID: 'localhost', rpName: 'Ledger', origins: ['http://localhost:5173'] } });
});

/** Responses whose JSON is typed by the variable it is assigned to (tests only). */
type TestResponse = Omit<Response, 'json'> & { json(): Promise<never> };

async function call(method: string, path: string, body?: unknown, token?: string): Promise<TestResponse> {
  return (await app.request(`/api${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })) as TestResponse;
}

async function signIn(email = 'Sam@Example.com', deviceName = 'Laptop'): Promise<Session> {
  expect((await call('POST', '/auth/email/start', { email })).status).toBe(200);
  const { code } = sent.at(-1)!;
  const res = await call('POST', '/auth/email/verify', { email, code, deviceName });
  expect(res.status).toBe(200);
  return res.json();
}

describe('email sign-in', () => {
  it('signs in with the emailed code and creates the account once', async () => {
    const first = await signIn();
    expect(first.user.email).toBe('sam@example.com');
    const second = await signIn('sam@example.com', 'Phone');
    expect(second.user.id).toBe(first.user.id);
    const me: Me = await (await call('GET', '/me', undefined, second.token)).json();
    expect(me.devices.map((d) => [d.name, d.current])).toEqual(
      expect.arrayContaining([
        ['Laptop', false],
        ['Phone', true],
      ]),
    );
  });

  it('rejects wrong codes and locks the code after five tries', async () => {
    await call('POST', '/auth/email/start', { email: 'a@b.co' });
    const { code } = sent[0];
    const wrong = code === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++) expect((await call('POST', '/auth/email/verify', { email: 'a@b.co', code: wrong })).status).toBe(401);
    expect((await call('POST', '/auth/email/verify', { email: 'a@b.co', code })).status).toBe(401);
  });

  it('rejects bad email addresses and limits how often codes are sent', async () => {
    expect((await call('POST', '/auth/email/start', { email: 'nope' })).status).toBe(400);
    for (let i = 0; i < 5; i++) await call('POST', '/auth/email/start', { email: 'x@y.co' });
    expect((await call('POST', '/auth/email/start', { email: 'x@y.co' })).status).toBe(429);
  });
});

describe('sessions and devices', () => {
  it('needs a valid session and can sign a device out remotely', async () => {
    expect((await call('GET', '/me')).status).toBe(401);
    expect((await call('GET', '/me', undefined, 'forged')).status).toBe(401);
    const laptop = await signIn('s@e.co', 'Laptop');
    const phone = await signIn('s@e.co', 'Phone');
    expect((await call('DELETE', `/devices/${phone.deviceId}`, undefined, laptop.token)).status).toBe(200);
    expect((await call('GET', '/me', undefined, phone.token)).status).toBe(401);
    expect((await call('POST', '/auth/logout', undefined, laptop.token)).status).toBe(200);
    expect((await call('GET', '/me', undefined, laptop.token)).status).toBe(401);
  });

  it('cannot touch another account’s devices', async () => {
    const a = await signIn('a@e.co');
    const b = await signIn('b@e.co');
    expect((await call('DELETE', `/devices/${b.deviceId}`, undefined, a.token)).status).toBe(404);
  });

  it('deleting the account removes everything', async () => {
    const s = await signIn();
    await call('PUT', '/vault', { envelope: 'x' }, s.token);
    await call('POST', '/sync/push', { changes: [{ rkey: 'a'.repeat(43), blob: 'cipher' }] }, s.token);
    expect((await call('DELETE', '/account', undefined, s.token)).status).toBe(200);
    for (const table of ['users', 'sessions', 'vaults', 'records']) expect(await sql.query(`SELECT 1 FROM ${table}`)).toHaveLength(0);
  });
});

describe('vault and sync', () => {
  it('creates the vault once and replaces it only on request', async () => {
    const s = await signIn();
    expect((await call('GET', '/vault', undefined, s.token)).status).toBe(404);
    expect((await call('PUT', '/vault', { envelope: 'one' }, s.token)).status).toBe(200);
    expect((await call('PUT', '/vault', { envelope: 'two' }, s.token)).status).toBe(409);
    expect((await call('PUT', '/vault?replace=1', { envelope: 'two' }, s.token)).status).toBe(200);
    expect(await (await call('GET', '/vault', undefined, s.token)).json()).toEqual({ envelope: 'two' });
  });

  it('pulls changes in order, the latest version of each record once', async () => {
    const s = await signIn();
    const k = (c: string) => c.repeat(43);
    await call(
      'POST',
      '/sync/push',
      {
        changes: [
          { rkey: k('a'), blob: 'a1' },
          { rkey: k('b'), blob: 'b1' },
        ],
      },
      s.token,
    );
    const { seq } = await (
      await call(
        'POST',
        '/sync/push',
        {
          changes: [
            { rkey: k('a'), blob: 'a2' },
            { rkey: k('c'), blob: null },
          ],
        },
        s.token,
      )
    ).json();
    expect(seq).toBe(4);

    const all: PullResponse = await (await call('GET', '/sync/pull?since=0', undefined, s.token)).json();
    expect(all.changes).toEqual([
      { rkey: k('b'), blob: 'b1', seq: 2 },
      { rkey: k('a'), blob: 'a2', seq: 3 },
      { rkey: k('c'), blob: null, seq: 4 },
    ]);
    const later: PullResponse = await (await call('GET', '/sync/pull?since=3', undefined, s.token)).json();
    expect(later).toEqual({ changes: [{ rkey: k('c'), blob: null, seq: 4 }], seq: 4, more: false });
  });

  it('keeps accounts apart and validates input', async () => {
    const a = await signIn('a@e.co');
    const b = await signIn('b@e.co');
    await call('POST', '/sync/push', { changes: [{ rkey: 'a'.repeat(43), blob: 'secret' }] }, a.token);
    const empty: PullResponse = await (await call('GET', '/sync/pull?since=0', undefined, b.token)).json();
    expect(empty.changes).toEqual([]);
    expect((await call('POST', '/sync/push', { changes: [{ rkey: 'bad key', blob: 'x' }] }, a.token)).status).toBe(400);
    expect((await call('POST', '/sync/push', { changes: 'nope' }, a.token)).status).toBe(400);
    expect((await call('GET', '/sync/pull?since=-1', undefined, a.token)).status).toBe(400);
  });

  it('serialises concurrent pushes so sequence numbers never collide', async () => {
    const s = await signIn();
    await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        call('POST', '/sync/push', { changes: [{ rkey: String(i).repeat(20), blob: `v${i}` }] }, s.token),
      ),
    );
    const { changes }: PullResponse = await (await call('GET', '/sync/pull?since=0', undefined, s.token)).json();
    expect(changes.map((c) => c.seq)).toEqual([1, 2, 3, 4, 5]);
  });
});

it('reports health', async () => {
  expect(await (await call('GET', '/health')).json()).toMatchObject({ ok: true });
});
