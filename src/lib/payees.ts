/**
 * Payee names: cleaning bank descriptions ("CARD PAYMENT TO TESCO STORES 2041") into readable names, and
 * applying the user's renames.
 */
import type { PayeeAlias } from '../db/types';

const PREFIXES =
  /^(card payment to|card payment|contactless payment|contactless|direct debit to|direct debit|standing order to|standing order|faster payment to|faster payments|bill payment to|debit card|pos|vis|dd|so|fpo|bgc|deb|bp)\s+/i;
const SMALL_WORDS = new Set(['a', 'an', 'and', 'of', 'the', 'to', 'at', 'in', 'on', 'for']);

function titleCase(s: string): string {
  return s
    .toLowerCase()
    .split(' ')
    .map((w, i) => (i > 0 && SMALL_WORDS.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ')
    .replace(/'S\b/g, "'s");
}

/**
 * Cleans a bank statement description into a readable payee:
 * "CARD PAYMENT TO TESCO STORES 3297 ON 12/10 GB" → "Tesco Stores".
 */
export function normalisePayee(raw: string): string {
  let s = raw.replace(/\s+/g, ' ').trim();
  s = s.replace(PREFIXES, '');
  s = s.replace(/\s+on\s+\d{1,2}[/.-]\d{1,2}([/.-]\d{2,4})?.*$/i, ''); // "ON 12/10" and everything after
  s = s.replace(/[*#]\S*/g, ' '); // "AMZN MKTP UK*2X4AB12" → "AMZN MKTP UK"
  s = s.replace(/\b[A-Z]*\d[A-Z\d]{3,}\b/gi, ' '); // references and store numbers: 3297, 4X2B9Q
  s = s.replace(/(\s+(gb|gbr|uk|london))+\s*$/i, ''); // trailing country/city codes
  s = s.replace(/\s{2,}/g, ' ').trim();
  if (s && s === s.toUpperCase()) s = titleCase(s);
  return s || raw.trim();
}

/** Comparison key: lower case letters and digits only. */
export function payeeKey(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** The payee's display name: the user's rename if one matches, otherwise the cleaned name. */
export function applyAlias(payee: string, aliases: PayeeAlias[]): string {
  const key = payeeKey(payee);
  return aliases.find((a) => a.from === key)?.to ?? payee;
}

/** True when two payees probably refer to the same merchant ("Netflix.com" and "NETFLIX"). */
export function payeesSimilar(a: string, b: string): boolean {
  const ka = payeeKey(a);
  const kb = payeeKey(b);
  if (!ka || !kb) return false;
  if (ka === kb || ka.includes(kb) || kb.includes(ka)) return true;
  const words = new Set(ka.split(' ').filter((w) => w.length > 3));
  return kb.split(' ').some((w) => w.length > 3 && words.has(w));
}
