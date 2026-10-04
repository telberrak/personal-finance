/**
 * Feedback messages, and opt-in anonymous usage counts. Counts are daily totals per event name
 * from a fixed list: no user, device, IP address or content is stored with them.
 */
import { randomUUID } from 'node:crypto';
import type { Context, Hono } from 'hono';
import type { Sql } from './db.ts';
import { RateLimiter } from './rate-limit.ts';

export const EVENTS = new Set([
  'app_open',
  'transaction_added',
  'import_done',
  'bill_added',
  'budget_set',
  'goal_added',
  'sync_enabled',
  'bank_connected',
  'household_joined',
  'receipt_read',
  'language_fr',
  'language_ar',
]);

const MAX_MESSAGE = 4000;

export function feedbackRoutes(app: Hono, sql: Sql) {
  const limiter = new RateLimiter();
  const ip = (c: Context) => c.req.header('do-connecting-ip') ?? c.req.header('x-forwarded-for')?.split(',')[0].trim() ?? 'local';

  app.post('/feedback', async (c) => {
    if (!limiter.take(`feedback:${ip(c)}`, 5, 3_600_000)) return c.json({ error: 'Too many messages. Try again later.' }, 429);
    const body = (await c.req.json().catch(() => ({}))) as { message?: string; email?: string; version?: string; language?: string };
    const message = typeof body.message === 'string' ? body.message.trim() : '';
    if (!message || message.length > MAX_MESSAGE) return c.json({ error: 'Write a message of up to 4,000 characters.' }, 400);
    const email =
      typeof body.email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email.trim()) ? body.email.trim().slice(0, 254) : null;
    await sql.query('INSERT INTO feedback (id, message, email, version, language) VALUES ($1, $2, $3, $4, $5)', [
      randomUUID(),
      message,
      email,
      String(body.version ?? '').slice(0, 20),
      String(body.language ?? '').slice(0, 10),
    ]);
    return c.json({ ok: true });
  });

  app.post('/events', async (c) => {
    if (!limiter.take(`events:${ip(c)}`, 60, 3_600_000)) return c.json({ ok: true }); // quietly drop floods
    const body = (await c.req.json().catch(() => ({}))) as { events?: unknown };
    const events = Array.isArray(body.events)
      ? body.events.filter((e): e is string => typeof e === 'string' && EVENTS.has(e)).slice(0, 50)
      : [];
    for (const name of events)
      await sql.query(
        `INSERT INTO event_counts (day, name, count) VALUES (current_date, $1, 1)
         ON CONFLICT (day, name) DO UPDATE SET count = event_counts.count + 1`,
        [name],
      );
    return c.json({ ok: true });
  });
}
