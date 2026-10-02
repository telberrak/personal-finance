import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { Icon } from '../components/Icon';
import { Loading, MonthSwitcher, PageHeader } from '../components/Layout';
import { TransactionRow } from '../components/rows';
import { TransactionTable } from '../components/tables';
import { useIsDesktop } from '../components/useMediaQuery';
import type { FinanceData, Transaction } from '../db/types';
import { dayHeading, endOfMonth, startOfMonth, today } from '../lib/dates';
import { formatMoney } from '../lib/money';
import { groupByDay, inRange, moneyInOut } from '../lib/selectors';

const FILTERS = ['All', 'Spending', 'Income', 'Bills', 'Transfers'] as const;
type Filter = (typeof FILTERS)[number];

const MATCHES: Record<Filter, (t: Transaction) => boolean> = {
  All: () => true,
  Spending: (t) => t.amount < 0 && !t.transferId,
  Income: (t) => t.amount > 0 && !t.transferId,
  Bills: (t) => !!t.recurringId,
  Transfers: (t) => !!t.transferId,
};

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
    return {
      categories,
      accounts: new Map(data.accounts.map((a) => [a.id, a])),
      moneyOut,
      moneyIn,
      count: inMonth.length,
      shownCount: shown.length,
      groups: groupByDay(shown),
    };
  }, [data, month, filter, query, accountFilter]);

  if (!view) return <Loading />;

  const search = (
    <label className="search">
      <Icon name="search" size={18} />
      <span className="visually-hidden">Search transactions</span>
      <input
        type="search"
        placeholder="Search payees or categories"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        enterKeyHint="search"
      />
    </label>
  );

  const chips = (
    <div className="chips" role="group" aria-label="Filter">
      {FILTERS.map((f) => (
        <button key={f} type="button" className="chip" aria-pressed={filter === f} onClick={() => setFilter(f)}>
          {f}
        </button>
      ))}
    </div>
  );

  const openAccounts = data!.accounts.filter((a) => !a.archived);
  const accountSelect = openAccounts.length > 1 && (
    <label className="select-pill">
      <span className="visually-hidden">Account</span>
      <select value={accountFilter} onChange={(e) => setAccountFilter(e.target.value)}>
        <option value="all">All accounts</option>
        {openAccounts.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </select>
    </label>
  );

  const empty = view.groups.length === 0 && (
    <p className="empty">{filter === 'All' && !query.trim() ? 'No transactions this month yet.' : 'No transactions match.'}</p>
  );

  return (
    <main className="screen">
      <PageHeader title="Activity" actions={<MonthSwitcher month={month} onChange={setMonth} current={ref} />} />

      {isDesktop ? (
        <>
          <div className="stat-grid">
            <div className="card stack">
              <span className="label">Money out</span>
              <span className="value-md num">{formatMoney(view.moneyOut)}</span>
            </div>
            <div className="card stack">
              <span className="label">Money in</span>
              <span className="value-md num text-pos">{formatMoney(view.moneyIn, { sign: true })}</span>
            </div>
            <div className="card stack">
              <span className="label">Net</span>
              <span className="value-md num">{formatMoney(view.moneyIn - view.moneyOut, { sign: true })}</span>
            </div>
            <div className="card stack">
              <span className="label">Transactions</span>
              <span className="value-md num">{view.count}</span>
            </div>
          </div>
          <div className="toolbar">
            {search}
            {accountSelect}
            {chips}
            <span className="label toolbar-count">
              {view.shownCount} of {view.count} shown
            </span>
          </div>
          {empty || <TransactionTable groups={view.groups} categories={view.categories} accounts={view.accounts} refDate={ref} />}
        </>
      ) : (
        <>
          {search}
          {accountSelect}
          {chips}
          <div className="grid-2">
            <div className="card stack" style={{ padding: '12px 14px' }}>
              <span className="small muted">Money out</span>
              <span className="value-md num">{formatMoney(view.moneyOut)}</span>
            </div>
            <div className="card stack" style={{ padding: '12px 14px' }}>
              <span className="small muted">Money in</span>
              <span className="value-md num text-pos">{formatMoney(view.moneyIn, { sign: true })}</span>
            </div>
          </div>
          {empty}
          {view.groups.map((g) => (
            <section key={g.date} className="section">
              <div className="section-head section-label">
                <span>{dayHeading(g.date, ref)}</span>
                <span className="num">{formatMoney(g.total, { sign: true })}</span>
              </div>
              <div className="list">
                {g.items.map((t) => (
                  <TransactionRow
                    key={t.id}
                    tx={t}
                    category={view.categories.get(t.categoryId)}
                    accountName={view.accounts.get(t.accountId)?.name}
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
