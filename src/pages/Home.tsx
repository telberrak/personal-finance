import { Link } from 'react-router';
import { Icon } from '../components/Icon';
import { Loading } from '../components/Layout';
import { BillRow, catVar, methodLabel, TransactionRow } from '../components/rows';
import { useIsDesktop } from '../components/useMediaQuery';
import type { FinanceData } from '../db/types';
import { addDays, daysBetween, dueLabel, endOfMonth, formatLong, formatMonth, shiftMonth, startOfMonth, today } from '../lib/dates';
import { formatMoney, formatPounds } from '../lib/money';
import {
  billOccurrences,
  budgetProgress,
  dailySpend,
  dayToDaySpend,
  groupByDay,
  safeToSpend,
  spendVersusLastMonth,
} from '../lib/selectors';

function greeting(hour: number) {
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

export function Home({ data }: { data?: FinanceData }) {
  const isDesktop = useIsDesktop();
  if (!data) return <Loading />;

  const ref = today();
  const s = safeToSpend(data, ref);
  const [safePounds, safePence] = formatMoney(s.safe).split('.');
  const spent = dayToDaySpend(data.transactions, startOfMonth(ref), ref);
  const budgetTotal = data.budgets.reduce((sum, b) => sum + b.monthlyLimit, 0);
  const diff = spendVersusLastMonth(data.transactions, ref);
  const days = dailySpend(data.transactions, ref, ref);
  const maxDay = Math.max(1, ...days);
  const futureDays = daysBetween(ref, endOfMonth(ref));
  const upcoming = billOccurrences(data.recurring, data.transactions, addDays(ref, -3), addDays(ref, 31))
    .filter((o) => !o.paid)
    .slice(0, isDesktop ? 5 : 3);
  const categories = new Map(data.categories.map((c) => [c.id, c]));
  // Transactions arrive newest date first; groupByDay also orders each day by time.
  const recent = groupByDay(data.transactions.slice(0, 40))
    .flatMap((g) => g.items)
    .slice(0, 6);

  return (
    <main className="screen">
      <header className="screen-header">
        <div className="stack" style={{ gap: 2 }}>
          <span className="label">{formatLong(ref)}</span>
          <h1 className="home-title">{greeting(new Date().getHours())}</h1>
        </div>
        {!isDesktop && (
          <Link to="/settings" className="icon-btn" aria-label="Settings">
            <Icon name="settings" size={20} />
          </Link>
        )}
      </header>

      <div className="home-grid">
        <div className="col">
          <section className="hero" aria-label="Safe to spend">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <span className="muted" style={{ fontSize: 14 }}>
                Safe to spend
              </span>
              <span className="hero-chip">
                {s.daysToPayday} {s.daysToPayday === 1 ? 'day' : 'days'} to payday
              </span>
            </div>
            <div className="hero-amount num">
              {safePounds}
              <span className="muted">.{safePence}</span>
            </div>
            <p className="muted" style={{ fontSize: 13 }}>
              {s.safe > 0
                ? `About ${formatMoney(s.perDay)} a day until payday on ${formatLong(s.payday).split(' ').slice(1).join(' ')}`
                : 'Upcoming bills and savings are more than your balance.'}
            </p>
            <div className="hero-divider" />
            <div className="grid-3">
              <div className="stack" style={{ gap: 3 }}>
                <span className="muted small">Balance</span>
                <span className="num" style={{ fontWeight: 500 }}>
                  {formatMoney(s.balance)}
                </span>
              </div>
              <div className="stack" style={{ gap: 3 }}>
                <span className="muted small">Bills before payday</span>
                <span className="num" style={{ fontWeight: 500 }}>
                  {formatMoney(-s.billsBeforePayday)}
                </span>
              </div>
              <div className="stack" style={{ gap: 3 }}>
                <span className="muted small">Savings</span>
                <span className="num" style={{ fontWeight: 500 }}>
                  {formatMoney(-s.savings)}
                </span>
              </div>
            </div>
          </section>

          <section className="card stack" style={{ gap: 14 }} aria-label="Spending this month">
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div className="stack">
                <span className="label">Spent in {formatMonth(ref)}</span>
                <span className="value-lg num">{formatMoney(spent)}</span>
              </div>
              <div className="stack" style={{ alignItems: 'flex-end' }}>
                {budgetTotal > 0 && <span className="label">of {formatPounds(budgetTotal)} budget</span>}
                {diff !== 0 && (
                  <span className={'pill ' + (diff < 0 ? 'pill--pos' : 'pill--warn')}>
                    {formatPounds(Math.abs(diff))} {diff < 0 ? 'less' : 'more'} than {formatMonth(shiftMonth(ref, -1))}
                  </span>
                )}
              </div>
            </div>
            <div className="spark" role="img" aria-label={`Daily spending this month, highest ${formatMoney(maxDay)}`}>
              {days.map((v, i) => (
                <span
                  key={i}
                  className={i === days.length - 1 ? 'is-today' : undefined}
                  style={{ height: `${Math.max(6, (v / maxDay) * 100)}%` }}
                />
              ))}
              {Array.from({ length: futureDays }, (_, i) => (
                <span key={'f' + i} className="is-future" />
              ))}
            </div>
            <div className="row small muted" style={{ justifyContent: 'space-between' }}>
              <span>1 {formatMonth(ref).slice(0, 3)}</span>
              <span>Today</span>
            </div>
          </section>

          {isDesktop && (
            <section className="section" aria-label="Recent transactions">
              <div className="section-head">
                <h2 className="section-title">Recent transactions</h2>
                <Link to="/activity" className="link-btn">
                  View all
                </Link>
              </div>
              <div className="list">
                {data.transactions.length === 0 && <p className="empty">No transactions yet.</p>}
                {recent.map((t) => (
                  <TransactionRow key={t.id} tx={t} category={categories.get(t.categoryId)} />
                ))}
              </div>
            </section>
          )}
        </div>

        <div className="col">
          <section className="section" aria-label="Upcoming bills">
            <div className="section-head">
              <h2 className="section-title">Upcoming bills</h2>
              <Link to="/bills" className="link-btn">
                See all
              </Link>
            </div>
            <div className="list">
              {upcoming.length === 0 && <p className="empty">Nothing due in the next month.</p>}
              {upcoming.map((o) => (
                <BillRow
                  key={o.rule.id + o.date}
                  rule={o.rule}
                  date={o.date}
                  meta={`${methodLabel(o.rule.method)} · ${dueLabel(o.date, ref)}`}
                />
              ))}
            </div>
          </section>

          {isDesktop && <BudgetSummary data={data} month={ref} />}
        </div>
      </div>
    </main>
  );
}

function BudgetSummary({ data, month }: { data: FinanceData; month: string }) {
  const rows = budgetProgress(data.budgets, data.categories, data.transactions, month);
  return (
    <section className="section" aria-label="Budgets">
      <div className="section-head">
        <h2 className="section-title">Budgets</h2>
        <Link to="/budgets" className="link-btn">
          Details
        </Link>
      </div>
      <div className="card stack" style={{ gap: 14 }}>
        {rows.length === 0 && <p className="empty">No budgets set yet.</p>}
        {rows.map((r) => {
          const tight = r.ratio >= 0.95;
          return (
            <div key={r.budget.id} className="stack" style={{ gap: 6, ...catVar(r.category.color) }}>
              <div className="row" style={{ justifyContent: 'space-between', fontSize: 14 }}>
                <span className="row" style={{ gap: 8 }}>
                  <span className="dot" />
                  {r.category.name}
                </span>
                <span className={'num small ' + (tight ? 'text-warn' : 'muted')}>
                  {formatMoney(r.spent)} / {formatPounds(r.budget.monthlyLimit)}
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
      </div>
    </section>
  );
}
