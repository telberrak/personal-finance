import { useState } from 'react';
import { Link } from 'react-router';
import { BalanceLine, Donut, GroupedBars } from '../components/charts';
import { Loading, PageHeader } from '../components/Layout';
import { catVar } from '../components/rows';
import type { FinanceData } from '../db/types';
import { endOfMonth, formatMonth, shiftMonth, startOfMonth, today } from '../lib/dates';
import { forecastBalance } from '../lib/forecast';
import { formatMoney, formatPounds } from '../lib/money';
import { monthlyTotals, spendByCategory, topPayees } from '../lib/reports';
import { moneyInOut } from '../lib/selectors';

type Range = 'this' | 'last' | '3m' | '6m';
const RANGES: { id: Range; label: string }[] = [
  { id: 'this', label: 'This month' },
  { id: 'last', label: 'Last month' },
  { id: '3m', label: '3 months' },
  { id: '6m', label: '6 months' },
];

function rangeDates(range: Range, ref: string) {
  switch (range) {
    case 'this':
      return { from: startOfMonth(ref), to: ref };
    case 'last': {
      const m = shiftMonth(ref, -1);
      return { from: startOfMonth(m), to: endOfMonth(m) };
    }
    case '3m':
      return { from: startOfMonth(shiftMonth(ref, -2)), to: ref };
    case '6m':
      return { from: startOfMonth(shiftMonth(ref, -5)), to: ref };
  }
}

export function Reports({ data }: { data?: FinanceData }) {
  const [range, setRange] = useState<Range>('this');
  if (!data) return <Loading />;

  const ref = today();
  const { from, to } = rangeDates(range, ref);
  const byCategory = spendByCategory(data.transactions, data.categories, from, to);
  const totalSpent = byCategory.reduce((s, r) => s + r.total, 0);
  const { moneyIn, moneyOut } = moneyInOut(data.transactions, from, to);
  const savingsRate = moneyIn > 0 ? Math.round(((moneyIn - moneyOut) / moneyIn) * 100) : undefined;
  const months = monthlyTotals(data.transactions, ref, 6);
  const payees = topPayees(data.transactions, from, to, 6);
  const forecast = forecastBalance(data, ref, 45);
  const low = forecast.lowest.balance < data.settings.lowBalanceThreshold;

  return (
    <main className="screen">
      <PageHeader
        title="Reports"
        actions={
          <div className="segmented" role="radiogroup" aria-label="Period">
            {RANGES.map((r) => (
              <button key={r.id} type="button" role="radio" aria-checked={range === r.id} onClick={() => setRange(r.id)}>
                {r.label}
              </button>
            ))}
          </div>
        }
      />

      <div className="stat-grid">
        <div className="card stack">
          <span className="label">Money in</span>
          <span className="value-md num text-pos">{formatMoney(moneyIn)}</span>
        </div>
        <div className="card stack">
          <span className="label">Money out</span>
          <span className="value-md num">{formatMoney(moneyOut)}</span>
        </div>
        <div className="card stack">
          <span className="label">Net</span>
          <span className="value-md num">{formatMoney(moneyIn - moneyOut, { sign: true })}</span>
        </div>
        <div className="card stack">
          <span className="label">Savings rate</span>
          <span className="value-md num">{savingsRate === undefined ? '—' : `${savingsRate}%`}</span>
        </div>
      </div>

      <div className="report-grid">
        <section className="card stack" style={{ gap: 16 }} aria-label="Spending by category">
          <h2 className="section-title">Where the money went</h2>
          {byCategory.length === 0 ? (
            <p className="empty">No spending in this period.</p>
          ) : (
            <div className="donut-layout">
              <Donut
                label={`Spending by category, total ${formatMoney(totalSpent)}`}
                segments={byCategory.map((r) => ({ value: r.total, color: `var(--cat-${r.category.color})` }))}
                center={
                  <>
                    <span className="small muted">Spent</span>
                    <span className="value-md num">{formatPounds(totalSpent)}</span>
                  </>
                }
              />
              <ul className="legend">
                {byCategory.map((r) => (
                  <li key={r.category.id} style={catVar(r.category.color)}>
                    <span className="dot" />
                    <span className="grow">{r.category.name}</span>
                    <span className="num muted small">{Math.round(r.share * 100)}%</span>
                    <span className="num" style={{ minWidth: 84, textAlign: 'right' }}>
                      {formatMoney(r.total)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>

        <section className="card stack" style={{ gap: 16 }} aria-label="Income and spending by month">
          <h2 className="section-title">Last 6 months</h2>
          <GroupedBars
            caption="Income and spending by month"
            groups={months.map((m) => ({ label: formatMonth(m.month).slice(0, 3), values: [m.income, m.spending] }))}
            series={[
              { name: 'Money in', color: 'var(--cat-income)' },
              { name: 'Money out', color: 'var(--accent)' },
            ]}
          />
        </section>

        <section className="card stack" style={{ gap: 12 }} aria-label="Top payees">
          <h2 className="section-title">Top payees</h2>
          {payees.length === 0 && <p className="empty">No spending in this period.</p>}
          <ol className="rank">
            {payees.map((p) => (
              <li key={p.payee}>
                <span className="grow item-title">{p.payee}</span>
                <span className="small muted">{p.count}×</span>
                <span className="num" style={{ minWidth: 84, textAlign: 'right' }}>
                  {formatMoney(p.total)}
                </span>
              </li>
            ))}
          </ol>
        </section>

        <section className="card stack" style={{ gap: 12 }} aria-label="Balance forecast">
          <div className="section-head">
            <h2 className="section-title">Balance forecast</h2>
            <span className={'pill ' + (low ? 'pill--warn' : 'pill--pos')}>{low ? 'May run low' : 'On track'}</span>
          </div>
          <BalanceLine
            points={forecast.points}
            threshold={data.settings.lowBalanceThreshold}
            label={`Forecast balance for the next 45 days. Lowest ${formatMoney(forecast.lowest.balance)}.`}
          />
          <p className="small muted">
            Everyday accounts, with upcoming bills on their due dates, about {formatMoney(forecast.avgDailySpend)} a day of spending (your
            last 30 days) and {formatMoney(forecast.expectedIncome)} expected each payday. The dashed line is your{' '}
            <Link to="/settings">low balance warning</Link>.
          </p>
        </section>
      </div>
      <p className="small muted">Transfers between your accounts are not counted.</p>
    </main>
  );
}
