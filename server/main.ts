/**
 * Starts the sync API. Configuration comes from environment variables:
 *
 * - PORT (default 8787)
 * - DATABASE_URL: Postgres, with DATABASE_CA_CERT to verify its TLS certificate. Without it, data is kept in PGlite under LEDGER_DATA_DIR
 *   (default .ledger-api-data), or in memory with LEDGER_DATA_DIR=memory.
 * - RP_ID and APP_ORIGINS (comma-separated): where the app is served, for passkeys.
 * - MAIL_FROM, and either SMTP_HOST (with SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASSWORD) or
 *   RESEND_API_KEY: how email is sent (otherwise it is only logged). SMTP wins when both are set.
 * - RESEND_API_KEY with RESEND_SEGMENT_ID: news subscribers join that Resend segment (Broadcasts).
 * - PUBLIC_URL: where the app lives, for links in emails (default: the first of APP_ORIGINS).
 * - WEB_DIR: also serve the built web app from this folder (e.g. dist), on the same origin.
 * - LEDGER_DEV=1: development helpers (never in production).
 *
 * Run with `npm run server` (Node 24 runs TypeScript directly).
 */
import { readFileSync, renameSync } from 'node:fs';
import { serve } from '@hono/node-server';
import { createApp } from './app.ts';
import { openPglite, openPostgres, type Sql } from './db.ts';
import { consoleMailer, resendContacts, resendMailer, smtpMailer, smtpSettingsFrom } from './mailer.ts';
import { sendDueReminders, webPushSender } from './push.ts';
import { goCardlessProvider, sandboxProvider } from './banks.ts';
import { withWebApp } from './web.ts';

const env = process.env;
const port = Number(env.PORT ?? 8787);
const dev = env.LEDGER_DEV === '1' || process.argv.includes('--dev');
const dataDir = env.LEDGER_DATA_DIR ?? '.ledger-api-data';

/**
 * Local development only: PGlite cannot reopen its folder after the process is killed (not
 * stopped). Rather than fail, keep the broken folder aside and start a fresh one.
 */
async function openLocal(): Promise<Sql> {
  if (dataDir === 'memory') return openPglite();
  try {
    return await openPglite(dataDir);
  } catch (err) {
    const aside = `${dataDir}.broken-${Date.now()}`;
    renameSync(dataDir, aside);
    console.warn(
      `[db] ${dataDir} could not be opened (${err instanceof Error ? err.message : err}); moved to ${aside} and starting fresh.`,
    );
    return openPglite(dataDir);
  }
}

const sql = env.DATABASE_URL ? await openPostgres(env.DATABASE_URL, { ca: env.DATABASE_CA_CERT }) : await openLocal();
// Email: any SMTP server, or Resend's API, or (development) the log.
const from = env.MAIL_FROM || 'Mizan <login@example.com>';
const smtp = smtpSettingsFrom(env);
const mailer = smtp ? smtpMailer(smtp, from) : env.RESEND_API_KEY ? resendMailer(env.RESEND_API_KEY, from) : consoleMailer;
if (!smtp && !env.RESEND_API_KEY && !dev)
  console.warn('No email provider (SMTP_HOST or RESEND_API_KEY): emails are only printed to this log.');
console.log(`[mail] sending with ${smtp ? `SMTP (${smtp.host}:${smtp.port})` : env.RESEND_API_KEY ? 'Resend' : 'the console'}`);

const contacts = env.RESEND_API_KEY ? resendContacts(env.RESEND_API_KEY, env.RESEND_SEGMENT_ID || undefined) : undefined;
const push = await webPushSender(sql, env);
// Open Banking: GoCardless when its keys are set; the sandbox bank in development or when asked for.
const banks =
  env.GOCARDLESS_SECRET_ID && env.GOCARDLESS_SECRET_KEY
    ? goCardlessProvider(env.GOCARDLESS_SECRET_ID, env.GOCARDLESS_SECRET_KEY)
    : dev || env.BANKS_SANDBOX === '1'
      ? sandboxProvider()
      : undefined;

const app = createApp({
  sql,
  mailer,
  push,
  banks,
  contacts,
  config: {
    rpID: env.RP_ID ?? 'localhost',
    rpName: 'Mizan',
    // Native apps: add capacitor://localhost (iOS) and https://localhost (Android) in production.
    origins: (
      env.APP_ORIGINS ?? 'http://localhost:5173,http://localhost:4173,http://localhost:4174,capacitor://localhost,https://localhost'
    )
      .split(',')
      .map((s) => s.trim()),
    dev,
    version: (JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf-8')) as { version: string }).version,
    environment: env.LEDGER_ENV ?? (dev ? 'development' : 'production'),
    publicUrl: env.PUBLIC_URL || undefined,
  },
});

const site = env.WEB_DIR ? withWebApp(app, env.WEB_DIR, { https: !dev }) : app;
const server = serve({ fetch: site.fetch, port }, () =>
  console.log(
    `Mizan API on http://localhost:${port}/api (${env.DATABASE_URL ? 'Postgres' : 'PGlite'})${env.WEB_DIR ? `, app from ${env.WEB_DIR}` : ''}`,
  ),
);

// Push reminders when they are due.
const pushTimer = setInterval(() => void sendDueReminders(sql, push).catch((err) => console.error('[push]', err.message)), 60_000);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    clearInterval(pushTimer);
    server.close();
    void sql.close().finally(() => process.exit(0));
  });
}
