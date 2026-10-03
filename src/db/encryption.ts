/**
 * Dexie middleware that encrypts records on the way into IndexedDB and decrypts them on the
 * way out. It sits directly above IndexedDB, so Dexie's caches, hooks and live queries — and all
 * app code — only ever see plain objects.
 *
 * Stored shape: { id, <indexed fields>, _e: base64(iv ‖ AES-GCM(JSON of the whole record)) }.
 * Primary keys and indexed fields stay readable so queries work; what they reveal is listed in
 * docs/SECURITY.md. The settings row also keeps the fields the lock screen needs.
 */
import type { DBCore, DBCoreCursor, DBCoreMutateRequest, DBCoreTable, DBCoreTableSchema, Middleware } from 'dexie';
import { currentKey, fromB64, fromUtf8, LockedError, securityMode, seal, toB64, unseal, utf8 } from './crypto';

export const ENCRYPTED_FIELD = '_e';

/** Settings the lock screen and app shell need before unlocking. Everything else is encrypted. */
export const SETTINGS_PLAIN = new Set(['id', 'onboarded', 'theme', 'language', 'currency', 'lockAfterMinutes', 'hideAmounts']);

/** Tables stored as they are: the keyring only holds wrapped keys. */
const UNENCRYPTED_TABLES = new Set(['keyring']);

type Row = Record<string, unknown>;

function keyPaths(schema: DBCoreTableSchema): Set<string> {
  const out = new Set<string>();
  const add = (kp: string | string[] | null | undefined) => {
    if (!kp) return;
    for (const p of Array.isArray(kp) ? kp : [kp]) out.add(p.split('.')[0]);
  };
  add(schema.primaryKey.keyPath);
  for (const index of schema.indexes) add(index.keyPath);
  return out;
}

function encryptRow(table: string, plainKeys: Set<string>, row: unknown): unknown {
  if (!row || typeof row !== 'object') return row;
  const mode = securityMode();
  if (mode === 'off') return row;
  const key = currentKey();
  if (mode === 'locked' || !key) throw new LockedError();
  const visible: Row = {};
  for (const k of plainKeys) if (k in (row as Row)) visible[k] = (row as Row)[k];
  visible[ENCRYPTED_FIELD] = toB64(seal(utf8(JSON.stringify(row)), key, utf8(table)));
  return visible;
}

function decryptRow(table: string, row: unknown): unknown {
  if (!row || typeof row !== 'object' || !(ENCRYPTED_FIELD in row)) return row;
  const key = currentKey();
  if (!key) {
    if (table !== 'settings') throw new LockedError();
    const { [ENCRYPTED_FIELD]: _hidden, ...visible } = row as Row;
    return visible; // the lock screen can still read theme, language and lock settings
  }
  return JSON.parse(fromUtf8(unseal(fromB64((row as Row)[ENCRYPTED_FIELD] as string), key, utf8(table))));
}

/** Cursor whose `value` is decrypted (synchronously, once per position). */
function decryptingCursor(table: string, cursor: DBCoreCursor): DBCoreCursor {
  let lastRaw: unknown;
  let lastValue: unknown;
  return Object.create(cursor, {
    value: {
      get() {
        const raw = cursor.value;
        if (raw !== lastRaw) {
          lastRaw = raw;
          lastValue = decryptRow(table, raw);
        }
        return lastValue;
      },
    },
  });
}

function encryptingTable(name: string, table: DBCoreTable): DBCoreTable {
  const plainKeys = name === 'settings' ? SETTINGS_PLAIN : keyPaths(table.schema);
  const decrypt = (row: unknown) => decryptRow(name, row);
  return {
    ...table,
    mutate(req: DBCoreMutateRequest) {
      if ((req.type === 'add' || req.type === 'put') && req.values) {
        return table.mutate({ ...req, values: req.values.map((v) => encryptRow(name, plainKeys, v)) } as DBCoreMutateRequest);
      }
      return table.mutate(req);
    },
    get: (req) => table.get(req).then(decrypt),
    getMany: (req) => table.getMany(req).then((rows) => rows.map(decrypt)),
    query: (req) => table.query(req).then((res) => (req.values ? { ...res, result: res.result.map(decrypt) } : res)),
    openCursor: (req) => table.openCursor(req).then((cursor) => (cursor && req.values ? decryptingCursor(name, cursor) : cursor)),
  };
}

export const encryptionMiddleware: Middleware<DBCore> = {
  stack: 'dbcore',
  name: 'Encryption',
  // Below Dexie's own middlewares (caches at -1 and 0), so they all work on decrypted data.
  level: -2,
  create: (down) => ({
    ...down,
    table: (name: string) => (UNENCRYPTED_TABLES.has(name) ? down.table(name) : encryptingTable(name, down.table(name))),
  }),
};
