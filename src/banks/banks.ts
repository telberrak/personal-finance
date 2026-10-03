/**
 * Bank connections on the device: connect, map bank accounts to Mizan accounts, and bring
 * transactions in through the same pipeline as CSV imports (tidy payees, rules, bills, duplicates).
 * Needs a sync account, because the provider's keys live on the server.
 */
import { useEffect, useRef } from 'react';
import type { BankAccount, BankLink, BankTransaction, Institution } from '../../shared/api.ts';
import { db } from '../db/db';
import { importTransactions, saveAccount } from '../db/repo';
import type { Account, BankConnection, FinanceData } from '../db/types';
import { addDays, today } from '../lib/dates';
import { prepareRows } from '../lib/importPrep';
import { accountBalance } from '../lib/selectors';
import { api, SyncApiError } from '../sync/client';

const SYNC_EVERY_MS = 6 * 3_600_000;

async function token(): Promise<string> {
  const s = await db.syncState.get('sync');
  if (!s?.token) throw new SyncApiError(401, 'signed out');
  return s.token;
}

export async function banksAvailable(): Promise<boolean> {
  const s = await db.syncState.get('sync');
  if (!s?.token || !s.syncKey) return false;
  const res = await api<{ available: boolean }>('/banks/available', { token: s.token }).catch(() => ({ available: false }));
  return res.available;
}

export const listInstitutions = async (country: string) =>
  api<Institution[]>(`/banks/institutions?country=${country}`, { token: await token() });

/** Starts consent at the bank; the browser goes there and comes back to the Banks page. */
export async function connectBank(institution: Institution, language: string): Promise<void> {
  const { id, url } = await api<{ id: string; url: string }>('/banks/links', {
    body: {
      institutionId: institution.id,
      institutionName: institution.name,
      returnTo: `${window.location.origin}/settings/banks`,
      language,
    },
    token: await token(),
  });
  await db.bankConnections.put({
    id,
    institutionName: institution.name,
    status: 'pending',
    expiresAt: new Date(Date.now() + 90 * 86_400_000).toISOString(),
    accounts: [],
  });
  window.location.assign(url);
}

/** After the bank sends you back (or any time): status, expiry and the accounts shared. */
export async function refreshConnection(id: string): Promise<BankConnection | undefined> {
  const auth = await token();
  const [{ status, accounts }, links] = await Promise.all([
    api<{ status: BankConnection['status']; accounts: BankAccount[] }>(`/banks/links/${encodeURIComponent(id)}/accounts`, { token: auth }),
    api<BankLink[]>('/banks/links', { token: auth }),
  ]);
  const existing = await db.bankConnections.get(id);
  const link = links.find((l) => l.id === id);
  if (!link) return undefined;
  const merged: BankConnection = {
    id,
    institutionName: link.institutionName,
    status,
    expiresAt: link.expiresAt,
    accounts: accounts.length
      ? accounts.map((a) => {
          const old = existing?.accounts.find((x) => x.bankAccountId === a.id);
          return {
            bankAccountId: a.id,
            name: a.name,
            mask: a.mask,
            accountId: old?.accountId,
            lastSyncedAt: old?.lastSyncedAt,
            bankBalance: a.balance,
          };
        })
      : (existing?.accounts ?? []),
  };
  await db.bankConnections.put(merged);
  return merged;
}

/** Chooses which Mizan account a bank account's transactions go into (undefined: none). */
export async function mapBankAccount(connectionId: string, bankAccountId: string, accountId: string | undefined): Promise<void> {
  const conn = await db.bankConnections.get(connectionId);
  if (!conn) return;
  await db.bankConnections.put({
    ...conn,
    accounts: conn.accounts.map((a) => (a.bankAccountId === bankAccountId ? { ...a, accountId } : a)),
  });
}

export async function disconnectBank(id: string): Promise<void> {
  await api(`/banks/links/${encodeURIComponent(id)}`, { method: 'DELETE', token: await token() }).catch((err) => {
    if (!(err instanceof SyncApiError && err.status === 404)) throw err;
  });
  await db.bankConnections.delete(id);
}

/** Imports new transactions for one mapped bank account. Returns how many were added. */
async function syncAccount(data: FinanceData, conn: BankConnection, bankAccountId: string): Promise<number> {
  const entry = conn.accounts.find((a) => a.bankAccountId === bankAccountId);
  if (!entry?.accountId) return 0;
  // A few days of overlap catches transactions the bank books late; duplicates are skipped.
  const from = entry.lastSyncedAt
    ? addDays(today(), -Math.ceil((Date.now() - entry.lastSyncedAt) / 86_400_000) - 5)
    : addDays(today(), -89);
  const res = await api<{ transactions: BankTransaction[]; balance: number | null }>(
    `/banks/links/${encodeURIComponent(conn.id)}/accounts/${encodeURIComponent(bankAccountId)}/transactions?from=${from}`,
    { token: await token() },
  );
  const rows = prepareRows(
    data,
    entry.accountId,
    res.transactions.map((t) => ({ date: t.date, amount: t.amount, rawPayee: t.description || conn.institutionName, externalId: t.id })),
  ).filter((r) => !r.duplicate);
  if (rows.length) await importTransactions(entry.accountId, conn.institutionName, rows);
  const fresh = (await db.bankConnections.get(conn.id)) ?? conn;
  await db.bankConnections.put({
    ...fresh,
    accounts: fresh.accounts.map((a) =>
      a.bankAccountId === bankAccountId ? { ...a, lastSyncedAt: Date.now(), bankBalance: res.balance } : a,
    ),
  });
  return rows.length;
}

/** Brings in new transactions for every mapped account. */
export async function syncBanks(data: FinanceData, force = false): Promise<number> {
  let added = 0;
  for (const conn of data.bankConnections) {
    if (conn.status !== 'linked' || new Date(conn.expiresAt).getTime() < Date.now()) continue;
    for (const a of conn.accounts) {
      if (!a.accountId || (!force && a.lastSyncedAt && Date.now() - a.lastSyncedAt < SYNC_EVERY_MS)) continue;
      try {
        added += await syncAccount(data, conn, a.bankAccountId);
      } catch (err) {
        if (err instanceof SyncApiError && err.status === 400) await db.bankConnections.update(conn.id, { status: 'expired' });
        else throw err;
      }
    }
  }
  return added;
}

/** Runs bank sync in the background while unlocked: at start and every few hours. */
export function useBankAutoSync(data: FinanceData | undefined) {
  const latest = useRef(data);
  useEffect(() => {
    latest.current = data;
  });
  const has = !!data?.bankConnections.some((c) => c.status === 'linked' && c.accounts.some((a) => a.accountId));
  useEffect(() => {
    if (!has) return;
    const run = () => void (latest.current && syncBanks(latest.current).catch(() => undefined));
    run();
    const id = window.setInterval(run, SYNC_EVERY_MS);
    return () => window.clearInterval(id);
  }, [has]);
}

/** Bank balance minus Mizan's balance for the account, when the bank reported one. */
export function balanceDifference(data: FinanceData, accountId: string, bankBalance: number | null | undefined): number | null {
  const account = data.accounts.find((a) => a.id === accountId);
  // Foreign-currency accounts are converted for totals, so they are not compared here.
  if (!account || account.native || bankBalance === null || bankBalance === undefined) return null;
  return bankBalance - accountBalance(account, data.transactions);
}

/** Makes Mizan's balance match the bank's by adjusting the account's opening balance. */
export async function matchBankBalance(account: Account, difference: number): Promise<void> {
  await saveAccount({ ...account, openingBalance: account.openingBalance + difference });
}
