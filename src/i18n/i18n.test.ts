import { afterEach, describe, expect, it } from 'vitest';
import en from '../locales/en.json';
import { configureFormatting } from '../lib/format';
import { formatMoney, formatPercent, formatWhole, moneyParts, parseMoney } from '../lib/money';
import { formatLong } from '../lib/dates';
import { applyLocale, t } from './index';
import { pseudoString } from './pseudo';

type Tree = { [k: string]: string | Tree };
const PLURAL = /_(zero|one|two|few|many|other)$/;

function flatten(tree: Tree, prefix = ''): Map<string, string> {
  const out = new Map<string, string>();
  for (const [k, v] of Object.entries(tree)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'string') out.set(key, v);
    else for (const [kk, vv] of flatten(v, key)) out.set(kk, vv);
  }
  return out;
}

/** Every app source file as text (tests excluded), loaded by Vite. */
const SOURCES = Object.entries(
  import.meta.glob(['../**/*.{ts,tsx}', '!../**/*.test.{ts,tsx}'], { query: '?raw', import: 'default', eager: true }) as Record<
    string,
    string
  >,
);

const keys = flatten(en as Tree);
const baseKeys = new Set([...keys.keys()].map((k) => k.replace(PLURAL, '')));

describe('translation keys', () => {
  const used = new Map<string, string>();
  const prefixes = new Map<string, string>();
  for (const [file, src] of SOURCES) {
    for (const m of src.matchAll(/\bt\(\s*'([a-zA-Z0-9_.-]+)'/g)) used.set(m[1], file);
    // t(`bills.method.${m}`) — check that the prefix exists as a group of keys.
    for (const m of src.matchAll(/\bt\(\s*`([a-zA-Z0-9_.-]+)\.\$\{/g)) prefixes.set(m[1], file);
    // Keys kept in lists (label: 'nav.home') and passed to t() later.
    for (const m of src.matchAll(/label: '([a-z]+\.[a-zA-Z0-9_.-]+)'/g)) used.set(m[1], file);
  }

  it('finds the source files and the keys they use', () => {
    expect(SOURCES.length).toBeGreaterThan(30);
    expect(used.size).toBeGreaterThan(400);
  });

  it('every key used in the code exists in en.json', () => {
    const missing = [...used].filter(([k]) => !baseKeys.has(k)).map(([k, f]) => `${k} (${f})`);
    expect(missing).toEqual([]);
  });

  it('every dynamic key prefix has entries', () => {
    const missing = [...prefixes].filter(([p]) => ![...keys.keys()].some((k) => k.startsWith(p + '.'))).map(([p]) => p);
    expect(missing).toEqual([]);
  });

  it('plural keys come in complete sets', () => {
    const plurals = [...keys.keys()].filter((k) => PLURAL.test(k));
    const bases = new Set(plurals.map((k) => k.replace(PLURAL, '')));
    for (const b of bases) expect(keys.has(`${b}_other`), `${b}_other`).toBe(true);
  });

  it('interpolations are written {{like_this}}', () => {
    const bad = [...keys].filter(([, v]) => /\$\{|\{[a-z]+\}(?!\})/.test(v)).map(([k]) => k);
    expect(bad).toEqual([]);
  });
});

describe('formatting follows the locale', () => {
  afterEach(() => configureFormatting({ locale: 'en-GB', currency: 'GBP' }));

  it('formats money, percentages and dates for French and euros', () => {
    configureFormatting({ locale: 'fr-FR', currency: 'EUR' });
    const nbsp = new RegExp('[' + String.fromCharCode(0xa0, 0x202f) + ']', 'g'); // no-break spaces Intl uses in French
    expect(formatMoney(-123456).replace(nbsp, ' ')).toBe('−1 234,56 €');
    expect(formatWhole(75000).replace(nbsp, ' ')).toBe('750 €');
    expect(formatPercent(0.82).replace(nbsp, ' ')).toBe('82 %');
    expect(moneyParts(98191)).toMatchObject({ fraction: expect.stringMatching(/^,91/) });
    expect(formatLong('2026-10-14')).toBe('mercredi 14 octobre');
  });

  it('keeps the English defaults', () => {
    expect(formatMoney(98191)).toBe('£981.91');
    expect(moneyParts(98191)).toEqual({ main: '£981', fraction: '.91' });
  });
});

describe('typed amounts in any style', () => {
  it.each([
    ['12,50', 1250],
    ['1 234,56', 123456],
    ['1.234,56', 123456],
    ['1,234.56', 123456],
    ['١٢٫٥٠', 1250], // Arabic-Indic digits with the Arabic decimal mark
    ['۱۰', 1000], // Persian digits
  ])('%s → %d', (input, pence) => expect(parseMoney(input)).toBe(pence));

  it.each(['1,2,3', '12,345,6'])('rejects %s', (input) => expect(parseMoney(input)).toBeNull());
});

describe('languages', () => {
  afterEach(() => {
    sessionStorage.clear();
    applyLocale('en', 'GBP');
  });

  it('pseudo-localises without touching placeholders', () => {
    expect(pseudoString('Save {{name}}')).toMatch(/^⟦Šàṽé \{\{name\}\} ~+⟧$/);
  });

  it('switches language and direction on the document', () => {
    applyLocale('ar-XB', 'GBP');
    expect(document.documentElement.dir).toBe('rtl');
    expect(t('nav.home')).toContain('⟦');
    applyLocale('en', 'GBP');
    expect(document.documentElement.dir).toBe('ltr');
    expect(t('nav.home')).toBe('Home');
  });

  it('fills every plural form in the RTL pseudo-locale', () => {
    applyLocale('ar-XB', 'GBP');
    for (const n of [0, 1, 2, 3, 11, 100]) expect(t('time.inDays', { count: n })).toContain('⟦');
  });

  it('uses plural forms', () => {
    expect(t('home.daysToPayday', { count: 1 })).toBe('1 day to payday');
    expect(t('home.daysToPayday', { count: 22 })).toBe('22 days to payday');
  });
});
