import { describe, expect, it } from 'vitest';
import { configureFormatting } from './format';
import { formatMoney, formatWhole, moneyParts, parseMoney } from './money';

describe('parseMoney', () => {
  it.each([
    ['23.4', 2340],
    ['23.40', 2340],
    ['£1,200', 120000],
    ['0.99', 99],
    ['.5', 50],
    ['7', 700],
  ])('parses %s', (input, pence) => expect(parseMoney(input)).toBe(pence));

  it.each(['', '.', 'abc', '1.234', '1.2.3', '-5'])('rejects %j', (input) => expect(parseMoney(input)).toBeNull());
});

describe('formatMoney', () => {
  it('formats pounds with a true minus sign', () => {
    expect(formatMoney(123450)).toBe('£1,234.50');
    expect(formatMoney(-2340)).toBe('−£23.40');
    expect(formatMoney(4200, { sign: true })).toBe('+£42.00');
    expect(formatMoney(0, { sign: true })).toBe('£0.00');
  });
});

describe('hide amounts', () => {
  it('masks every amount, keeping the currency in the locale position', () => {
    configureFormatting({ hideAmounts: true });
    try {
      expect(formatMoney(123450)).toBe('£•••');
      expect(formatWhole(-75000)).toBe('£•••');
      expect(moneyParts(98191)).toEqual({ main: '£•••', fraction: '' });
      configureFormatting({ locale: 'fr-FR', currency: 'EUR' });
      expect(formatMoney(123450)).toMatch(/^•••\s€$/);
    } finally {
      configureFormatting({ hideAmounts: false, locale: 'en-GB', currency: 'GBP' });
    }
  });
});
