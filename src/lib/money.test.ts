import { describe, expect, it } from 'vitest';
import { formatMoney, parseMoney } from './money';

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
