import type { Transaction } from '../db/types';
import { toISO, type ISODate } from './dates';
import type { Pence } from './money';
import { payeeKey } from './payees';

export type DateFormat = 'dmy' | 'mdy' | 'ymd';

export interface ColumnMapping {
  hasHeader: boolean;
  date: number;
  description: number;
  /** One signed amount column… */
  amount?: number;
  /** …or separate money-in and money-out columns. */
  moneyIn?: number;
  moneyOut?: number;
  dateFormat: DateFormat;
  /** Some banks export money out as positive numbers. */
  invertAmount: boolean;
}

export interface BankPreset {
  id: string;
  name: string;
  /** Header cells, lower-cased, that identify this bank's export. */
  signature: string[];
  build: (header: string[]) => Partial<ColumnMapping>;
}

const col = (header: string[], ...names: string[]) => {
  const lower = header.map((h) => h.toLowerCase().trim());
  for (const n of names) {
    const i = lower.indexOf(n);
    if (i >= 0) return i;
  }
  return undefined;
};

/** Common UK bank exports. Detected by their header row; anything else uses guessMapping. */
export const PRESETS: BankPreset[] = [
  {
    id: 'monzo',
    name: 'Monzo',
    signature: ['transaction id', 'date', 'name', 'amount'],
    build: (h) => ({ date: col(h, 'date'), description: col(h, 'name'), amount: col(h, 'amount'), dateFormat: 'dmy' }),
  },
  {
    id: 'starling',
    name: 'Starling',
    signature: ['date', 'counter party', 'amount (gbp)'],
    build: (h) => ({ date: col(h, 'date'), description: col(h, 'counter party'), amount: col(h, 'amount (gbp)'), dateFormat: 'dmy' }),
  },
  {
    id: 'barclays',
    name: 'Barclays',
    signature: ['number', 'date', 'account', 'amount', 'memo'],
    build: (h) => ({ date: col(h, 'date'), description: col(h, 'memo'), amount: col(h, 'amount'), dateFormat: 'dmy' }),
  },
  {
    id: 'lloyds',
    name: 'Lloyds / Halifax / Bank of Scotland',
    signature: ['transaction date', 'transaction description', 'debit amount', 'credit amount'],
    build: (h) => ({
      date: col(h, 'transaction date'),
      description: col(h, 'transaction description'),
      moneyOut: col(h, 'debit amount'),
      moneyIn: col(h, 'credit amount'),
      dateFormat: 'dmy',
    }),
  },
  {
    id: 'nationwide',
    name: 'Nationwide',
    signature: ['date', 'transaction type', 'description', 'paid out', 'paid in'],
    build: (h) => ({
      date: col(h, 'date'),
      description: col(h, 'description'),
      moneyOut: col(h, 'paid out'),
      moneyIn: col(h, 'paid in'),
      dateFormat: 'dmy',
    }),
  },
  {
    id: 'natwest',
    name: 'NatWest / RBS',
    signature: ['date', 'type', 'description', 'value', 'balance'],
    build: (h) => ({ date: col(h, 'date'), description: col(h, 'description'), amount: col(h, 'value'), dateFormat: 'dmy' }),
  },
];

export function detectPreset(header: string[]): BankPreset | undefined {
  const lower = new Set(header.map((h) => h.toLowerCase().trim()));
  return PRESETS.find((p) => p.signature.every((s) => lower.has(s)));
}

/** Best guess at the columns from header names, falling back to Date, Description, Amount. */
export function guessMapping(rows: string[][]): ColumnMapping {
  const first = rows[0] ?? [];
  const looksLikeHeader = first.length > 0 && !first.some((c) => parseAmount(c) !== null && /\d/.test(c) && !/[a-z]{3}/i.test(c));
  const base: ColumnMapping = { hasHeader: looksLikeHeader, date: 0, description: 1, amount: 2, dateFormat: 'dmy', invertAmount: false };
  if (!looksLikeHeader) return { ...base, dateFormat: guessDateFormat(rows.map((r) => r[0] ?? '')) };

  const preset = detectPreset(first);
  if (preset) {
    const built = preset.build(first);
    return { ...base, amount: undefined, ...stripUndefined(built), hasHeader: true };
  }

  const find = (re: RegExp) => {
    const i = first.findIndex((h) => re.test(h));
    return i >= 0 ? i : undefined;
  };
  const moneyOut = find(/paid out|debit|money out|withdraw/i);
  const moneyIn = find(/paid in|credit|money in|deposit/i);
  const amount = find(/^(amount|value)|amount/i);
  const date = find(/date/i) ?? 0;
  const mapping: ColumnMapping = {
    hasHeader: true,
    date,
    description: find(/desc|payee|name|memo|counter ?party|narrative|details|merchant|reference/i) ?? 1,
    dateFormat: guessDateFormat(rows.slice(1).map((r) => r[date] ?? '')),
    invertAmount: false,
  };
  if (moneyOut !== undefined && moneyIn !== undefined) return { ...mapping, moneyIn, moneyOut };
  return { ...mapping, amount: amount ?? 2 };
}

function stripUndefined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}

