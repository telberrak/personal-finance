import { describe, expect, it } from 'vitest';
import type { Transaction } from '../db/types';
import { learnedCategory } from './learn';
import { findMerchant, MERCHANT_COUNT } from './merchants';
import { suggestCategory } from './rules';

const tx = (payee: string, categoryId: string, i = 0): Transaction => ({
  id: `${payee}${i}`,
  accountId: 'a',
  date: '2026-10-01',
  amount: -500,
  payee,
  categoryId,
});
const allowed = new Set(['groceries', 'eating', 'transport', 'shopping', 'bills', 'fun']);

describe('merchant directory', () => {
  it('recognises messy bank descriptions', () => {
    expect(MERCHANT_COUNT).toBeGreaterThan(100);
    expect(findMerchant('AMZN MKTP UK*2X4AB12')).toMatchObject({ name: 'Amazon', categoryId: 'shopping' });
    expect(findMerchant('TFL TRAVEL CH')).toMatchObject({ name: 'TfL', categoryId: 'transport' });
    expect(findMerchant('UBER EATS LONDON')).toMatchObject({ name: 'Uber Eats', categoryId: 'eating' });
    expect(findMerchant('UBER *TRIP')).toMatchObject({ name: 'Uber', categoryId: 'transport' });
    expect(findMerchant('Corner Deli')).toBeUndefined();
    expect(findMerchant('Bespoke Tailors')).toBeUndefined(); // "bp" only as a whole word
  });
});

describe('learning from your categories', () => {
  const history = [
    ...[0, 1, 2].map((i) => tx('Smith Deli', 'eating', i)),
    ...[0, 1].map((i) => tx('Market Deli', 'eating', i)),
    ...[0, 1, 2].map((i) => tx('Hardware Store', 'shopping', i)),
    ...[0, 1].map((i) => tx('Local Store Hardware', 'shopping', i)),
  ];

  it('suggests from similar payees', () => {
    expect(learnedCategory('Corner Deli', history, allowed)?.categoryId).toBe('eating');
    expect(learnedCategory('City Hardware', history, allowed)?.categoryId).toBe('shopping');
    expect(learnedCategory('Totally New', history, allowed)).toBeUndefined();
  });

  it('comes after rules, exact history and the merchant directory', () => {
    expect(suggestCategory('Corner Deli', [], history, allowed)).toBe('eating');
    // The directory says Tesco is groceries even though your history has no Tesco.
    expect(suggestCategory('TESCO STORES 3297', [], history, allowed)).toBe('groceries');
    // Your own past choice for the exact payee beats the directory.
    expect(suggestCategory('Tesco', [], [tx('Tesco', 'shopping')], allowed)).toBe('shopping');
  });
});
