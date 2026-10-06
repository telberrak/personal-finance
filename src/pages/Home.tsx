/**
 * Home: "safe to spend" and how it is worked out, alerts, spending this month, upcoming bills, recent
 * transactions, budgets (computer) and shortcuts to other screens (phone).
 */
import { Link } from 'react-router';
import { Icon } from '../components/Icon';
import { NotificationBell } from './Notifications';
import { Tour } from '../components/Tour';
import { Loading } from '../components/Layout';
import { BillRow, catVar, methodLabel, TransactionRow } from '../components/rows';
import { useIsDesktop } from '../components/useMediaQuery';
import { daysSinceBackup } from '../db/repo';
import type { FinanceData } from '../db/types';
import {
  addDays,
  daysBetween,
  dueLabel,
  endOfMonth,
  formatDayMonth,
  formatLong,
  formatMonth,
  formatShort,
  shiftMonth,
  startOfMonth,
  today,
} from '../lib/dates';
import { forecastBalance } from '../lib/forecast';
import { formatMoney, formatWhole, moneyParts } from '../lib/money';
import { periodFor } from '../lib/periods';
import {
  billOccurrences,
  budgetProgress,
  budgetScope,
  dailySpend,
  dayToDaySpend,
  groupByDay,
  overdueBills,
  safeToSpend,
  spendVersusLastMonth,
} from '../lib/selectors';
import { t } from '../i18n';

function greeting(hour: number) {
  if (hour < 12) return t('home.goodMorning');
  if (hour < 18) return t('home.goodAfternoon');
  return t('home.goodEvening');
}