function guessDateFormat(samples: string[]): DateFormat {
  for (const s of samples) {
    const parts = s.split(/[/.\-\s]/).filter(Boolean);
    if (parts[0]?.length === 4) return 'ymd';
    if (Number(parts[1]) > 12) return 'mdy';
    if (Number(parts[0]) > 12) return 'dmy';
  }
  return 'dmy'; // UK default
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** Parses "12/10/2026", "12-10-26", "2026-10-12", "12 Oct 2026", "12-Oct-26" (and a trailing time). */
export function parseDate(input: string, format: DateFormat): ISODate | null {
  const s = input.trim().replace(/[T\s]\d{1,2}:\d{2}(:\d{2})?.*$/, '');
  const parts = s.split(/[/.\-\s]+/).filter(Boolean);
  if (parts.length !== 3) return null;
  let y: number, m: number, d: number;
  const monthName = parts.findIndex((p) => /^[a-z]{3,}$/i.test(p));
  if (monthName >= 0) {
    m = MONTHS.indexOf(parts[monthName].slice(0, 3).toLowerCase()) + 1;
    const rest = parts.filter((_, i) => i !== monthName).map(Number);
    [d, y] = rest[0] > 31 ? [rest[1], rest[0]] : [rest[0], rest[1]];
  } else {
    const n = parts.map(Number);
    if (parts[0].length === 4) [y, m, d] = n;
    else if (format === 'mdy') [m, d, y] = n;
    else if (format === 'ymd') [y, m, d] = n;
    else [d, m, y] = n;
  }
  if (y < 100) y += 2000;
  if (!m || m < 1 || m > 12 || !d || d < 1 || d > 31) return null;
  const date = new Date(y, m - 1, d);
  if (date.getMonth() !== m - 1) return null; // 31 Feb etc.
  return toISO(date);
}

/** "£1,234.50", "-12.00", "(12.00)", "12.00 DR", "12.00CR" → pence. Empty → null. */
export function parseAmount(input: string): Pence | null {
  let s = input.trim();
  if (!s) return null;
  let sign = 1;
  if (/^\(.*\)$/.test(s)) {
    sign = -1;
    s = s.slice(1, -1);
  }
  if (/\s*dr$/i.test(s)) {
    sign = -sign;
    s = s.replace(/\s*dr$/i, '');
  }
  s = s.replace(/\s*cr$/i, '');
  s = s.replace(/[£$€,\s]/g, '');
  if (s.startsWith('+')) s = s.slice(1);
  if (s.startsWith('-')) {
    sign = -sign;
    s = s.slice(1);
  }
  if (!/^\d+(\.\d+)?$|^\.\d+$/.test(s)) return null;
  return sign * Math.round(Number(s) * 100);
}

export interface ParsedRow {
  /** 1-based line in the file, for error messages. */
  line: number;
  date?: ISODate;
  amount?: Pence;
  rawPayee: string;
  error?: string;
}

export function mapRows(rows: string[][], m: ColumnMapping): ParsedRow[] {
  const body = m.hasHeader ? rows.slice(1) : rows;
  const offset = m.hasHeader ? 2 : 1;
  return body.map((r, i) => {
    const rawPayee = (r[m.description] ?? '').trim();
    const date = parseDate(r[m.date] ?? '', m.dateFormat);
    let amount: Pence | null;
    if (m.amount !== undefined) {
      amount = parseAmount(r[m.amount] ?? '');
    } else {
      const out = parseAmount(r[m.moneyOut ?? -1] ?? '');
      const inn = parseAmount(r[m.moneyIn ?? -1] ?? '');
      amount = out || inn ? (inn ? Math.abs(inn) : 0) - (out ? Math.abs(out) : 0) : null;
    }
    if (amount !== null && m.invertAmount) amount = -amount;
    const row: ParsedRow = { line: i + offset, rawPayee, date: date ?? undefined, amount: amount ?? undefined };
    if (!date) row.error = `Unreadable date "${r[m.date] ?? ''}"`;
    else if (amount === null || amount === 0) row.error = 'No amount';
    else if (!rawPayee) row.error = 'No description';
    return row;
  });
}

export function fingerprint(accountId: string, date: ISODate, amount: Pence, payee: string): string {
  return `${accountId}|${date}|${amount}|${payeeKey(payee)}`;
}

/**
 * Marks rows that already exist in the account. Counts matter: two £3 coffees on the same
 * day are both kept unless the account already has two.
 */
export function markDuplicates<T extends { date: ISODate; amount: Pence; rawPayee: string }>(
  rows: T[],
  existing: Transaction[],
  accountId: string,
): (T & { duplicate: boolean })[] {
  const counts = new Map<string, number>();
  for (const t of existing) {
    if (t.accountId !== accountId) continue;
    const key = t.fingerprint ?? fingerprint(accountId, t.date, t.amount, t.rawPayee ?? t.payee);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return rows.map((r) => {
    const key = fingerprint(accountId, r.date, r.amount, r.rawPayee);
    const n = counts.get(key) ?? 0;
    if (n > 0) counts.set(key, n - 1);
    return { ...r, duplicate: n > 0 };
  });
}
