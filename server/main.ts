/**
 * Starts the sync API. Configuration comes from environment variables:
 *
 * - PORT (default 8787)
 * - DATABASE_URL: Postgres. Without it, data is kept in PGlite under LEDGER_DATA_DIR
 *   (default .ledger-api-data), or in memory with LEDGER_DATA_DIR=memory.
 * - RP_ID and APP_ORIGINS (comma-separated): where the app is served, for passkeys.
 * - RESEND_API_KEY and MAIL_FROM: sends sign-in codes by email (otherwise they are logged).
 * - LEDGER_DEV=1: development helpers (never in production).
 *
 * Run with `npm run server` (Node 24 runs TypeScript directly).
 */
import { readFileSync } from 'node:fs';
import { serve } from '@hono/node-server';
import { createApp } from './app.ts';
import { openPglite, openPostgres } from './db.ts';
import { consoleMailer, resendMailer } from './mailer.ts';

const env = process.env;
const port = Number(env.PORT ?? 8787);
const dev = env.LEDGER_DEV === '1' || process.argv.includes('--dev');
const dataDir = env.LEDGER_DATA_DIR ?? '.ledger-api-data';

const sql = env.DATABASE_URL ? await openPostgres(env.DATABASE_URL) : await openPglite(dataDir === 'memory' ? undefined : dataDir);
const mailer = env.RESEND_API_KEY ? resendMailer(env.RESEND_API_KEY, env.MAIL_FROM ?? 'Ledger <login@example.com>') : consoleMailer;
if (!env.RESEND_API_KEY && !dev) console.warn('RESEND_API_KEY is not set: sign-in codes are only printed to this log.');

const app = createApp({
  sql,
  mailer,
  config: {
    rpID: env.RP_ID ?? 'localhost',
    rpName: 'Ledger',
    origins: (env.APP_ORIGINS ?? 'http://localhost:5173,http://localhost:4173,http://localhost:4174').split(',').map((s) => s.trim()),
    dev,
    version: (JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf-8')) as { version: string }).version,
    environment: env.LEDGER_ENV ?? (dev ? 'development' : 'production'),
  },
});

const server = serve({ fetch: app.fetch, port }, () =>
  console.log(`Ledger API on http://localhost:${port}/api (${env.DATABASE_URL ? 'Postgres' : 'PGlite'})`),
);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.close();
    void sql.close().finally(() => process.exit(0));
  });
}