/** The Home screen. */
export function Home({ data }: { data?: FinanceData }) {
  const isDesktop = useIsDesktop();
  if (!data) return <Loading />;

  const ref = today();
  const s = safeToSpend(data, ref);
  const safeParts = moneyParts(s.safe);
  const spent = dayToDaySpend(data.transactions, startOfMonth(ref), ref);
  const budgetTotal = budgetScope(data).budgets.reduce((sum, b) => sum + b.monthlyLimit, 0);
  const diff = spendVersusLastMonth(data.transactions, ref);
  const days = dailySpend(data.transactions, ref, ref);
  const maxDay = Math.max(1, ...days);
  const futureDays = daysBetween(ref, endOfMonth(ref));
  const upcoming = billOccurrences(data.recurring, data.transactions, addDays(ref, -3), addDays(ref, 31))
    .filter((o) => !o.paid)
    .slice(0, isDesktop ? 5 : 3);
  const categories = new Map(data.categories.map((c) => [c.id, c]));
  const accounts = new Map(data.accounts.map((a) => [a.id, a.name]));
  const overdue = overdueBills(data, ref);
  const forecast = forecastBalance(data, ref, 35);
  const lowSoon = forecast.lowest.balance < data.settings.lowBalanceThreshold;
  const backupAge = daysSinceBackup(data.settings);
  const needsBackup = data.transactions.length >= 20 && (backupAge === undefined || backupAge > 30);
  // Transactions arrive newest date first; groupByDay also orders each day by time.
  const recent = groupByDay(data.transactions.slice(0, 40))
    .flatMap((g) => g.items)
    .slice(0, 6);

  return (
    <main className="screen">
      {data.settings.tourDone === false && <Tour show />}
      <header className="screen-header">
        <div className="stack" style={{ gap: 2 }}>
          <span className="label">{formatLong(ref)}</span>
          <h1 className="home-title">{greeting(new Date().getHours())}</h1>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <NotificationBell data={data} />
          {!isDesktop && (
            <Link to="/settings" className="icon-btn" aria-label={t('nav.settings')}>
              <Icon name="settings" size={20} />
            </Link>
          )}
        </div>
      </header>

      {(overdue.length > 0 || lowSoon || needsBackup) && (
        <div className="alerts" aria-label={t('home.alerts')}>
          {overdue.length > 0 && (
            <Link to="/bills" className="callout callout--link">
              <span className="callout-icon">
                <Icon name="alert" size={20} />
              </span>
              <span className="stack grow" style={{ gap: 2 }}>
                <strong>
                  {overdue.length === 1
                    ? t('home.overdueOne', { name: overdue[0].rule.name })
                    : t('home.overdueMany', { count: overdue.length })}
                </strong>
                <span className="label">{t('home.overdueBody')}</span>
              </span>
            </Link>
          )}
          {lowSoon && (
            <Link to="/reports" className="callout callout--link">
              <span className="callout-icon">
                <Icon name="trendUp" size={20} />
              </span>
              <span className="stack grow" style={{ gap: 2 }}>
                <strong>
                  {t('home.lowBalance', { amount: formatWhole(forecast.lowest.balance), date: formatLong(forecast.lowest.date) })}
                </strong>
                <span className="label">{t('home.lowBalanceBody')}</span>
              </span>
            </Link>
          )}
          {needsBackup && (
            <Link to="/settings#backup" className="callout callout--link callout--info">
              <span className="callout-icon">
                <Icon name="download" size={20} />
              </span>
              <span className="stack grow" style={{ gap: 2 }}>
                <strong>{backupAge === undefined ? t('home.backupNever') : t('home.backupAge', { count: backupAge })}</strong>
                <span className="label">{t('home.backupBody')}</span>
              </span>
            </Link>
          )}
        </div>
      )}

      <div className="home-grid">
        <div className="col">
          <section className="hero" aria-label={t('home.safeToSpend')}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <span className="muted" style={{ fontSize: 14 }}>
                {t('home.safeToSpend')}
              </span>
              <span className="hero-chip">{t('home.daysToPayday', { count: s.daysToPayday })}</span>
            </div>
            <div className="hero-amount num">
              {safeParts.main}
              <span className="muted">{safeParts.fraction}</span>
            </div>
            <p className="muted" style={{ fontSize: 13 }}>
              {s.safe > 0 ? t('home.perDay', { amount: formatMoney(s.perDay), date: formatDayMonth(s.payday) }) : t('home.overspent')}
            </p>
            <div className="hero-divider" />
            <div className="grid-3">
              <div className="stack" style={{ gap: 3 }}>
                <span className="muted small">{t('home.balance')}</span>
                <span className="num" style={{ fontWeight: 500 }}>
                  {formatMoney(s.balance)}
                </span>
              </div>
              <div className="stack" style={{ gap: 3 }}>
                <span className="muted small">{t('home.billsBeforePayday')}</span>
                <span className="num" style={{ fontWeight: 500 }}>
                  {formatMoney(-s.billsBeforePayday)}
                </span>
              </div>
              <div className="stack" style={{ gap: 3 }}>
                <span className="muted small">{t('home.savings')}</span>
                <span className="num" style={{ fontWeight: 500 }}>
                  {formatMoney(-s.savings)}
                </span>
              </div>
            </div>
          </section>

          <section className="card stack" style={{ gap: 14 }} aria-label={t('home.spendingThisMonth')}>
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div className="stack">
                <span className="label">{t('home.spentIn', { month: formatMonth(ref) })}</span>
                <span className="value-lg num">{formatMoney(spent)}</span>
              </div>
              <div className="stack" style={{ alignItems: 'flex-end' }}>
                {budgetTotal > 0 && <span className="label">{t('home.ofBudget', { amount: formatWhole(budgetTotal) })}</span>}
                {diff !== 0 && (
                  <span className={'pill ' + (diff < 0 ? 'pill--pos' : 'pill--warn')}>
                    {t(diff < 0 ? 'home.lessThan' : 'home.moreThan', {
                      amount: formatWhole(Math.abs(diff)),
                      month: formatMonth(shiftMonth(ref, -1)),
                    })}
                  </span>
                )}
              </div>
            </div>
            <div className="spark" role="img" aria-label={t('home.dailyChart', { amount: formatMoney(maxDay) })}>
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
              <span>{formatShort(startOfMonth(ref))}</span>
              <span>{t('time.today')}</span>
            </div>
          </section>

          {isDesktop && (
            <section className="section" aria-label={t('home.recent')}>
              <div className="section-head">
                <h2 className="section-title">{t('home.recent')}</h2>
                <Link to="/activity" className="link-btn">
                  {t('common.viewAll')}
                </Link>
              </div>
              <div className="list">
                {data.transactions.length === 0 && <p className="empty">{t('home.noTransactions')}</p>}
                {recent.map((tx) => (
                  <TransactionRow key={tx.id} tx={tx} category={categories.get(tx.categoryId)} accountName={accounts.get(tx.accountId)} />
                ))}
              </div>
            </section>
          )}
        </div>

        <div className="col">
          <section className="section" aria-label={t('home.upcomingBills')}>
            <div className="section-head">
              <h2 className="section-title">{t('home.upcomingBills')}</h2>
              <Link to="/bills" className="link-btn">
                {t('common.seeAll')}
              </Link>
            </div>
            <div className="list">
              {upcoming.length === 0 && <p className="empty">{t('home.nothingDue')}</p>}
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

          {isDesktop && <BudgetSummary data={data} />}

          {!isDesktop && (
            <nav className="quick-links" aria-label={t('home.more')}>
              <Link to="/reports" className="quick-link">
                <Icon name="chart" size={22} />
                {t('nav.reports')}
              </Link>
              <Link to="/goals" className="quick-link">
                <Icon name="target" size={22} />
                {t('nav.goals')}
              </Link>
              <Link to="/calendar" className="quick-link">
                <Icon name="calendar" size={22} />
                {t('nav.calendar')}
              </Link>
              <Link to="/friends" className="quick-link">
                <Icon name="rules" size={22} />
                {t('nav.friends')}
              </Link>
              <Link to="/help" className="quick-link">
                <Icon name="help" size={22} />
                {t('nav.help')}
              </Link>
              <Link to="/networth" className="quick-link">
                <Icon name="wallet" size={22} />
                {t('nav.networth')}
              </Link>
              <Link to="/import" className="quick-link">
                <Icon name="upload" size={22} />
                {t('nav.import')}
              </Link>
            </nav>
          )}
        </div>
      </div>
    </main>
  );
}

