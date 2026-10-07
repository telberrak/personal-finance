/**
 * Activity: transactions for a month, grouped by day (phone) or in a table (computer), with search, filters,
 * totals, and bills coming up in the next 7 days.
 */
import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Icon } from '../components/Icon';
import { Loading, MonthSwitcher, PageHeader } from '../components/Layout';
import { BillRow, ruleLabel, TransactionRow } from '../components/rows';
import { TransactionTable } from '../components/tables';
import { useIsDesktop } from '../components/useMediaQuery';
import type { FinanceData, Transaction } from '../db/types';
import { addDays, dayHeading, dueLabel, endOfMonth, formatShort, startOfMonth, today } from '../lib/dates';
import { formatMoney } from '../lib/money';
import { billOccurrences, groupByDay, inRange, moneyInOut, overdueBills } from '../lib/selectors';
import { t } from '../i18n';

const FILTERS = ['All', 'Spending', 'Income', 'Bills', 'Transfers'] as const;
type Filter = (typeof FILTERS)[number];

/** Activity lists bills due this many days ahead (and overdue ones) above the transactions. */
const COMING_UP_DAYS = 7;

const MATCHES: Record<Filter, (t: Transaction) => boolean> = {
  All: () => true,
  Spending: (t) => t.amount < 0 && !t.transferId,
  Income: (t) => t.amount > 0 && !t.transferId,
  Bills: (t) => !!t.recurringId,
  Transfers: (t) => !!t.transferId,
};

