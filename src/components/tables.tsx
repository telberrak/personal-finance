import type { Account, Category, Transaction } from '../db/types';
import { dayHeading, type ISODate } from '../lib/dates';
import { formatMoney } from '../lib/money';
import { Link } from 'react-router';
import { catVar } from './rows';

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
        <caption className="visually-hidden">Transactions</caption>
        <thead>
          <tr>
            <th scope="col">Payee</th>
            <th scope="col">Category</th>
            <th scope="col">Account</th>
            <th scope="col">Time</th>
            <th scope="col" className="num-col">
              Amount
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
            {g.items.map((t) => {
              const category = categories.get(t.categoryId);
              return (
                <tr key={t.id}>
                  <td>
                    <div className="row" style={{ gap: 12 }}>
                      <div className="tile tile--sm" style={catVar(category?.color)} aria-hidden="true">
                        {t.transferId ? '⇄' : t.payee.charAt(0).toUpperCase()}
                      </div>
                      <div className="stack grow" style={{ gap: 0 }}>
                        <Link to={`/transactions/${t.id}`} className="item-title row-link">
                          {t.payee}
                        </Link>
                        {t.note && <span className="small muted">{t.note}</span>}
                      </div>
                      {t.recurringId && (
                        <span className="tag" title="Recurring payment">
                          DD
                        </span>
                      )}
                    </div>
                  </td>
                  <td>
                    <span className="row" style={{ gap: 8 }}>
                      <span className="dot" style={catVar(category?.color)} />
                      {category?.name ?? 'Uncategorised'}
                    </span>
                  </td>
                  <td className="muted">{accounts.get(t.accountId)?.name ?? '—'}</td>
                  <td className="muted num">{t.time ?? '—'}</td>
                  <td className={'num-col amount' + (t.amount > 0 && !t.transferId ? ' amount--in' : '')}>
                    {formatMoney(t.amount, { sign: true })}
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