function BudgetSummary({ data }: { data: FinanceData }) {
  const period = periodFor(today(), data.settings.budgetPeriod, data.settings.payday);
  const own = budgetScope(data);
  const rows = budgetProgress(own.budgets, data.categories, own.transactions, period);
  return (
    <section className="section" aria-label={t('nav.budgets')}>
      <div className="section-head">
        <h2 className="section-title">{t('nav.budgets')}</h2>
        <Link to="/budgets" className="link-btn">
          {t('common.details')}
        </Link>
      </div>
      <div className="card stack" style={{ gap: 14 }}>
        {rows.length === 0 && <p className="empty">{t('home.noBudgets')}</p>}
        {rows.map((r) => {
          const tight = r.ratio >= 0.95;
          return (
            <div key={r.budget.id} className="stack" style={{ gap: 6, ...catVar(r.category.color) }}>
              <div className="row" style={{ justifyContent: 'space-between', fontSize: 14 }}>
                <span className="row" style={{ gap: 8 }} translate="no">
                  <span className="dot" />
                  {r.category.name}
                </span>
                <span className={'num small ' + (tight ? 'text-warn' : 'muted')}>
                  {formatMoney(r.spent)} / {formatWhole(r.limit)}
                </span>
              </div>
              <div
                className="bar"
                role="progressbar"
                aria-label={t('budgets.usedLabel', { name: r.category.name })}
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
