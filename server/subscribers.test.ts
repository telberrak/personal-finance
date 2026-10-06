// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Session } from '../shared/api.ts';
import { createApp } from './app.ts';
import { openPglite, type Sql } from './db.ts';
import type { ContactList, Mailer, MailMessage } from './mailer.ts';

let sql: Sql;
let app: ReturnType<typeof createApp>;
const codes = new Map<string, string>();
const mail: MailMessage[] = [];
const mirrored: [string, boolean, string][] = [];
const mailer: Mailer = { sendCode: async (email, code) => void codes.set(email, code), send: async (m) => void mail.push(m) };
const contacts: ContactList = { set: async (email, subscribed, language) => void mirrored.push([email, subscribed, language]) };
const CONSENT = 'Email me about new features (a few times a year).';

beforeAll(async () => {
  sql = await openPglite();
});
afterAll(() => sql?.close());
beforeEach(async () => {
  mail.length = 0;
  mirrored.length = 0;
  await sql.query('TRUNCATE users, email_codes, subscribers CASCADE');
  app = createApp({
    sql,
    mailer,
    contacts,
    config: { rpID: 'localhost', rpName: 'Mizan', origins: ['https://mizan.example.com'] },
  });
});

const post = (path: string, body: unknown, headers: Record<string, string> = { 'content-type': 'application/json' }) =>
  app.request(`/api${path}`, { method: 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body) });
const linkIn = (text: string, path: string) => text.match(new RegExp(`https://mizan\\.example\\.com${path}\\?token=[\\w-]+`))![0];
const row = async (email: string) => (await sql.query<Record<string, unknown>>('SELECT * FROM subscribers WHERE email = $1', [email]))[0];

async function signIn(email: string): Promise<Session> {
  await post('/auth/email/start', { email });
  const res = await post('/auth/email/verify', { email, code: codes.get(email), deviceName: 'Phone' });
  return (await res.json()) as Session;
}

describe('news by email', () => {
  it('needs the emailed link before anyone is subscribed, then welcomes them with a way out', async () => {
    const res = await post('/subscribe', { email: 'Ana@Example.com', language: 'fr', source: 'app', consent: CONSENT });
    expect(res.status).toBe(200);
    expect(mail).toHaveLength(1);
    expect(mail[0]).toMatchObject({ to: 'ana@example.com', subject: 'Confirmez les nouvelles de Mizan' });
    expect(await row('ana@example.com')).toMatchObject({ confirmed_at: null, source: 'app', consent_text: CONSENT, language: 'fr' });
    expect(mirrored).toEqual([]); // not on the mailing list until confirmed

    const confirm = await app.request(linkIn(mail[0].text, '/api/subscribe/confirm').replace('https://mizan.example.com', ''));
    expect(confirm.status).toBe(303);
    expect(confirm.headers.get('location')).toBe('https://mizan.example.com/updates?status=confirmed&locale=fr');
    expect((await row('ana@example.com')).confirmed_at).not.toBeNull();
    expect(mirrored).toEqual([['ana@example.com', true, 'fr']]);

    // The welcome email carries the unsubscribe link and the headers mail apps use.
    const welcome = mail[1];
    const unsubscribe = linkIn(welcome.text, '/api/unsubscribe');
    expect(welcome.headers).toEqual({ 'List-Unsubscribe': `<${unsubscribe}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' });

    // Opening the link only shows a page; the one-click POST unsubscribes.
    const page = await app.request(unsubscribe.replace('https://mizan.example.com', ''));
    expect(page.headers.get('location')).toMatch(/^https:\/\/mizan\.example\.com\/updates\?unsubscribe=[\w-]+&locale=fr$/);
    expect((await row('ana@example.com')).unsubscribed_at).toBeNull();
    const oneClick = await post(unsubscribe.replace('https://mizan.example.com/api', ''), 'List-Unsubscribe=One-Click', {
      'content-type': 'application/x-www-form-urlencoded',
    });
    expect(oneClick.status).toBe(200);
    expect((await row('ana@example.com')).unsubscribed_at).not.toBeNull();
    expect(mirrored.at(-1)).toEqual(['ana@example.com', false, 'fr']);
  });

  it('takes the website form, answers with a page, and never reveals who is subscribed', async () => {
    const form = (email: string) =>
      post('/subscribe', new URLSearchParams({ email, language: 'ar', source: 'site', consent: CONSENT }).toString(), {
        'content-type': 'application/x-www-form-urlencoded',
      });
    const res = await form('sam@example.com');
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('https://mizan.example.com/updates?status=check-email&locale=ar');
    await app.request(linkIn(mail[0].text, '/api/subscribe/confirm').replace('https://mizan.example.com', ''));
    mail.length = 0;
    // Already subscribed: the same answer, and no email.
    const again = await form('sam@example.com');
    expect(again.headers.get('location')).toBe('https://mizan.example.com/updates?status=check-email&locale=ar');
    expect(mail).toEqual([]);
  });

  it('refuses bad input and expired or unknown links', async () => {
    expect((await post('/subscribe', { email: 'nope', consent: CONSENT })).status).toBe(400);
    expect((await post('/subscribe', { email: 'a@example.com' })).status).toBe(400); // no consent recorded
    const bad = await app.request('/api/subscribe/confirm?token=wrong');
    expect(bad.headers.get('location')).toBe('https://mizan.example.com/updates?status=invalid&locale=en');
    expect((await post('/unsubscribe?token=wrong', {})).status).toBe(200);
  });

  it('lets a signed-in account switch news on and off, and forgets it with the account', async () => {
    const { token } = await signIn('lee@example.com');
    const auth = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
    const get = async () => (await (await app.request('/api/me/updates', { headers: auth })).json()) as { subscribed: boolean };
    expect(await get()).toEqual({ subscribed: false });

    const on = await app.request('/api/me/updates', {
      method: 'PUT',
      headers: auth,
      body: JSON.stringify({ subscribed: true, language: 'en', source: 'signup', consent: CONSENT }),
    });
    expect(on.status).toBe(200);
    expect(await get()).toEqual({ subscribed: true }); // proven by sign-in: no confirmation email
    expect(await row('lee@example.com')).toMatchObject({ source: 'signup', consent_text: CONSENT });
    expect(mail.at(-1)?.subject).toBe('You will hear from Mizan');

    await app.request('/api/me/updates', { method: 'PUT', headers: auth, body: JSON.stringify({ subscribed: false }) });
    expect(await get()).toEqual({ subscribed: false });
    expect(mirrored.at(-1)).toEqual(['lee@example.com', false, 'en']);

    await app.request('/api/account', { method: 'DELETE', headers: auth });
    expect(await row('lee@example.com')).toBeUndefined();
  });
});
