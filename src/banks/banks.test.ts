// @vitest-environment node
// The real server (sandbox bank, PGlite in memory) answers fetch('/api/…').
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { sandboxProvider } from '../../server/banks.ts';
import { createApp } from '../../server/app.ts';
import { openPglite, type Sql } from '../../server/db.ts';
import { db } from '../db/db';
import { seedDemoData } from '../db/seed';
import { DEFAULT_SETTINGS, type FinanceData } from '../db/types';
import { resetDb } from '../test/utils';
import { requestCode, verifyCode } from '../sync/account';
import { api } from '../sync/client';
import { resetSyncEngine } from '../sync/engine';
import { balanceDifference, banksAvailable, mapBankAccount, matchBankBalance, refreshConnection, syncBanks } from './banks';

let sql: Sql;
const codes = new Map<string, string>();

async function load(): Promise<FinanceData> {
  const [
    accounts,
    categories,
    transactions,
    recurring,
    budgets,
    rules,
    aliases,
    importBatches,
    goals,
    bankConnections,
    people,
    ious,
    settings,
  ] = await Promise.all([
    db.accounts.toArray(),
    db.categories.toArray(),
    db.transactions.orderBy('date').reverse().toArray(),
    db.recurring.toArray(),
    db.budgets.toArray(),
    db.rules.toArray(),
    db.payeeAliases.toArray(),
    db.importBatches.toArray(),
    db.goals.toArray(),
    db.bankConnections.toArray(),
    db.people.toArray(),
    db.ious.toArray(),
    db.settings.get('app'),
  ]);
  return {
    accounts,
    categories,
    transactions,
    recurring,
    budgets,
    rules,
    aliases,
    importBatches,
    goals,
    bankConnections,
    people,
    ious,
    settings: { ...DEFAULT_SETTINGS, ...settings },
  };
}

beforeAll(async () => {
  sql = await openPglite();
});
afterAll(async () => {
  vi.unstubAllGlobals();
  await sql.close();
});
beforeEach(async () => {
  await sql.query('TRUNCATE users, email_codes, challenges CASCADE');
  const app = createApp({
    sql,
    mailer: { sendCode: async (email, code) => void codes.set(email, code) },
    banks: sandboxProvider(),
    config: { rpID: 'localhost', rpName: 'Mizan', origins: ['http://localhost'] },
  });
  vi.stubGlobal('fetch', (input: string, init?: RequestInit) => app.request(input, init));
  await resetDb();
  resetSyncEngine();
  await seedDemoData('2026-10-14');
  await requestCode('sam@example.com');
  await verifyCode('sam@example.com', codes.get('sam@example.com')!);
});

describe('bank connections', () => {
  it('imports bank transactions once, through rules and duplicate checks', async () => {
    expect(await banksAvailable()).toBe(true);
    const token = (await db.syncState.get('sync'))!.token;
    const { id } = await api<{ id: string }>('/banks/links', {
      body: { institutionId: 'SANDBOX_LEDGER', institutionName: 'Sandbox Bank', returnTo: 'http://localhost/settings/banks' },
      token,
    });
    const conn = (await refreshConnection(id))!;
    expect(conn.status).toBe('linked');
    expect(conn.accounts[0]).toMatchObject({ bankAccountId: 'sbx-current', name: 'Sandbox current account' });

    // Nothing is imported until the bank account is mapped to a Mizan account.
    expect(await syncBanks(await load(), true)).toBe(0);
    await mapBankAccount(id, 'sbx-current', 'current');
    const before = await db.transactions.count();
    const added = await syncBanks(await load(), true);
    expect(added).toBeGreaterThan(30);
    expect(await db.transactions.count()).toBe(before + added);
    const pret = (await db.transactions.toArray()).find((t) => t.rawPayee === 'PRET A MANGER LONDON')!;
    expect(pret.externalId).toMatch(/^sbx-/);
    expect(pret.payee).not.toBe('PRET A MANGER LONDON'); // tidied up like a CSV import

    // Running again adds nothing: the bank's ids are remembered.
    expect(await syncBanks(await load(), true)).toBe(0);

    // The bank's balance can be matched.
    const data = await load();
    const entry = data.bankConnections[0].accounts[0];
    const diff = balanceDifference(data, 'current', entry.bankBalance)!;
    expect(diff).not.toBe(0);
    await matchBankBalance(
      data.accounts.find((a) => a.id === 'current')!,
      diff,
    );
    expect(balanceDifference(await load(), 'current', entry.bankBalance)).toBe(0);
  });
});
