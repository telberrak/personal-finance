import { useMemo, useState } from 'react';
import { Icon } from '../components/Icon';
import { Loading } from '../components/Layout';
import { TransactionRow } from '../components/rows';
import type { FinanceData, Transaction } from '../db/types';
import { dayHeading, endOfMonth, formatMonthYear, shiftMonth, startOfMonth, today } from '../lib/dates';
import { formatMoney } from '../lib/money';
import { groupByDay, inRange } from '../lib/selectors';

const FILTERS = ['All', 'Spending', 'Income', 'Recurring'] as const;
type Filter = (typeof FILTERS)[number];

const MATCHES: Record<Filter, (t: Transaction) => boolean> = {
  All: () => true,
  Spending: (t) => t.amount < 0,
  Income: (t) => t.amount > 0,
  Recurring: (t) => !!t.recurringId,
};

export function Activity({ data }: { data?: FinanceData }) {
  const ref = today();
  const [month, setMonth] = useState(startOfMonth(ref));
  const [filter, setFilter] = useState<Filter>('All');
  const [query, setQuery] = useState('');

  const view = useMemo(() => {
    if (!data) return undefined;
    const from = startOfMonth(month);
    const to = endOfMonth(month);
    const categories = new Map(data.categories.map((c) => [c.id, c]));
    const inMonth = data.transactions.filter((t) => inRange(t, from, to));
    const q = query.trim().toLowerCase();
    const shown = inMonth.filter(
      (t) =>
        MATCHES[filter](t) && (!q || t.payee.toLowerCase().includes(q) || categories.get(t.categoryId)?.name.toLowerCase().includes(q)),
    );
    return {
      categories,
      moneyOut: inMonth.reduce((s, t) => (t.amount < 0 ? s - t.amount : s), 0),
      moneyIn: inMonth.reduce((s, t) => (t.amount > 0 ? s + t.amount : s), 0),
      groups: groupByDay(shown),
    };
  }, [data, month, filter, query]);

  if (!view) return <Loading />;
  const isCurrentMonth = month === startOfMonth(ref);

  return (
    <main className="screen">
      <header className="screen-header">
        <h1 className="screen-title">Activity</h1>
        <div className="row" style={{ gap: 0 }}>
          <button
            type="button"
            className="icon-btn icon-btn--ghost"
            aria-label="Previous month"
            onClick={() => setMonth(shiftMonth(month, -1))}
          >
            <Icon name="back" size={20} />
          </button>
          <span style={{ fontSize: 14, fontWeight: 500, minWidth: 108, textAlign: 'center' }}>{formatMonthYear(month)}</span>
          <button
            type="button"
            className="icon-btn icon-btn--ghost"
            aria-label="Next month"
            disabled={isCurrentMonth}
            style={{ opacity: isCurrentMonth ? 0.3 : 1 }}
            onClick={() => setMonth(shiftMonth(month, 1))}
          >
            <Icon name="forward" size={20} />
          </button>
        </div>
      </header>

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

      <div className="chips" role="group" aria-label="Filter">
        {FILTERS.map((f) => (
          <button key={f} type="button" className="chip" aria-pressed={filter === f} onClick={() => setFilter(f)}>
            {f}
          </button>
        ))}
      </div>

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

      {view.groups.length === 0 && (
        <p className="empty">{filter === 'All' && !query.trim() ? 'No transactions this month yet.' : 'No transactions match.'}</p>
      )}
      {view.groups.map((g) => (
        <section key={g.date} className="section">
          <div className="section-head section-label">
            <span>{dayHeading(g.date, ref)}</span>
            <span className="num">{formatMoney(g.total, { sign: true })}</span>
          </div>
          <div className="list">
            {g.items.map((t) => (
              <TransactionRow key={t.id} tx={t} category={view.categories.get(t.categoryId)} />
            ))}
          </div>
        </section>
      ))}
    </main>
  );
}
