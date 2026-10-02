import { useState } from 'react';
import { Loading, MonthSwitcher, PageHeader } from '../components/Layout';
import { catVar } from '../components/rows';
import type { FinanceData } from '../db/types';
import { daysBetween, endOfMonth, startOfMonth, today } from '../lib/dates';
import { formatMoney, formatPounds } from '../lib/money';
import { budgetProgress } from '../lib/selectors';

const RING_R = 52;
const RING_C = 2 * Math.PI * RING_R;
/** At or above this share of a budget, the category is flagged. */
const TIGHT = 0.95;

export function Budgets({ data }: { data?: FinanceData }) {
  const ref = today();
  const [month, setMonth] = useState(startOfMonth(ref));
  if (!data) return <Loading />;

  const rows = budgetProgress(data.budgets, data.categories, data.transactions, month);
  const limit = rows.reduce((s, r) => s + r.budget.monthlyLimit, 0);
  const spent = rows.reduce((s, r) => s + r.spent, 0);
  const left = limit - spent;
  const ratio = limit ? Math.min(1, spent / limit) : 0;
  const isCurrent = month === startOfMonth(ref);
  const daysLeft = isCurrent ? daysBetween(ref, endOfMonth(ref)) + 1 : 0;

  return (
    <main className="screen">
      <PageHeader title="Budgets" actions={<MonthSwitcher month={month} onChange={setMonth} current={ref} />} />

      <div className="budgets-layout">
        <section className="card overview" aria-label="Budget overview">
          <div className="ring">
            <svg width="120" height="120" viewBox="0 0 120 120" aria-hidden="true">
              <circle cx="60" cy="60" r={RING_R} fill="none" stroke="var(--track)" strokeWidth="12" />
              {ratio > 0 && (
                <circle
                  cx="60"
                  cy="60"
                  r={RING_R}
                  fill="none"
                  stroke={spent > limit ? 'var(--warn)' : 'var(--accent)'}
                  strokeWidth="12"
                  strokeLinecap="round"
                  strokeDasharray={`${ratio * RING_C} ${RING_C}`}
                />
              )}
            </svg>
            <div className="ring-label">
              <span style={{ fontSize: 24, fontWeight: 600, letterSpacing: '-0.02em' }}>
                {Math.round((limit ? spent / limit : 0) * 100)}%
              </span>
              <span className="small muted">used</span>
            </div>
          </div>
          <div className="stack">
            <span className="label">{left >= 0 ? 'Left to spend' : 'Over budget'}</span>
            <span className={'num ' + (left < 0 ? 'text-warn' : '')} style={{ fontSize: 28, fontWeight: 600, letterSpacing: '-0.02em' }}>
              {formatMoney(Math.abs(left))}
            </span>
            <span className="label">
              {formatMoney(spent)} spent of {formatPounds(limit)}
              {isCurrent && ` · ${daysLeft} ${daysLeft === 1 ? 'day' : 'days'} left`}
            </span>
            {isCurrent && left > 0 && (
              <span className="pill pill--accent" style={{ alignSelf: 'flex-start', marginTop: 4 }}>
                About {formatMoney(Math.floor(left / daysLeft))} a day
              </span>
            )}
          </div>
        </section>

        <section className="budget-grid" aria-label="Categories">
          {rows.length === 0 && <p className="empty">No budgets set yet.</p>}
          {rows.map((r) => {
            const tight = r.ratio >= TIGHT;
            return (
              <div key={r.budget.id} className="card stack" style={{ padding: 14, gap: 10, ...catVar(r.category.color) }}>
                <div className="row">
                  <div className="tile" style={{ width: 36, height: 36, borderRadius: 10, fontSize: 14 }} aria-hidden="true">
                    {r.category.name.charAt(0)}
                  </div>
                  <div className="grow stack" style={{ gap: 1 }}>
                    <span className="item-title">{r.category.name}</span>
                    <span className="small muted num">
                      {formatMoney(r.spent)} of {formatPounds(r.budget.monthlyLimit)}
                    </span>
                  </div>
                  <span className={'num ' + (tight ? 'text-warn' : '')} style={{ fontSize: 14, fontWeight: 600 }}>
                    {r.remaining >= 0 ? `${formatMoney(r.remaining)} left` : `${formatMoney(-r.remaining)} over`}
                  </span>
                </div>
                <div
                  className="bar"
                  role="progressbar"
                  aria-label={`${r.category.name} budget used`}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(r.ratio * 100)}
                >
                  <span style={{ width: `${Math.min(100, r.ratio * 100)}%`, background: tight ? 'var(--warn)' : undefined }} />
                </div>
              </div>
            );
          })}
        </section>
      </div>
    </main>
  );
}