/** The Activity screen. The month is kept in the URL (?month=) so Back returns to it. */
export function Activity({ data }: { data?: FinanceData }) {
  const ref = today();
  const isDesktop = useIsDesktop();
  // The month lives in the URL (?month=2026-09-01) so going back from an edit returns to it.
  const [params, setParams] = useSearchParams();
  const month = params.get('month') ?? startOfMonth(ref);
  const setMonth = (m: string) => setParams(m === startOfMonth(ref) ? {} : { month: m }, { replace: true });
  const [filter, setFilter] = useState<Filter>('All');
  const [query, setQuery] = useState('');
  const [accountFilter, setAccountFilter] = useState('all');

  const view = useMemo(() => {
    if (!data) return undefined;
    const from = startOfMonth(month);
    const to = endOfMonth(month);
    const categories = new Map(data.categories.map((c) => [c.id, c]));
    const inMonth = data.transactions.filter((t) => inRange(t, from, to) && (accountFilter === 'all' || t.accountId === accountFilter));
    const q = query.trim().toLowerCase();
    const shown = inMonth.filter(
      (t) =>
        MATCHES[filter](t) && (!q || t.payee.toLowerCase().includes(q) || categories.get(t.categoryId)?.name.toLowerCase().includes(q)),
    );
    const { moneyIn, moneyOut } = moneyInOut(inMonth, from, to);
    // Unpaid bills are not transactions (they change no balance or total); they are listed so none is missed.
    const showComingUp = month === startOfMonth(ref) && (filter === 'All' || filter === 'Bills') && !q;
    const comingUp = showComingUp
      ? [
          ...overdueBills(data, ref),
          ...billOccurrences(data.recurring, data.transactions, ref, addDays(ref, COMING_UP_DAYS)).filter((o) => !o.paid),
        ].filter((o) => accountFilter === 'all' || o.rule.accountId === accountFilter)
      : [];
    return {
      comingUp,
      categories,
      accounts: new Map(data.accounts.map((a) => [a.id, a])),
      moneyOut,
      moneyIn,
      count: inMonth.length,
      shownCount: shown.length,
      groups: groupByDay(shown),
    };
  }, [data, month, filter, query, accountFilter, ref]);

  if (!view) return <Loading />;

  const search = (
    <label className="search">
      <Icon name="search" size={18} />
      <span className="visually-hidden">{t('activity.search')}</span>
      <input
        type="search"
        placeholder={t('activity.searchPlaceholder')}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        enterKeyHint="search"
      />
    </label>
  );

  const chips = (
    <div className="chips" role="group" aria-label={t('activity.filter.label')}>
      <Link to="/search" className="chip">
        {t('activity.advancedSearch')}
      </Link>
      {FILTERS.map((f) => (
        <button key={f} type="button" className="chip" aria-pressed={filter === f} onClick={() => setFilter(f)}>
          {t(`activity.filter.${f}`)}
        </button>
      ))}
    </div>
  );

  const openAccounts = data!.accounts.filter((a) => !a.archived);
  const accountSelect = openAccounts.length > 1 && (
    <label className="select-pill">
      <span className="visually-hidden">{t('activity.account')}</span>
      <select value={accountFilter} onChange={(e) => setAccountFilter(e.target.value)}>
        <option value="all">{t('activity.allAccounts')}</option>
        {openAccounts.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </select>
    </label>
  );

  const comingUp = view.comingUp.length > 0 && (
    <section className="section" aria-labelledby="coming-up">
      <div className="section-head">
        <h2 id="coming-up" className="section-label">
          {t('activity.comingUp')}
        </h2>
        <Link to="/bills" className="link-btn small">
          {t('activity.allBills')}
        </Link>
      </div>
      <p className="small muted">{t('activity.comingUpNote')}</p>
      <div className="list">
        {view.comingUp.map((o) => (
          <BillRow
            key={o.rule.id + o.date}
            rule={o.rule}
            date={o.date}
            to={`/bills/${o.rule.id}`}
            meta={
              o.date < ref ? (
                <span className="text-warn">{t('bills.overdueOn', { date: formatShort(o.date) })}</span>
              ) : (
                `${ruleLabel(o.rule)} · ${dueLabel(o.date, ref)}`
              )
            }
          />
        ))}
      </div>
    </section>
  );

  const empty = view.groups.length === 0 && (
    <p className="empty">{filter === 'All' && !query.trim() ? t('activity.emptyMonth') : t('activity.noMatch')}</p>
  );

  return (
    <main className="screen">
      <PageHeader title={t('activity.title')} actions={<MonthSwitcher month={month} onChange={setMonth} current={ref} />} />

      {isDesktop ? (
        <>
          <div className="stat-grid">
            <div className="card stack">
              <span className="label">{t('activity.moneyOut')}</span>
              <span className="value-md num">{formatMoney(view.moneyOut)}</span>
            </div>
            <div className="card stack">
              <span className="label">{t('activity.moneyIn')}</span>
              <span className="value-md num text-pos">{formatMoney(view.moneyIn, { sign: true })}</span>
            </div>
            <div className="card stack">
              <span className="label">{t('activity.net')}</span>
              <span className="value-md num">{formatMoney(view.moneyIn - view.moneyOut, { sign: true })}</span>
            </div>
            <div className="card stack">
              <span className="label">{t('activity.count')}</span>
              <span className="value-md num">{view.count}</span>
            </div>
          </div>
          <div className="toolbar">
            {search}
            {accountSelect}
            {chips}
            <span className="label toolbar-count">{t('activity.shown', { shown: view.shownCount, total: view.count })}</span>
          </div>
          {comingUp}
          {empty || <TransactionTable groups={view.groups} categories={view.categories} accounts={view.accounts} refDate={ref} />}
        </>
      ) : (
        <>
          {search}
          {accountSelect}
          {chips}
          <div className="grid-2">
            <div className="card stack" style={{ padding: '12px 14px' }}>
              <span className="small muted">{t('activity.moneyOut')}</span>
              <span className="value-md num">{formatMoney(view.moneyOut)}</span>
            </div>
            <div className="card stack" style={{ padding: '12px 14px' }}>
              <span className="small muted">{t('activity.moneyIn')}</span>
              <span className="value-md num text-pos">{formatMoney(view.moneyIn, { sign: true })}</span>
            </div>
          </div>
          {comingUp}
          {empty}
          {view.groups.map((g) => (
            <section key={g.date} className="section">
              <div className="section-head section-label">
                <span>{dayHeading(g.date, ref)}</span>
                <span className="num">{formatMoney(g.total, { sign: true })}</span>
              </div>
              <div className="list">
                {g.items.map((tx) => (
                  <TransactionRow
                    key={tx.id}
                    tx={tx}
                    category={view.categories.get(tx.categoryId)}
                    accountName={view.accounts.get(tx.accountId)?.name}
                  />
                ))}
              </div>
            </section>
          ))}
        </>
      )}
    </main>
  );
}
