/**
 * Records which records change, for sync. Every write to a synced table also writes an outbox
 * entry in the same IndexedDB transaction, so a change and its outbox entry are saved together
 * or not at all. The sync engine (src/sync/engine.ts) pushes the entries and clears them.
 *
 * Only table names and record ids go in the outbox; values are read at push time.
 */
import type { DBCore, DBCoreMutateRequest, DBCoreTable, Middleware } from 'dexie';

/** Tables that are never synced. */
export const LOCAL_TABLES = new Set(['keyring', 'outbox', 'syncState', 'notices']);
export const isSynced = (table: string) => !LOCAL_TABLES.has(table);

export const outboxId = (table: string, key: string) => `${table}/${key}`;

function trackingTable(name: string, table: DBCoreTable, outbox: () => DBCoreTable): DBCoreTable {
  const keyPath = table.schema.primaryKey.keyPath as string;
  async function changedKeys(req: DBCoreMutateRequest): Promise<unknown[]> {
    switch (req.type) {
      case 'add':
      case 'put':
        return req.keys ?? req.values.map((v) => (v as Record<string, unknown>)[keyPath]);
      case 'delete':
        return req.keys;
      case 'deleteRange': {
        const res = await table.query({ trans: req.trans, values: false, query: { index: table.schema.primaryKey, range: req.range } });
        return res.result;
      }
    }
  }
  return {
    ...table,
    async mutate(req) {
      // Schema upgrades are not changes to sync (and may run before the outbox table exists).
      if ((req.trans as unknown as IDBTransaction).mode === 'versionchange') return table.mutate(req);
      const keys = await changedKeys(req);
      const res = await table.mutate(req);
      if (keys.length) {
        const at = Date.now();
        await outbox().mutate({
          type: 'put',
          trans: req.trans,
          values: keys.map((k) => ({ id: outboxId(name, String(k)), table: name, key: String(k), at })),
        });
      }
      return res;
    },
  };
}

export const outboxMiddleware: Middleware<DBCore> = {
  stack: 'dbcore',
  name: 'Outbox',
  // Below encryption (-2): it only needs primary keys, which are stored readable.
  level: -3,
  create: (down) => ({
    ...down,
    // Read-write transactions on synced tables also get the outbox.
    transaction(stores, mode, options) {
      const widened = mode === 'readwrite' && stores.some(isSynced) && !stores.includes('outbox') ? [...stores, 'outbox'] : stores;
      return down.transaction(widened, mode, options);
    },
    table: (name: string) => (isSynced(name) ? trackingTable(name, down.table(name), () => down.table('outbox')) : down.table(name)),
  }),
};
