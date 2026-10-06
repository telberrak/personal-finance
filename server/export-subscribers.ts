/**
 * Prints confirmed news subscribers as CSV, with their consent record, for any mailing tool.
 * People who unsubscribed or never confirmed are left out. On the server:
 *
 *   cd /srv/mizan && docker compose exec -T mizan node server/export-subscribers.ts > subscribers.csv
 *
 * The file holds email addresses: keep it private and delete it once imported.
 */
import { openPostgres } from './db.ts';

/** A CSV field, quoted when it contains a comma, quote or line break. */
export const csvField = (value: unknown): string => {
  const s = value instanceof Date ? value.toISOString() : String(value ?? '');
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set.');
  process.exit(1);
}
const sql = await openPostgres(url, { ca: process.env.DATABASE_CA_CERT });
const rows = await sql.query<Record<string, unknown>>(
  `SELECT email, language, source, consented_at, confirmed_at, consent_text FROM subscribers
   WHERE confirmed_at IS NOT NULL AND unsubscribed_at IS NULL ORDER BY confirmed_at`,
);
const columns = ['email', 'language', 'source', 'consented_at', 'confirmed_at', 'consent_text'];
process.stdout.write([columns.join(','), ...rows.map((r) => columns.map((c) => csvField(r[c])).join(','))].join('\n') + '\n');
await sql.close();
