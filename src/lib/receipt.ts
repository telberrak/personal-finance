/**
 * Reads the amount, date and shop from a receipt's text (from on-device OCR). Receipts are messy,
 * so every field is a suggestion the person confirms.
 */
import { addDays, type ISODate } from './dates';
import { findMerchant } from './merchants';
import type { Pence } from './money';
import { normaliseNumber } from './money';

/** What could be read from a receipt: total, date and shop name. */
export interface ReceiptGuess {
  amount?: Pence;
  date?: ISODate;
  merchant?: string;
}

const MONEY = /(?:£|€|\$|EUR|GBP)?\s*(\d{1,5}(?:[.,\s]\d{3})*[.,]\d{2})(?!\d)/g;
const TOTAL = /\b(total|amount due|balance due|to pay|sum|grand total|card|visa|mastercard|contactless|montant|à payer|المجموع)\b/i;
const NOT_TOTAL = /\b(sub-?total|vat|tax|change|saving|discount|points|cash back)\b/i;
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

function amountsIn(line: string): Pence[] {
  return [...line.matchAll(MONEY)].flatMap((m) => {
    const n = normaliseNumber(m[1]);
    return n ? [Math.round(Number(n) * 100)] : [];
  });
}

function dateIn(text: string, ref: ISODate): ISODate | undefined {
  const pad = (n: number) => String(n).padStart(2, '0');
  const valid = (y: number, m: number, d: number) => {
    if (m < 1 || m > 12 || d < 1 || d > 31) return undefined;
    const iso = `${y}-${pad(m)}-${pad(d)}`;
    // A receipt is from the past (allow a day for time zones), and not from long ago.
    return iso <= addDays(ref, 1) && iso >= addDays(ref, -730) ? iso : undefined;
  };
  for (const m of text.matchAll(/\b(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b/g)) {
    const d = valid(+m[1], +m[2], +m[3]);
    if (d) return d;
  }
  for (const m of text.matchAll(/\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})\b/g)) {
    const year = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    const d = valid(year, +m[2], +m[1]); // day first, as in the UK and France
    if (d) return d;
  }
  for (const m of text.matchAll(/\b(\d{1,2})\s+([a-z]{3})[a-z]*\.?\s+(\d{2,4})\b/gi)) {
    const month = MONTHS.indexOf(m[2].toLowerCase()) + 1;
    const year = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    const d = month ? valid(year, month, +m[1]) : undefined;
    if (d) return d;
  }
  return undefined;
}

/**
 * Finds the total, date and shop in OCR text from a receipt. Dates more than a day ahead or two years back
 * are ignored.
 */
export function parseReceipt(text: string, ref: ISODate): ReceiptGuess {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  // The total: the last amount on a "total" line, else the largest amount on the receipt.
  const totals = lines.filter((l) => TOTAL.test(l) && !NOT_TOTAL.test(l)).flatMap(amountsIn);
  const all = lines.flatMap(amountsIn);
  const amount = totals.length ? totals[totals.length - 1] : all.length ? Math.max(...all) : undefined;
  const known = findMerchant(lines.slice(0, 6).join(' '));
  const firstWords = lines.find((l) => /[a-z]{3,}/i.test(l) && !/\d{3,}/.test(l));
  return { amount: amount && amount > 0 ? amount : undefined, date: dateIn(text, ref), merchant: known?.name ?? firstWords };
}
