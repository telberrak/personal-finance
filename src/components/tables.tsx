import type { Account, Category, Transaction } from '../db/types';
import { dayHeading, type ISODate } from '../lib/dates';
import { formatMoney } from '../lib/money';
import { Link } from 'react-router';
import { catVar } from './rows';
import { t } from '../i18n';

/** Desktop transaction list: one table, a header row per day with that day's total. */
export function TransactionTable({
  groups,
  categories,
  accounts,
  refDate,
}: {
  groups: { date: ISODate; total: number; items: Transaction[] }[];
  categories: Map<string, Category>;
  accounts: Map<string, Account>;
  refDate: ISODate;
}) {
  return (
    <div className="table-card">
      <table className="table">
        <caption className="visually-hidden">{t('activity.title')}</caption>
        <thead>
          <tr>
            <th scope="col">{t('columns.payee')}</th>
            <th scope="col">{t('columns.category')}</th>
            <th scope="col">{t('columns.account')}</th>
            <th scope="col">{t('columns.time')}</th>
            <th scope="col" className="num-col">
              {t('columns.amount')}
            </th>
          </tr>
        </thead>
        {groups.map((g) => (
          <tbody key={g.date}>
            <tr className="group-row">
              <th scope="rowgroup" colSpan={4}>
                {dayHeading(g.date, refDate)}
              </th>
              <td className="num-col num">{formatMoney(g.total, { sign: true })}</td>
            </tr>
            {g.items.map((tx) => {
              const category = categories.get(tx.categoryId);
              return (
                <tr key={tx.id}>
                  <td>
                    <div className="row" style={{ gap: 12 }}>
                      <div className="tile tile--sm" style={catVar(category?.color)} aria-hidden="true">
                        {tx.transferId ? '⇄' : tx.payee.charAt(0).toUpperCase()}
                      </div>
                      <div className="stack grow" style={{ gap: 0 }}>
                        <Link to={`/transactions/${tx.id}`} className="item-title row-link">
                          {tx.payee}
                        </Link>
                        {tx.note && (
                          <span className="small muted" translate="no">
                            {tx.note}
                          </span>
                        )}
                      </div>
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
                    </div>
                  </td>
                  <td>
                    <span className="row" style={{ gap: 8 }} translate="no">
                      <span className="dot" style={catVar(category?.color)} />
                      {category?.name ?? t('common.uncategorised')}
                    </span>
                  </td>
                  <td className="muted" translate="no">
                    {accounts.get(tx.accountId)?.name ?? '—'}
                  </td>
                  <td className="muted num">{tx.time ?? '—'}</td>
                  <td className={'num-col amount' + (tx.amount > 0 && !tx.transferId ? ' amount--in' : '')}>
                    {formatMoney(tx.amount, { sign: true })}
                  </td>
                </tr>
              );
            })}
          </tbody>
        ))}
      </table>
    </div>
  );
}
