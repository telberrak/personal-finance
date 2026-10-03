/**
 * Web Push reminders. Each device uploads its upcoming reminders: a time and a generic sentence
 * ("A bill is due tomorrow"), never names, amounts or balances. The scheduler sends them when due.
 */
import type { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { Sql } from './db.ts';

export interface PushSubscriptionJSON {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export interface PushSender {
  publicKey: string;
  /** 'gone' when the subscription no longer exists (the browser unsubscribed). */
  send(subscription: PushSubscriptionJSON, payload: string): Promise<'ok' | 'gone'>;
}

export const MAX_REMINDERS = 100;
const MAX_TEXT = 200;
const HORIZON_MS = 60 * 24 * 60 * 60_000;

const bad = (error: string): never => {
  throw new HTTPException(400, { res: Response.json({ error }, { status: 400 }) });
};

type Env = { Variables: { userId: string; sessionId: string } };

export function pushRoutes(authed: Hono<Env>, sql: Sql, push: PushSender | undefined) {
  authed.get('/push/key', (c) => (push ? c.json({ publicKey: push.publicKey }) : c.json({ error: 'Push is not set up.' }, 404)));

  authed.put('/push/subscription', async (c) => {
    const sub = (await c.req.json().catch(() => null)) as PushSubscriptionJSON | null;
    if (!sub || typeof sub.endpoint !== 'string' || !/^https:\/\//.test(sub.endpoint) || sub.endpoint.length > 1000)
      bad('Invalid subscription.');
    if (typeof sub!.keys?.p256dh !== 'string' || typeof sub!.keys?.auth !== 'string') bad('Invalid subscription.');
    await sql.query(
      `INSERT INTO push_subscriptions (session_id, endpoint, p256dh, auth) VALUES ($1, $2, $3, $4)
       ON CONFLICT (session_id) DO UPDATE SET endpoint = excluded.endpoint, p256dh = excluded.p256dh, auth = excluded.auth`,
      [c.get('sessionId'), sub!.endpoint, sub!.keys.p256dh, sub!.keys.auth],
    );
    return c.json({ ok: true });
  });

  authed.delete('/push/subscription', async (c) => {
    await sql.query('DELETE FROM push_subscriptions WHERE session_id = $1', [c.get('sessionId')]);
    return c.json({ ok: true });
  });

  /** Replaces this device's upcoming reminders. */
  authed.put('/push/reminders', async (c) => {
    const body = (await c.req.json().catch(() => null)) as {
      reminders?: { at: number; title: string; body: string; tag: string }[];
    } | null;
    const reminders = body?.reminders;
    if (!Array.isArray(reminders) || reminders.length > MAX_REMINDERS) return bad('Invalid reminders.');
    const now = Date.now();
    for (const r of reminders) {
      if (!Number.isFinite(r?.at) || r.at > now + HORIZON_MS) bad('Invalid reminder time.');
      for (const s of [r.title, r.body, r.tag]) if (typeof s !== 'string' || s.length > MAX_TEXT) bad('Invalid reminder text.');
    }
    const sessionId = c.get('sessionId');
    await sql.transaction(async (tx) => {
      await tx.query('DELETE FROM reminders WHERE session_id = $1', [sessionId]);
      for (const r of reminders)
        await tx.query('INSERT INTO reminders (session_id, send_at, title, body, tag) VALUES ($1, $2, $3, $4, $5)', [
          sessionId,
          new Date(Math.max(r.at, now)),
          r.title,
          r.body,
          r.tag,
        ]);
    });
    return c.json({ ok: true });
  });
}

/** Sends due reminders. Call every minute. Returns how many were sent. */
export async function sendDueReminders(sql: Sql, push: PushSender, now = new Date()): Promise<number> {
  const due = await sql.query<{
    id: string;
    session_id: string;
    title: string;
    body: string;
    tag: string;
    endpoint: string;
    p256dh: string;
    auth: string;
  }>(
    `SELECT r.id, r.session_id, r.title, r.body, r.tag, s.endpoint, s.p256dh, s.auth
     FROM reminders r JOIN push_subscriptions s ON s.session_id = r.session_id
     WHERE r.send_at <= $1 ORDER BY r.send_at LIMIT 500`,
    [now],
  );
  let sent = 0;
  for (const r of due) {
    // Delete first: a reminder is never sent twice, even if sending fails.
    await sql.query('DELETE FROM reminders WHERE id = $1', [r.id]);
    try {
      const result = await push.send(
        { endpoint: r.endpoint, keys: { p256dh: r.p256dh, auth: r.auth } },
        JSON.stringify({ title: r.title, body: r.body, tag: r.tag }),
      );
      if (result === 'gone') await sql.query('DELETE FROM push_subscriptions WHERE session_id = $1', [r.session_id]);
      else sent += 1;
    } catch (err) {
      console.error('[push]', err instanceof Error ? err.message : 'send failed');
    }
  }
  // Reminders for devices without a subscription are dropped once due.
  await sql.query('DELETE FROM reminders WHERE send_at <= $1', [now]);
  return sent;
}

/** VAPID keys from the environment, or generated once and kept in the database. */
export async function webPushSender(sql: Sql, env: NodeJS.ProcessEnv): Promise<PushSender> {
  const { default: webpush } = await import('web-push');
  let publicKey = env.VAPID_PUBLIC_KEY;
  let privateKey = env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) {
    const [row] = await sql.query<{ value: string }>("SELECT value FROM server_settings WHERE key = 'vapid'");
    if (row) ({ publicKey, privateKey } = JSON.parse(row.value) as { publicKey: string; privateKey: string });
    else {
      ({ publicKey, privateKey } = webpush.generateVAPIDKeys());
      await sql.query("INSERT INTO server_settings (key, value) VALUES ('vapid', $1)", [JSON.stringify({ publicKey, privateKey })]);
    }
  }
  const vapidDetails = { subject: env.VAPID_SUBJECT ?? 'mailto:support@example.com', publicKey: publicKey!, privateKey: privateKey! };
  return {
    publicKey: publicKey!,
    async send(subscription, payload) {
      try {
        await webpush.sendNotification(subscription, payload, { vapidDetails, TTL: 6 * 60 * 60 });
        return 'ok';
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) return 'gone';
        throw err;
      }
    },
  };
}
