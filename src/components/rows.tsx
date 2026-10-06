import type { CSSProperties, ReactNode } from 'react';
import { Link } from 'react-router';
import type { Category, CategoryColor, Recurring, Transaction } from '../db/types';
import { dayOfMonth, monthAbbr, type ISODate } from '../lib/dates';
import { formatMoney } from '../lib/money';
import { Icon } from './Icon';
import { t } from '../i18n';
import { findMerchant } from '../lib/merchants';

/** Inline style that sets the category colour variable used by .tile, .dot, .chip--cat and .bar. */
export const catVar = (color: CategoryColor | undefined): CSSProperties => ({ '--c': `var(--cat-${color ?? 'fun'})` }) as CSSProperties;

/**
 * A transaction in a phone list: category tile, payee, category or account, time and amount. Links to its
 * edit screen.
 */
export function TransactionRow({ tx, category, accountName }: { tx: Transaction; category?: Category; accountName?: string }) {
  const meta = [tx.transferId ? accountName : (category?.name ?? t('common.uncategorised')), tx.time].filter(Boolean).join(' · ');
  return (
    <Link to={`/transactions/${tx.id}`} className="list-row list-row--link">
      <MerchantTile tx={tx} category={category} />
      <div className="grow stack" style={{ gap: 2 }}>
        <span className="item-title">{tx.payee}</span>
        <span className="item-meta">
          {meta}
          {tx.recurringId && (
            <span className="tag" title={t('tags.recurringTitle')}>
              {t('tags.recurring')}
            </span>
          )}
          {tx.splitId && (
            <span className="tag" title={t('tags.splitTitle')}>
              {t('tags.split')}
            </span>
          )}
          {tx.tags?.map((tag) => (
            <span className="tag tag--user" key={tag} translate="no">
              {tag}
            </span>
          ))}
        </span>
      </div>
      <span className="stack" style={{ gap: 0, alignItems: 'flex-end' }}>
        <span className={'amount' + (tx.amount > 0 && !tx.transferId ? ' amount--in' : '')}>
          {tx.native
            ? formatMoney(tx.native.amount!, { sign: true, currency: tx.native.currency })
            : formatMoney(tx.amount, { sign: true })}
        </span>
        {(tx.native || tx.foreign) && (
          <span className="small muted num">
            {tx.native
              ? formatMoney(tx.amount, { sign: true })
              : formatMoney(-tx.foreign!.amount, { sign: true, currency: tx.foreign!.currency })}
          </span>
        )}
      </span>
    </Link>
  );
}

/** The translated name of a bill's payment method. */
export const methodLabel = (m: Recurring['method']) => t(`bills.method.${m}`);

/**
 * A bill occurrence in a list: date tile, name, a caller-supplied line of details, and the amount (or custom
 * trailing content).
 */
export function BillRow({
  rule,
  date,
  meta,
  paid,
  trailing,
  to,
}: {
  rule: Recurring;
  date: ISODate;
  meta: ReactNode;
  paid?: boolean;
  trailing?: ReactNode;
  /** Makes the name a link (the row itself may hold buttons). */
  to?: string;
}) {
  return (
    <div className="list-row">
      <div className={'tile tile--date' + (paid ? ' tile--muted' : '')} style={catVar('bills')} aria-hidden="true">
        <span className="day">{dayOfMonth(date)}</span>
        <span className="mon">{monthAbbr(date)}</span>
      </div>
      <div className="grow stack" style={{ gap: 2 }}>
        {to ? (
          <Link to={to} className="item-title row-link">
            {rule.name}
          </Link>
        ) : (
          <span className="item-title">{rule.name}</span>
        )}
        <span className="item-meta">{meta}</span>
      </div>
      {trailing ?? (
        <span className={'amount row' + (paid ? ' muted' : '')} style={{ gap: 6 }}>
          {paid && <Icon name="check" size={16} strokeWidth={2.2} label={t('bills.paid')} />}
          {formatMoney(rule.amount)}
        </span>
      )}
    </div>
  );
}

/** The payee's initial on its merchant's brand colour when known, else the category colour. */
export function MerchantTile({ tx, category, small }: { tx: Transaction; category?: Category; small?: boolean }) {
  const merchant = tx.transferId ? undefined : findMerchant(tx.payee);
  return (
    <div
      className={small ? 'tile tile--sm' : 'tile'}
      style={merchant ? { background: merchant.color, color: '#fff' } : catVar(category?.color)}
      aria-hidden="true"
    >
      {tx.transferId ? '⇄' : (merchant?.name ?? tx.payee).charAt(0).toUpperCase()}
    </div>
  );
}
