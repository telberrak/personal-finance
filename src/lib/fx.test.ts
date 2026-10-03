import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type FinanceData } from '../db/types';
import { convert, foreignCurrencies, inHomeCurrency, nativeBalance, ratesFromEcb } from './fx';
import { totalBalance } from './selectors';

const data = (): FinanceData => ({
  accounts: [
    { id: 'gb', name: 'Current', type: 'current', openingBalance: 100_000, includeInSafeToSpend: true },
    { id: 'eu', name: 'Euro account', type: 'current', openingBalance: 50_000, includeInSafeToSpend: true, currency: 'EUR' },
  ],
  categories: [],
  transactions: [
    { id: 't1', accountId: 'eu', date: '2026-10-01', amount: -10_000, payee: 'Café', categoryId: 'eating' },
    {
      id: 't2',
      accountId: 'gb',
      date: '2026-10-01',
      amount: -2_000,
      payee: 'Tesco',
      categoryId: 'groceries',
      foreign: { amount: 2_300, currency: 'EUR' },
    },
  ],
  recurring: [],
  budgets: [],
  rules: [],
  aliases: [],
  importBatches: [],
  goals: [],
  bankConnections: [],
  people: [],
  ious: [],
  settings: { ...DEFAULT_SETTINGS, currency: 'GBP', fxRates: { EUR: { rate: 0.86, date: '2026-10-02' } } },
});

describe('multi-currency', () => {
  it('adds up accounts in the home currency, keeping the originals', () => {
    const view = inHomeCurrency(data());
    expect(totalBalance(view, 'all')).toBe(100_000 - 2_000 + Math.round((50_000 - 10_000) * 0.86));
    const eu = view.accounts.find((a) => a.id === 'eu')!;
    expect(eu.native).toMatchObject({ currency: 'EUR', openingBalance: 50_000 });
    expect(nativeBalance(eu, view.transactions)).toBe(40_000);
    expect(view.transactions.find((t) => t.id === 't1')).toMatchObject({ amount: -8_600, native: { amount: -10_000, currency: 'EUR' } });
  });

  it('leaves everything alone when all accounts use the home currency, and lists foreign currencies', () => {
    const d = data();
    d.accounts[1].currency = undefined;
    expect(inHomeCurrency(d)).toBe(d);
    expect(foreignCurrencies(data())).toEqual(['EUR']);
    expect(convert(1000, 'USD', 'GBP', {})).toBe(1000); // no rate: unchanged rather than zero
  });

  it('turns ECB euro rates into home-currency rates, keeping manual ones', () => {
    const rates = ratesFromEcb({ date: '2026-10-02', rates: { GBP: 0.86, USD: 1.08 } }, 'GBP', ['EUR', 'USD', 'MAD'], {
      MAD: { rate: 0.079, date: '2026-09-01', manual: true },
    });
    expect(rates.EUR.rate).toBeCloseTo(0.86);
    expect(rates.USD.rate).toBeCloseTo(0.86 / 1.08);
    expect(rates.MAD).toEqual({ rate: 0.079, date: '2026-09-01', manual: true });
  });
});
