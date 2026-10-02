import type { CSSProperties, ReactNode } from 'react';
import type { Category, CategoryColor, Recurring, Transaction } from '../db/types';
import { dayOfMonth, monthAbbr, type ISODate } from '../lib/dates';
import { formatMoney } from '../lib/money';
import { Icon } from './Icon';

/** Inline style that sets the category colour variable used by .tile, .dot, .chip--cat and .bar. */
export const catVar = (color: CategoryColor | undefined): CSSProperties => ({ '--c': `var(--cat-${color ?? 'fun'})` }) as CSSProperties;

export function TransactionRow({ tx, category }: { tx: Transaction; category?: Category }) {
  const meta = [category?.name ?? 'Uncategorised', tx.time].filter(Boolean).join(' · ');
  return (
    <div className="list-row">
      <div className="tile" style={catVar(category?.color)} aria-hidden="true">
        {tx.payee.charAt(0).toUpperCase()}
      </div>
      <div className="grow stack" style={{ gap: 2 }}>
        <span className="item-title">{tx.payee}</span>
        <span className="item-meta">
          {meta}
          {tx.recurringId && (
            <span className="tag" title="Recurring payment">
              DD
            </span>
          )}
        </span>
      </div>
      <span className={'amount' + (tx.amount > 0 ? ' amount--in' : '')}>{formatMoney(tx.amount, { sign: true })}</span>
    </div>
  );
}

const METHOD_LABEL: Record<Recurring['method'], string> = {
  'direct-debit': 'Direct debit',
  'standing-order': 'Standing order',
  card: 'Card subscription',
};

export const methodLabel = (m: Recurring['method']) => METHOD_LABEL[m];

export function BillRow({
  rule,
  date,
  meta,
  paid,
  trailing,
}: {
  rule: Recurring;
  date: ISODate;
  meta: string;
  paid?: boolean;
  trailing?: ReactNode;
}) {
  return (
    <div className="list-row">
      <div className={'tile tile--date' + (paid ? ' tile--muted' : '')} style={catVar('bills')} aria-hidden="true">
        <span className="day">{dayOfMonth(date)}</span>
        <span className="mon">{monthAbbr(date)}</span>
      </div>
      <div className="grow stack" style={{ gap: 2 }}>
        <span className="item-title">{rule.name}</span>
        <span className="item-meta">{meta}</span>
      </div>
      {trailing ?? (
        <span className={'amount row' + (paid ? ' muted' : '')} style={{ gap: 6 }}>
          {paid && <Icon name="check" size={16} strokeWidth={2.2} label="Paid" />}
          {formatMoney(rule.amount)}
        </span>
      )}
    </div>
  );
}
