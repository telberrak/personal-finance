// @vitest-environment node
// Two people and a household, against the real server (PGlite in memory) in-process.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../server/app.ts';
import { openPglite, type Sql } from '../../server/db.ts';
import { db } from '../db/db';
import { addTransaction, saveCategory, setBudget, shareAccount } from '../db/repo';
import { seedDemoData } from '../db/seed';
import { resetDb } from '../test/utils';
import { joinWithRecoveryKey, requestCode, verifyCode } from './account';
import { resetSyncEngine, syncNow } from './engine';
import { createHousehold, inviteLink, joinHousehold, leaveHousehold, parseInvitation } from './household';

let sql: Sql;
const codes = new Map<string, string>();

beforeAll(async () => {
  sql = await openPglite();
  vi.stubGlobal('window', { location: { origin: 'http://localhost' } });
});
afterAll(async () => {
  vi.unstubAllGlobals();
  await sql.close();
});
beforeEach(async () => {
  await sql.query('TRUNCATE users, email_codes, challenges, spaces CASCADE');
  const app = createApp({
    sql,
    mailer: { sendCode: async (e, c) => void codes.set(e, c) },
    config: { rpID: 'localhost', rpName: 'Mizan', origins: ['http://localhost'] },
  });
  vi.stubGlobal('fetch', (input: string, init?: RequestInit) => app.request(input, init));
});

async function device(email: string) {
  await resetDb();
  resetSyncEngine();
  await requestCode(email);
  return verifyCode(email, codes.get(email)!);
}

describe('households', () => {
  it('share chosen accounts both ways, keep the rest private, and part cleanly', async () => {
    // Alex: demo data, shares the current account.
    const alex = await device('alex@example.com');
    await seedDemoData('2026-10-14');
    const alexKey = alex.kind === 'created' ? alex.recoveryKey : '';
    const alexId = (await db.syncState.get('sync'))!.userId;
    const space = await createHousehold('Home');
    await shareAccount('current', space, alexId);
    const link = await inviteLink(space);
    expect(link).toMatch(/^http:\/\/localhost\/join#[0-9a-f-]{36}\./);
    await syncNow();
    const sharedCount = await db.transactions.where('accountId').equals('current').count();

    // The server holds the household's records only as ciphertext.
    expect(JSON.stringify(await sql.query('SELECT blob FROM space_records'))).not.toMatch(/Tesco|Current account/);

    // Sam joins from the link on a fresh device: sees the shared account, not Alex's savings.
    await device('sam@example.com');
    await joinHousehold(parseInvitation(link.split('#')[1])!);
    expect(await db.accounts.get('current')).toMatchObject({ spaceId: space, ownerId: alexId });
    expect(await db.accounts.get('savings')).toBeUndefined();
    expect(await db.transactions.where('accountId').equals('current').count()).toBe(sharedCount);
    const fromSam = await addTransaction({
      accountId: 'current',
      date: '2026-10-14',
      amount: -1850,
      payee: 'Takeaway',
      categoryId: 'eating',
    });
    expect((await db.transactions.get(fromSam))?.spaceId).toBe(space);
    await syncNow();

    // Back on Alex's devices: Sam's transaction arrives.
    await device('alex@example.com');
    await joinWithRecoveryKey(alexKey);
    await syncNow(); // household key arrives in the first pass; its records in the next
    expect(await db.transactions.get(fromSam)).toMatchObject({ payee: 'Takeaway', spaceId: space });
    expect(await db.accounts.get('savings')).toBeDefined();

    // Alex leaves: the account is Alex's, so it stays (private again).
    await leaveHousehold(space);
    expect(await db.accounts.get('current')).toMatchObject({ spaceId: undefined });
    expect(await db.spaceKeys.count()).toBe(0);
  });

  it('shares custom categories and household budgets, but not personal budgets', async () => {
    const alex = await device('alex@example.com');
    await seedDemoData('2026-10-14');
    const alexKey = alex.kind === 'created' ? alex.recoveryKey : '';
    const alexId = (await db.syncState.get('sync'))!.userId;
    const space = await createHousehold('Home');
    await shareAccount('current', space, alexId);
    // A custom category on a shared transaction, a private custom category, and two budgets.
    const kids = await saveCategory({ name: 'Kids', color: 'fun', kind: 'expense' });
    const hobby = await saveCategory({ name: 'Secret hobby', color: 'fun', kind: 'expense' });
    await addTransaction({ accountId: 'current', date: '2026-10-14', amount: -2500, payee: 'School trip', categoryId: kids });
    await addTransaction({ accountId: 'savings', date: '2026-10-14', amount: -900, payee: 'Shop', categoryId: hobby });
    await setBudget('groceries', 40000, space);
    await setBudget(hobby, 5000);
    const link = await inviteLink(space);
    await syncNow();

    // Sam sees the shared category by name and the household budget; nothing private.
    await device('sam@example.com');
    await joinHousehold(parseInvitation(link.split('#')[1])!);
    expect(await db.categories.get(kids)).toMatchObject({ name: 'Kids' });
    expect(await db.categories.get(hobby)).toBeUndefined();
    expect(await db.budgets.toArray()).toEqual([expect.objectContaining({ categoryId: 'groceries', monthlyLimit: 40000, spaceId: space })]);

    // Sam renames the shared category and changes the household budget.
    await saveCategory({ id: kids, name: 'Children', color: 'fun', kind: 'expense' });
    await setBudget('groceries', 45000, space);
    await setBudget(kids, 10000, space);
    await syncNow();

    await device('alex@example.com');
    await joinWithRecoveryKey(alexKey);
    await syncNow();
    expect(await db.categories.get(kids)).toMatchObject({ name: 'Children' });
    const household = (await db.budgets.toArray()).filter((b) => b.spaceId === space);
    expect(household).toHaveLength(2);
    expect(household).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ categoryId: 'groceries', monthlyLimit: 45000 }),
        expect.objectContaining({ categoryId: kids, monthlyLimit: 10000 }),
      ]),
    );
    expect((await db.budgets.toArray()).find((b) => b.categoryId === hobby && !b.spaceId)).toBeDefined();

    // Leaving drops the household's budgets but keeps its categories.
    await leaveHousehold(space);
    expect((await db.budgets.toArray()).filter((b) => b.spaceId)).toEqual([]);
    expect(await db.categories.get(kids)).toBeDefined();
  });

  it('rejects malformed invitations', () => {
    expect(parseInvitation('#nonsense')).toBeNull();
    expect(parseInvitation('#00000000-0000-0000-0000-000000000000.tok.short.Home')).toBeNull();
  });
});
