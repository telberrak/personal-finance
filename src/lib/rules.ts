import { learnedCategory } from './learn';
import { findMerchant } from './merchants';
import type { Rule, Transaction } from '../db/types';
import { payeeKey } from './payees';

export function ruleMatches(rule: Rule, payee: string): boolean {
  const p = payee.toLowerCase().trim();
  const q = rule.pattern.toLowerCase().trim();
  if (!q) return false;
  switch (rule.match) {
    case 'contains':
      return p.includes(q);
    case 'startsWith':
      return p.startsWith(q);
    case 'exact':
      return p === q;
  }
}

/** The first matching rule, lowest priority number first. */
export function findRule(rules: Rule[], payee: string): Rule | undefined {
  return [...rules].sort((a, b) => a.priority - b.priority).find((r) => ruleMatches(r, payee));
}

/**
 * Category for a payee, in order of trust: an explicit rule, the category last used for the same
 * payee, the merchant directory, then what the on-device learner infers from similar payees.
 * `allowed` limits the answer to categories that fit (e.g. expense categories for money out).
 */
export function suggestCategory(payee: string, rules: Rule[], history: Transaction[], allowed: Set<string>): string | undefined {
  const rule = findRule(
    rules.filter((r) => allowed.has(r.categoryId)),
    payee,
  );
  if (rule) return rule.categoryId;
  const key = payeeKey(payee);
  if (!key) return undefined;
  // history is newest first
  const previous = history.find((t) => !t.transferId && allowed.has(t.categoryId) && payeeKey(t.payee) === key)?.categoryId;
  if (previous) return previous;
  const merchant = findMerchant(payee);
  if (merchant && allowed.has(merchant.categoryId)) return merchant.categoryId;
  return learnedCategory(payee, history, allowed)?.categoryId;
}
