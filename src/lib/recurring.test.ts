import { describe, expect, it } from 'vitest';
import { addDays, daysBetween, endOfMonth, shiftMonth } from './dates';
import { nextOccurrence, nextPayday, occurrencesBetween } from './recurring';

describe('dates', () => {
  it('handles month ends and leap years', () => {
    expect(endOfMonth('2026-02-10')).toBe('2026-02-28');
    expect(endOfMonth('2028-02-10')).toBe('2028-02-29');
    expect(shiftMonth('2026-01-31', 1)).toBe('2026-02-28');
    expect(shiftMonth('2026-01-15', -1)).toBe('2025-12-15');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(daysBetween('2026-03-28', '2026-03-30')).toBe(2); // across the UK clock change
  });
});

describe('occurrencesBetween', () => {
  it('keeps a monthly anchor of the 31st, clamping short months', () => {
    const s = { startDate: '2026-01-31', frequency: 'monthly' as const };
    expect(occurrencesBetween(s, '2026-01-01', '2026-05-31')).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
      '2026-04-30',
      '2026-05-31',
    ]);
  });

  it('starts no earlier than the start date and finds far-future dates', () => {
    const s = { startDate: '2026-06-15', frequency: 'monthly' as const };
    expect(occurrencesBetween(s, '2026-01-01', '2026-07-31')).toEqual(['2026-06-15', '2026-07-15']);
    expect(occurrencesBetween(s, '2030-03-01', '2030-03-31')).toEqual(['2030-03-15']);
  });

  it('supports weekly and yearly', () => {
    expect(occurrencesBetween({ startDate: '2026-10-01', frequency: 'weekly' }, '2026-10-05', '2026-10-20')).toEqual([
      '2026-10-08',
      '2026-10-15',
    ]);
    expect(occurrencesBetween({ startDate: '2024-02-29', frequency: 'yearly' }, '2025-01-01', '2026-12-31')).toEqual([
      '2025-02-28',
      '2026-02-28',
    ]);
  });

  it('finds the next occurrence', () => {
    expect(nextOccurrence({ startDate: '2025-01-15', frequency: 'monthly' }, '2026-10-16')).toBe('2026-11-15');
  });
});

describe('nextPayday', () => {
  it('is later this month, or next month on/after payday', () => {
    expect(nextPayday('2026-10-14', 25)).toBe('2026-10-25');
    expect(nextPayday('2026-10-25', 25)).toBe('2026-11-25');
    expect(nextPayday('2026-01-31', 31)).toBe('2026-02-28');
  });
});
