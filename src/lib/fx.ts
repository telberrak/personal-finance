/**
 * Multi-currency. Accounts may hold another currency than your home currency (Settings →
 * Currency). Their amounts are stored as they are, and converted to the home currency for
 * everything that adds up across accounts: balances, safe to spend, budgets, reports, net worth.
 * Conversion uses the latest rate (not the rate on each day), which keeps totals simple and
 * explainable.
 */
import type { Account, FinanceData, Transaction } from '../db/types';
import type { ISODate } from './dates';
import type { Pence } from './money';

export interface FxRate {
  /** Home-currency units for one unit of the currency, e.g. 0.86 GBP per EUR. */
  rate: number;
  date: ISODate;
  /** Typed in by you rather than fetched. */
  manual?: boolean;
}
export type FxRates = Record<string, FxRate>;

/** Original values of a converted record (view only, never stored). */
export interface Native {
  currency: string;
  amount?: Pence;
  openingBalance?: Pence;
  valuations?: { date: ISODate; value: Pence }[];
  credit?: Account['credit'];
  monthlyPayment?: Pence;
}

export function convert(amount: Pence, from: string, home: string, rates: FxRates | undefined): Pence {
  if (from === home) return amount;
  const rate = rates?.[from]?.rate;
  return rate ? Math.round(amount * rate) : amount;
}

/** Currencies used by accounts (and foreign purchases) other than the home currency. */
export function foreignCurrencies(data: Pick<FinanceData, 'accounts' | 'transactions' | 'settings'>): string[] {
  const home = data.settings.currency;
  const set = new Set<string>();
  for (const a of data.accounts) if (a.currency && a.currency !== home) set.add(a.currency);
  for (const t of data.transactions) if (t.foreign && t.foreign.currency !== home) set.add(t.foreign.currency);
  return [...set].sort();
}

/**
 * The data with every foreign-currency account and its transactions expressed in the home
 * currency. Originals stay available on `native`, for display and for editing.
 */
export function inHomeCurrency(data: FinanceData): FinanceData {
  const home = data.settings.currency;
  const rates = data.settings.fxRates;
  const foreign = new Map(data.accounts.filter((a) => a.currency && a.currency !== home).map((a) => [a.id, a.currency!]));
  if (!foreign.size) return data;
  const c = (amount: Pence | undefined, currency: string) => (amount === undefined ? undefined : convert(amount, currency, home, rates));
  const accounts = data.accounts.map((a): Account => {
    const currency = foreign.get(a.id);
    if (!currency) return a;
    return {
      ...a,
      openingBalance: c(a.openingBalance, currency)!,
      valuations: a.valuations?.map((v) => ({ ...v, value: c(v.value, currency)! })),
      credit: a.credit && { ...a.credit, limit: c(a.credit.limit, currency), minPayment: c(a.credit.minPayment, currency) },
      monthlyPayment: c(a.monthlyPayment, currency),
      native: { currency, openingBalance: a.openingBalance, valuations: a.valuations, credit: a.credit, monthlyPayment: a.monthlyPayment },
    };
  });
  const transactions = data.transactions.map((t): Transaction => {
    const currency = foreign.get(t.accountId);
    return currency ? { ...t, amount: c(t.amount, currency)!, native: { currency, amount: t.amount } } : t;
  });
  return { ...data, accounts, transactions };
}

/** An account's balance in its own currency. */
export function nativeBalance(account: Account, transactions: Transaction[]): Pence {
  if (!account.native) return transactions.reduce((s, t) => (t.accountId === account.id ? s + t.amount : s), account.openingBalance);
  const latest = account.native.valuations?.length
    ? [...account.native.valuations].sort((a, b) => (a.date < b.date ? -1 : 1)).at(-1)
    : undefined;
  return transactions.reduce(
    (s, t) => (t.accountId === account.id && (!latest || t.date > latest.date) ? s + (t.native?.amount ?? t.amount) : s),
    latest ? latest.value : (account.native.openingBalance ?? 0),
  );
}

/**
 * Rates from the European Central Bank's daily reference rates (via the sync server), expressed
 * per unit of each currency in the home currency. Manual rates are kept.
 */
export function ratesFromEcb(
  ecb: { date: ISODate; rates: Record<string, number> },
  home: string,
  wanted: string[],
  previous: FxRates | undefined,
): FxRates {
  const perEuro = { EUR: 1, ...ecb.rates };
  const out: FxRates = { ...previous };
  for (const cur of wanted) {
    if (previous?.[cur]?.manual) continue;
    if (!perEuro[cur as keyof typeof perEuro] || !perEuro[home as keyof typeof perEuro]) continue;
    out[cur] = { rate: perEuro[home as keyof typeof perEuro] / perEuro[cur as keyof typeof perEuro], date: ecb.date };
  }
  return out;
}
