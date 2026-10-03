/**
 * Database access. Production uses Postgres (DATABASE_URL); tests and local development use
 * PGlite, which is Postgres compiled to WebAssembly, so no database server is needed.
 * Queries are plain parameterised SQL.
 */
import type { PGlite } from '@electric-sql/pglite';
import type pg from 'pg';

export interface Sql {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
  /** Runs `fn` in one transaction, committed if it resolves and rolled back if it throws. */
  transaction<T>(fn: (tx: Sql) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

/** Schema changes, applied in order once each. Never edit a released one: add a new entry. */
const MIGRATIONS: string[] = [
  `
  CREATE TABLE users (
    id uuid PRIMARY KEY,
    email text NOT NULL UNIQUE,
    created_at timestamptz NOT NULL DEFAULT now(),
    -- Per-user change counter: pushes for one user are serialised on this row, so sequence
    -- numbers are committed in order and a pull never skips a change.
    seq bigint NOT NULL DEFAULT 0
  );
  CREATE TABLE sessions (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash text NOT NULL UNIQUE,
    device_name text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    last_seen_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE INDEX sessions_user ON sessions(user_id);
  CREATE TABLE email_codes (
    email text PRIMARY KEY,
    code_hash text NOT NULL,
    expires_at timestamptz NOT NULL,
    attempts int NOT NULL DEFAULT 0
  );
  CREATE TABLE passkeys (
    id text PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    public_key bytea NOT NULL,
    counter bigint NOT NULL DEFAULT 0,
    transports text[] NOT NULL DEFAULT '{}',
    created_at timestamptz NOT NULL DEFAULT now(),
    last_used_at timestamptz
  );
  CREATE INDEX passkeys_user ON passkeys(user_id);
  CREATE TABLE challenges (
    id uuid PRIMARY KEY,
    challenge text NOT NULL,
    user_id uuid REFERENCES users(id) ON DELETE CASCADE,
    expires_at timestamptz NOT NULL
  );
  -- The sync key, encrypted on the device with the recovery key. The server cannot open it.
  CREATE TABLE vaults (
    user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    envelope text NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
  );
  -- One row per synced record. rkey is an HMAC of the record's table and id; blob is ciphertext.
  CREATE TABLE records (
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    rkey text NOT NULL,
    seq bigint NOT NULL,
    blob text,
    PRIMARY KEY (user_id, rkey)
  );
  CREATE INDEX records_user_seq ON records(user_id, seq);
  `,
  // 2: Web Push (P4). Reminders hold a time and generic text only.
  `
  CREATE TABLE server_settings (
    key text PRIMARY KEY,
    value text NOT NULL
  );
  CREATE TABLE push_subscriptions (
    session_id uuid PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
    endpoint text NOT NULL,
    p256dh text NOT NULL,
    auth text NOT NULL
  );
  CREATE TABLE reminders (
    id bigserial PRIMARY KEY,
    session_id uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    send_at timestamptz NOT NULL,
    title text NOT NULL,
    body text NOT NULL,
    tag text NOT NULL
  );
  CREATE INDEX reminders_due ON reminders(send_at);
  `,
  // 3: Open Banking connections (P5). No transactions are stored.
  `
  CREATE TABLE bank_links (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider text NOT NULL,
    provider_ref text NOT NULL,
    institution_id text NOT NULL,
    institution_name text NOT NULL,
    status text NOT NULL,
    expires_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE INDEX bank_links_user ON bank_links(user_id);
  `,
  // 4: households (P11). Shared records are ciphertext under the household's own key.
  `
  CREATE TABLE spaces (
    id uuid PRIMARY KEY,
    owner_id uuid REFERENCES users(id) ON DELETE SET NULL,
    seq bigint NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE space_members (
    space_id uuid NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    joined_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (space_id, user_id)
  );
  CREATE INDEX space_members_user ON space_members(user_id);
  CREATE TABLE space_invites (
    token_hash text PRIMARY KEY,
    space_id uuid NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
    expires_at timestamptz NOT NULL
  );
  CREATE TABLE space_records (
    space_id uuid NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
    rkey text NOT NULL,
    seq bigint NOT NULL,
    blob text,
    PRIMARY KEY (space_id, rkey)
  );
  CREATE INDEX space_records_seq ON space_records(space_id, seq);
  `,
  // 5: feedback, and opt-in anonymous daily usage counts (P13).
  `
  CREATE TABLE feedback (
    id uuid PRIMARY KEY,
    created_at timestamptz NOT NULL DEFAULT now(),
    message text NOT NULL,
    email text,
    version text NOT NULL,
    language text NOT NULL
  );
  CREATE TABLE event_counts (
    day date NOT NULL,
    name text NOT NULL,
    count integer NOT NULL,
    PRIMARY KEY (day, name)
  );
  `,
];

export async function migrate(sql: Sql): Promise<void> {
  await sql.query('CREATE TABLE IF NOT EXISTS schema_migrations (version int PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
  const done = new Set((await sql.query<{ version: number }>('SELECT version FROM schema_migrations')).map((r) => r.version));
  for (const [i, migration] of MIGRATIONS.entries()) {
    if (done.has(i + 1)) continue;
    await sql.transaction(async (tx) => {
      const statements = migration.replace(/--.*$/gm, '').split(';');
      for (const statement of statements.filter((s) => s.trim())) await tx.query(statement);
      await tx.query('INSERT INTO schema_migrations (version) VALUES ($1)', [i + 1]);
    });
  }
}

type PgliteLike = Pick<PGlite, 'query'>;

function pgliteSql(db: PgliteLike, root: PGlite): Sql {
  return {
    query: async <T>(text: string, params?: unknown[]) => (await db.query<T>(text, params)).rows,
    transaction: (fn) => root.transaction((tx) => fn(pgliteSql(tx, root))),
    close: () => root.close(),
  };
}

/** In-memory when `dataDir` is undefined (tests), or stored in a folder (local development). */
export async function openPglite(dataDir?: string): Promise<Sql> {
  const { PGlite } = await import('@electric-sql/pglite');
  const db = new PGlite(dataDir);
  const sql = pgliteSql(db, db);
  await migrate(sql);
  return sql;
}

export async function openPostgres(url: string): Promise<Sql> {
  const { default: pgModule } = await import('pg');
  const pool = new pgModule.Pool({ connectionString: url, max: 10 });
  const client = (c: pg.Pool | pg.PoolClient): Sql => ({
    query: async <T>(text: string, params?: unknown[]) => (await c.query(text, params)).rows as T[],
    transaction: async (fn) => {
      const conn = await pool.connect();
      try {
        await conn.query('BEGIN');
        const result = await fn(client(conn));
        await conn.query('COMMIT');
        return result;
      } catch (err) {
        await conn.query('ROLLBACK');
        throw err;
      } finally {
        conn.release();
      }
    },
    close: () => pool.end(),
  });
  const sql = client(pool);
  await migrate(sql);
  return sql;
}
