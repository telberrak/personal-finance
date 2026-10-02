import { describe, expect, it } from 'vitest';
import type { Transaction } from '../db/types';
import { parseCsv } from './csv';
import { detectPreset, fingerprint, guessMapping, mapRows, markDuplicates, parseAmount, parseDate } from './importer';
import { applyAlias, normalisePayee, payeeKey, payeesSimilar } from './payees';

describe('parseCsv', () => {
  it('handles quotes, escaped quotes, newlines in fields, CRLF and a BOM', () => {
    const text = '﻿Date,Description,Amount\r\n01/10/2026,"TESCO, STORES",-12.50\r\n02/10/2026,"Say ""hi""\nthere",3\r\n\r\n';
    expect(parseCsv(text)).toEqual([
      ['Date', 'Description', 'Amount'],
      ['01/10/2026', 'TESCO, STORES', '-12.50'],
      ['02/10/2026', 'Say "hi"\nthere', '3'],
    ]);
  });

  it('detects semicolon and tab delimiters', () => {
    expect(parseCsv('a;b;c\n1;2;3')).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ]);
    expect(parseCsv('a\tb\n1\t2')[1]).toEqual(['1', '2']);
  });
});

describe('parseDate', () => {
  it.each([
    ['12/10/2026', 'dmy', '2026-10-12'],
    ['12-10-26', 'dmy', '2026-10-12'],
    ['10/12/2026', 'mdy', '2026-10-12'],
    ['2026-10-12', 'dmy', '2026-10-12'],
    ['2026-10-12T08:30:00Z', 'dmy', '2026-10-12'],
    ['12 Oct 2026', 'dmy', '2026-10-12'],
    ['12-Oct-26', 'dmy', '2026-10-12'],
    ['01/10/2026 14:22', 'dmy', '2026-10-01'],
  ] as const)('%s (%s) → %s', (input, fmt, out) => expect(parseDate(input, fmt)).toBe(out));

  it.each(['31/02/2026', '13/13/2026', 'yesterday', ''])('rejects %j', (s) => expect(parseDate(s, 'dmy')).toBeNull());
});

describe('parseAmount', () => {
  it.each([
    ['-12.50', -1250],
    ['£1,234.56', 123456],
    ['(12.00)', -1200],
    ['12.00 DR', -1200],
    ['12.00CR', 1200],
    ['+3', 300],
    ['.5', 50],
  ])('%s → %d', (s, p) => expect(parseAmount(s)).toBe(p));
  it.each(['', 'abc', '1.2.3'])('rejects %j', (s) => expect(parseAmount(s)).toBeNull());
});

describe('bank formats', () => {
  it('recognises Monzo and maps its columns', () => {
    const rows = parseCsv(
      'Transaction ID,Date,Time,Type,Name,Emoji,Category,Amount,Currency\ntx_1,12/10/2026,08:42:00,Card payment,Tesco,,Groceries,-23.40,GBP',
    );
    expect(detectPreset(rows[0])?.id).toBe('monzo');
    const m = guessMapping(rows);
    expect(mapRows(rows, m)).toEqual([{ line: 2, date: '2026-10-12', amount: -2340, rawPayee: 'Tesco' }]);
  });

  it('handles separate paid in / paid out columns (Nationwide)', () => {
    const rows = parseCsv(
      '"Date","Transaction type","Description","Paid out","Paid in","Balance"\n"12 Oct 2026","Visa purchase","PRET A MANGER","£6.95","","£1,000.00"\n"13 Oct 2026","Bank credit","SALARY","","£2,450.00","£3,443.05"',
    );
    const m = guessMapping(rows);
    expect(m.moneyOut).toBe(3);
    expect(mapRows(rows, m).map((r) => r.amount)).toEqual([-695, 245000]);
  });

  it('guesses columns for an unknown bank and flags bad rows', () => {
    const rows = parseCsv('Posted,Details,Value\n01/10/2026,Coffee,-3.20\nnot a date,Bad,1\n02/10/2026,,5');
    const parsed = mapRows(rows, guessMapping(rows));
    expect(parsed[0]).toMatchObject({ date: '2026-10-01', amount: -320, rawPayee: 'Coffee' });
    expect(parsed[1].error).toMatch(/date/);
    expect(parsed[2].error).toMatch(/description/);
  });

  it('handles files without a header row', () => {
    const rows = parseCsv('01/10/2026,TFL TRAVEL,-2.80\n02/10/2026,TFL TRAVEL,-2.80');
    const m = guessMapping(rows);
    expect(m.hasHeader).toBe(false);
    expect(mapRows(rows, m)).toHaveLength(2);
  });
});

describe('duplicates', () => {
  const existing: Transaction[] = [
    { id: '1', accountId: 'a', date: '2026-10-01', amount: -320, payee: 'Coffee', categoryId: 'eating' },
    { id: '2', accountId: 'b', date: '2026-10-01', amount: -320, payee: 'Coffee', categoryId: 'eating' },
  ];
  it('skips rows already in the account, counting repeats', () => {
    const rows = [
      { date: '2026-10-01', amount: -320, rawPayee: 'COFFEE' },
      { date: '2026-10-01', amount: -320, rawPayee: 'Coffee' },
      { date: '2026-10-02', amount: -320, rawPayee: 'Coffee' },
    ];
    expect(markDuplicates(rows, existing, 'a').map((r) => r.duplicate)).toEqual([true, false, false]);
    expect(fingerprint('a', '2026-10-01', -320, 'COFFEE!')).toBe('a|2026-10-01|-320|coffee');
  });
});

describe('payees', () => {
  it.each([
    ['CARD PAYMENT TO TESCO STORES 3297 ON 12/10 GB', 'Tesco Stores'],
    ['AMZN MKTP UK*2X4AB12', 'Amzn Mktp'],
    ['DIRECT DEBIT TO OCTOPUS ENERGY', 'Octopus Energy'],
    ["SAINSBURY'S S/MKTS", "Sainsbury's S/mkts"],
    ['Pret A Manger', 'Pret A Manger'],
    ['12345', '12345'],
  ])('%s → %s', (raw, clean) => expect(normalisePayee(raw)).toBe(clean));

  it('matches similar names and applies aliases', () => {
    expect(payeesSimilar('NETFLIX.COM', 'Netflix')).toBe(true);
    expect(payeesSimilar('THAMES WATER UTILITIES', 'Thames Water')).toBe(true);
    expect(payeesSimilar('Tesco', 'Boots')).toBe(false);
    expect(applyAlias('TESCO STORES', [{ id: '1', from: payeeKey('Tesco Stores'), to: 'Tesco' }])).toBe('Tesco');
  });
});
