/** Splitting with friends: balances, equal shares and payment-request links. */
import type { Iou, Person } from '../db/types';
import type { Pence } from './money';

/** What each person owes you (positive) or you owe them (negative). */
export function balances(people: Person[], ious: Iou[]): Map<string, Pence> {
  const out = new Map<string, Pence>(people.map((p) => [p.id, 0]));
  for (const i of ious) out.set(i.personId, (out.get(i.personId) ?? 0) + i.amount);
  return out;
}

/**
 * Equal shares of `total` among you and `count` others. Pennies that do not divide go to you,
 * so friends are never asked for more than their share. Returns each friend's share.
 */
export function equalShare(total: Pence, count: number): Pence {
  return count > 0 ? Math.floor(total / (count + 1)) : 0;
}

/**
 * A link to request money. Monzo.me and PayPal.me accept the amount in the link; other links
 * (Revolut, bank apps) open as they are.
 */
export function requestLink(payLink: string, amount: Pence): string {
  const base = payLink.replace(/\/+$/, '');
  const value = (amount / 100).toFixed(2);
  if (/^https:\/\/monzo\.me\//i.test(base)) return `${base}/${value}`;
  if (/^https:\/\/(www\.)?paypal\.me\//i.test(base)) return `${base}/${value}`;
  return base;
}
