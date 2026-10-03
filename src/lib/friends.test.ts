import { describe, expect, it } from 'vitest';
import { balances, equalShare, requestLink } from './friends';

describe('friends', () => {
  it('nets what is owed each way', () => {
    const people = [
      { id: 'a', name: 'Alex' },
      { id: 'b', name: 'Bea' },
    ];
    const owed = balances(people, [
      { id: '1', personId: 'a', date: '2026-10-01', amount: 2000 },
      { id: '2', personId: 'a', date: '2026-10-02', amount: -500 },
      { id: '3', personId: 'a', date: '2026-10-03', amount: -1500, settlement: true },
      { id: '4', personId: 'b', date: '2026-10-03', amount: -700 },
    ]);
    expect(owed.get('a')).toBe(0);
    expect(owed.get('b')).toBe(-700);
  });

  it('splits equally, rounding in friends’ favour', () => {
    expect(equalShare(1000, 2)).toBe(333); // you pay 334
    expect(equalShare(1000, 0)).toBe(0);
  });

  it('adds the amount to Monzo.me and PayPal.me links only', () => {
    expect(requestLink('https://monzo.me/alex/', 1250)).toBe('https://monzo.me/alex/12.50');
    expect(requestLink('https://paypal.me/alex', 1250)).toBe('https://paypal.me/alex/12.50');
    expect(requestLink('https://revolut.me/alex', 1250)).toBe('https://revolut.me/alex');
  });
});
