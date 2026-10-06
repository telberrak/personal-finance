/**
 * News by email: people who asked for updates about Mizan, kept apart from sync accounts.
 *
 * - Consent is opt-in and recorded: when, where (website, app, settings), in which language and
 *   the exact wording shown.
 * - Double opt-in: an address typed on the website or in the app is only added once its owner
 *   clicks the link we email. A sync account's address is already proven by its sign-in code, so
 *   a signed-in user's choice in the app applies straight away.
 * - Leaving is one click: every message carries an unsubscribe link and the List-Unsubscribe
 *   headers mail apps use for their own unsubscribe button (RFC 8058). The link opens a page with
 *   a button rather than unsubscribing on the GET itself, so link scanners cannot unsubscribe anyone.
 * - With RESEND_API_KEY, confirmed subscribers are mirrored to Resend Contacts for Broadcasts.
 *
 * Responses never reveal whether an address is already subscribed.
 */
import { createHash, randomBytes } from 'node:crypto';
import type { Context, Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { Sql } from './db.ts';
import type { ContactList, Mailer, MailMessage } from './mailer.ts';
import { RateLimiter } from './rate-limit.ts';
import { clientIp } from './client-ip.ts';

type Env = { Variables: { userId: string; sessionId: string } };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const LANGUAGES = ['en', 'fr', 'ar'] as const;
type Lang = (typeof LANGUAGES)[number];
/** Where someone said yes. */
const SOURCES = ['site', 'app', 'signup', 'settings'] as const;
const CONFIRM_TTL_MS = 7 * 86_400_000;
const MAX_CONSENT_CHARS = 500;

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const token = () => randomBytes(32).toString('base64url');
const lang = (v: unknown): Lang => (LANGUAGES.includes(v as Lang) ? (v as Lang) : 'en');
const fail = (status: 400 | 429 | 502, error: string): never => {
  throw new HTTPException(status, { res: Response.json({ error }, { status }) });
};

/** The emails, in the subscriber's language. `{link}` and `{unsubscribe}` are filled in. */
const TEXTS: Record<Lang, { confirmSubject: string; confirm: string; welcomeSubject: string; welcome: string }> = {
  en: {
    confirmSubject: 'Confirm your Mizan updates',
    confirm:
      'Please confirm you would like news from Mizan by email: new features and tips, a few times a year.\n\nConfirm: {link}\n\nIf you did not ask for this, ignore this email and you will not hear from us.',
    welcomeSubject: 'You will hear from Mizan',
    welcome:
      'Thank you: you will get news from Mizan by email, a few times a year. We never share your address.\n\nTo stop at any time: {unsubscribe}',
  },
  fr: {
    confirmSubject: 'Confirmez les nouvelles de Mizan',
    confirm:
      'Merci de confirmer que vous souhaitez recevoir les nouvelles de Mizan par e-mail : nouveautés et conseils, quelques fois par an.\n\nConfirmer : {link}\n\nSi vous n’avez rien demandé, ignorez cet e-mail : vous ne recevrez rien.',
    welcomeSubject: 'Vous recevrez les nouvelles de Mizan',
    welcome:
      'Merci : vous recevrez les nouvelles de Mizan par e-mail, quelques fois par an. Votre adresse n’est jamais partagée.\n\nPour arrêter à tout moment : {unsubscribe}',
  },
  ar: {
    confirmSubject: 'أكّد اشتراكك في أخبار Mizan',
    confirm:
      'يُرجى تأكيد رغبتك في تلقّي أخبار Mizan بالبريد الإلكتروني: ميزات جديدة ونصائح، بضع مرات في السنة.\n\nللتأكيد: {link}\n\nإن لم تطلب ذلك فتجاهل هذه الرسالة ولن يصلك منا شيء.',
    welcomeSubject: 'ستصلك أخبار Mizan',
    welcome:
      'شكرًا لك: ستصلك أخبار Mizan بالبريد الإلكتروني بضع مرات في السنة. لا نشارك عنوانك مع أحد.\n\nلإلغاء الاشتراك في أي وقت: {unsubscribe}',
  },
};

interface Subscriber {
  email: string;
  language: Lang;
  confirmed_at: Date | null;
  unsubscribed_at: Date | null;
  unsubscribe_token: string;
  confirm_token_hash: string | null;
}

/** Whether a row counts as subscribed: confirmed and not unsubscribed since. */
const isSubscribed = (s: Subscriber | undefined) => !!s?.confirmed_at && !s.unsubscribed_at;

/**
 * News-by-email routes. Public: subscribe (JSON from the app, or a plain form from the website),
 * confirm, and one-click unsubscribe. Signed in: read and change the choice for the account's email.
 */
export function subscriberRoutes(
  app: Hono,
  authed: Hono<Env>,
  {
    sql,
    mailer,
    contacts,
    publicUrl,
    lastEmails,
  }: {
    sql: Sql;
    mailer: Mailer;
    contacts?: ContactList;
    /** Where the app lives, for links in emails, e.g. https://mizan.example.com */
    publicUrl: string;
    /** Development only: the last message per address, for tests. */
    lastEmails?: Map<string, MailMessage>;
  },
) {
  const limiter = new RateLimiter();
  const limit = (key: string, max: number, windowMs: number) => {
    if (!limiter.take(key, max, windowMs)) fail(429, 'Too many attempts. Wait a few minutes and try again.');
  };
  const unsubscribeUrl = (t: string) => `${publicUrl}/api/unsubscribe?token=${t}`;
  const pageUrl = (status: string, language: string) => `${publicUrl}/updates?status=${status}&locale=${language}`;

  async function send(message: MailMessage) {
    lastEmails?.set(message.to, message);
    if (!mailer.send) return fail(502, 'We could not send the email. Try again in a few minutes.');
    try {
      await mailer.send(message);
    } catch (err) {
      console.error('[mail]', err instanceof Error ? err.message : 'error');
      fail(502, 'We could not send the email. Try again in a few minutes.');
    }
  }

  /** Mirrors a change to the mailing list; a failure there never undoes the choice here. */
  async function mirror(email: string, subscribed: boolean, language: string) {
    await contacts
      ?.set(email, subscribed, language)
      .catch((err) => console.error('[contacts]', err instanceof Error ? err.message : 'error'));
  }

  async function welcome(s: Pick<Subscriber, 'email' | 'language' | 'unsubscribe_token'>) {
    const text = TEXTS[s.language];
    const link = unsubscribeUrl(s.unsubscribe_token);
    // Mail apps show their own unsubscribe button from these headers, and use one-click POST.
    const headers = { 'List-Unsubscribe': `<${link}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' };
    // The welcome note is a courtesy: if it fails, the subscription still stands.
    await send({ to: s.email, subject: text.welcomeSubject, text: text.welcome.replace('{unsubscribe}', link), headers }).catch(
      () => undefined,
    );
  }

  async function read(c: Context): Promise<Record<string, unknown>> {
    const type = c.req.header('content-type') ?? '';
    if (type.includes('application/x-www-form-urlencoded') || type.includes('multipart/form-data')) return c.req.parseBody();
    return c.req.json().catch(() => fail(400, 'Expected a JSON body.'));
  }

  async function find(email: string): Promise<Subscriber | undefined> {
    const [row] = await sql.query<Subscriber>('SELECT * FROM subscribers WHERE email = $1', [email]);
    return row;
  }

  /** Subscribe: from the app (JSON) or the website (a form, answered with a redirect). */
  app.post('/subscribe', async (c) => {
    const form = !(c.req.header('content-type') ?? '').includes('json');
    const body = await read(c);
    const email = String(body.email ?? '')
      .trim()
      .toLowerCase();
    const language = lang(body.language);
    const source = SOURCES.includes(body.source as (typeof SOURCES)[number]) ? String(body.source) : 'site';
    const consent = String(body.consent ?? '').trim();
    if (!EMAIL.test(email) || email.length > 254) return fail(400, 'Enter a valid email address.');
    if (!consent) return fail(400, 'Missing consent.');
    limit(`subscribe:ip:${clientIp(c)}`, 10, 60 * 60_000);
    limit(`subscribe:email:${email}`, 3, 60 * 60_000);

    const existing = await find(email);
    if (!isSubscribed(existing)) {
      const confirm = token();
      await sql.query(
        `INSERT INTO subscribers (email, language, source, consent_text, consented_at, confirm_token_hash, confirm_expires_at, unsubscribe_token)
         VALUES ($1, $2, $3, $4, now(), $5, $6, $7)
         ON CONFLICT (email) DO UPDATE SET language = excluded.language, source = excluded.source, consent_text = excluded.consent_text,
           consented_at = now(), confirm_token_hash = excluded.confirm_token_hash, confirm_expires_at = excluded.confirm_expires_at`,
        [email, language, source, consent.slice(0, MAX_CONSENT_CHARS), sha256(confirm), new Date(Date.now() + CONFIRM_TTL_MS), token()],
      );
      const text = TEXTS[language];
      await send({
        to: email,
        subject: text.confirmSubject,
        text: text.confirm.replace('{link}', `${publicUrl}/api/subscribe/confirm?token=${confirm}`),
      });
    }
    // The same answer whether or not the address was already subscribed.
    return form ? c.redirect(pageUrl('check-email', language), 303) : c.json({ ok: true });
  });

  /** The link in the confirmation email. */
  app.get('/subscribe/confirm', async (c) => {
    const t = c.req.query('token') ?? '';
    const [row] = await sql.query<Subscriber>(
      `UPDATE subscribers SET confirmed_at = now(), unsubscribed_at = NULL, confirm_token_hash = NULL, confirm_expires_at = NULL
       WHERE confirm_token_hash = $1 AND confirm_expires_at > now() RETURNING *`,
      [sha256(t)],
    );
    if (!row) return c.redirect(pageUrl('invalid', 'en'), 303);
    await mirror(row.email, true, row.language);
    await welcome(row);
    return c.redirect(pageUrl('confirmed', row.language), 303);
  });

  /** The unsubscribe link: opens a page with a button, so link scanners cannot unsubscribe anyone. */
  app.get('/unsubscribe', async (c) => {
    const t = c.req.query('token') ?? '';
    const [row] = await sql.query<{ language: string }>('SELECT language FROM subscribers WHERE unsubscribe_token = $1', [t]);
    return c.redirect(`${publicUrl}/updates?unsubscribe=${encodeURIComponent(t)}&locale=${lang(row?.language)}`, 303);
  });

  /** Unsubscribe: the page's button, and mail apps' one-click unsubscribe (RFC 8058). */
  app.post('/unsubscribe', async (c) => {
    const fromBody = (c.req.header('content-type') ?? '').includes('json')
      ? ((await c.req.json().catch(() => ({}))) as { token?: string }).token
      : undefined;
    const t = c.req.query('token') ?? fromBody ?? '';
    const [row] = await sql.query<Subscriber>(
      'UPDATE subscribers SET unsubscribed_at = now() WHERE unsubscribe_token = $1 AND unsubscribed_at IS NULL RETURNING *',
      [t],
    );
    if (row) await mirror(row.email, false, row.language);
    return c.json({ ok: true });
  });

  // ------------------------------------------------------------ signed in

  async function accountEmail(c: Context<Env>): Promise<string> {
    const [user] = await sql.query<{ email: string }>('SELECT email FROM users WHERE id = $1', [c.get('userId')]);
    return user.email;
  }

  authed.get('/me/updates', async (c) => {
    const row = await find(await accountEmail(c));
    return c.json({ subscribed: isSubscribed(row) });
  });

  /** The account's choice. Its address is proven by sign-in, so no confirmation email is needed. */
  authed.put('/me/updates', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { subscribed?: boolean; language?: string; consent?: string; source?: string };
    const email = await accountEmail(c);
    const language = lang(body.language);
    if (body.subscribed) {
      const consent = String(body.consent ?? '').trim();
      if (!consent) return fail(400, 'Missing consent.');
      const source = body.source === 'signup' ? 'signup' : 'settings';
      const before = await find(email);
      const [row] = await sql.query<Subscriber>(
        `INSERT INTO subscribers (email, language, source, consent_text, consented_at, confirmed_at, unsubscribe_token)
         VALUES ($1, $2, $3, $4, now(), now(), $5)
         ON CONFLICT (email) DO UPDATE SET language = excluded.language, source = excluded.source, consent_text = excluded.consent_text,
           consented_at = now(), confirmed_at = now(), unsubscribed_at = NULL, confirm_token_hash = NULL, confirm_expires_at = NULL
         RETURNING *`,
        [email, language, source, consent.slice(0, MAX_CONSENT_CHARS), token()],
      );
      await mirror(email, true, language);
      if (!isSubscribed(before)) await welcome(row);
    } else {
      const [row] = await sql.query<Subscriber>(
        'UPDATE subscribers SET unsubscribed_at = now() WHERE email = $1 AND unsubscribed_at IS NULL RETURNING *',
        [email],
      );
      if (row) await mirror(email, false, row.language);
    }
    return c.json({ subscribed: !!body.subscribed });
  });
}
