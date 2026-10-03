/**
 * Tax helper: mark income and expenses that matter for a tax return, and total them per tax
 * year. Tax years and headings differ by country, so they are configured per country here.
 * This organises your records; it is not tax advice and does not calculate tax owed.
 */
import type { Transaction } from '../db/types';
import type { ISODate } from './dates';
import type { Pence } from './money';

export interface TaxHeading {
  id: string;
  /** Translation key for its name. */
  label: string;
  kind: 'income' | 'expense';
}

export interface TaxSystem {
  country: string;
  /** Month and day the tax year starts: "04-06" for the UK (6 April), "01-01" for France. */
  yearStart: string;
  headings: TaxHeading[];
}

export const TAX_SYSTEMS: TaxSystem[] = [
  {
    country: 'GB',
    yearStart: '04-06',
    headings: [
      { id: 'gb-se-income', label: 'tax.gb.seIncome', kind: 'income' },
      { id: 'gb-se-expense', label: 'tax.gb.seExpense', kind: 'expense' },
      { id: 'gb-property-income', label: 'tax.gb.propertyIncome', kind: 'income' },
      { id: 'gb-property-expense', label: 'tax.gb.propertyExpense', kind: 'expense' },
      { id: 'gb-interest', label: 'tax.gb.interest', kind: 'income' },
      { id: 'gb-gift-aid', label: 'tax.gb.giftAid', kind: 'expense' },
      { id: 'gb-pension', label: 'tax.gb.pension', kind: 'expense' },
    ],
  },
  {
    country: 'FR',
    yearStart: '01-01',
    headings: [
      { id: 'fr-bnc-income', label: 'tax.fr.bncIncome', kind: 'income' },
      { id: 'fr-bnc-expense', label: 'tax.fr.bncExpense', kind: 'expense' },
      { id: 'fr-rental-income', label: 'tax.fr.rentalIncome', kind: 'income' },
      { id: 'fr-rental-expense', label: 'tax.fr.rentalExpense', kind: 'expense' },
      { id: 'fr-donations', label: 'tax.fr.donations', kind: 'expense' },
      { id: 'fr-childcare', label: 'tax.fr.childcare', kind: 'expense' },
    ],
  },
];

export const taxSystem = (country: string | undefined): TaxSystem => TAX_SYSTEMS.find((s) => s.country === country) ?? TAX_SYSTEMS[0];

/** The tax year containing `date`, named by the year it starts in. */
export function taxYearOf(system: TaxSystem, date: ISODate): number {
  const year = Number(date.slice(0, 4));
  return date.slice(5) >= system.yearStart ? year : year - 1;
}

export function taxYearRange(system: TaxSystem, startYear: number): { from: ISODate; to: ISODate } {
  const from = `${startYear}-${system.yearStart}`;
  const end = new Date(startYear + 1, Number(system.yearStart.slice(0, 2)) - 1, Number(system.yearStart.slice(3)) - 1);
  const to = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')}`;
  return { from, to };
}

export interface TaxSummary {
  heading: TaxHeading;
  total: Pence;
  items: Transaction[];
}

/** Totals per heading for a tax year (amounts as positive numbers). */
export function taxSummary(transactions: Transaction[], system: TaxSystem, startYear: number): TaxSummary[] {
  const { from, to } = taxYearRange(system, startYear);
  return system.headings.map((heading) => {
    const items = transactions
      .filter((t) => t.tax === heading.id && t.date >= from && t.date <= to)
      .sort((a, b) => (a.date < b.date ? -1 : 1));
    return { heading, items, total: items.reduce((s, t) => s + Math.abs(t.amount), 0) };
  });
}
