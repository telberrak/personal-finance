import { useState } from 'react';
import { Link } from 'react-router';
import { BalanceLine, Donut, GroupedBars, Sparkline } from '../components/charts';
import { Field } from '../components/ui/forms';
import { Loading, PageHeader } from '../components/Layout';
import { catVar } from '../components/rows';
import type { FinanceData } from '../db/types';
import { endOfMonth, formatMonthShort, formatShort, shiftMonth, startOfMonth, today } from '../lib/dates';
import { forecastBalance } from '../lib/forecast';
import { formatMoney, formatPercent, formatWhole } from '../lib/money';
import { categoryTrends, comparePeriods, monthlyTotals, previousPeriod, spendByCategory, topPayees } from '../lib/reports';
import { moneyInOut } from '../lib/selectors';
import { t } from '../i18n';

type Range = 'this' | 'last' | '3m' | '6m' | 'custom';
const RANGES: { id: Range; label: string }[] = [
  { id: 'this', label: 'reports.range.this' },
  { id: 'last', label: 'reports.range.last' },
  { id: '3m', label: 'reports.range.3m' },
  { id: '6m', label: 'reports.range.6m' },
  { id: 'custom', label: 'reports.range.custom' },
];

function rangeDates(range: Range, ref: string, custom: { from: string; to: string }) {
  switch (range) {
    case 'custom':
      return custom.from <= custom.to ? custom : { from: custom.to, to: custom.from };
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
  const ref = today();
  const [custom, setCustom] = useState(() => ({ from: startOfMonth(shiftMonth(ref, -2)), to: ref }));
  const [compare, setCompare] = useState(false);
  if (!data) return <Loading />;

  const { from, to } = rangeDates(range, ref, custom);
  const before = previousPeriod(from, to);
  const comparison = compare ? comparePeriods(data.transactions, data.categories, { from, to }, before) : [];
  const trends = categoryTrends(data.transactions, data.categories, ref, 12);
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
        title={t('reports.title')}
        actions={
          <div className="segmented" role="radiogroup" aria-label={t('reports.period')}>
            {RANGES.map((r) => (
              <button key={r.id} type="button" role="radio" aria-checked={range === r.id} onClick={() => setRange(r.id)}>
                {t(r.label)}
              </button>
            ))}
          </div>
        }
      />

      {range === 'custom' && (
        <div className="list">
          <Field label={t('search.from')}>
            {(id) => (
              <input
                id={id}
                type="date"
                value={custom.from}
                max={ref}
                onChange={(e) => e.target.value && setCustom((c) => ({ ...c, from: e.target.value }))}
              />
            )}
          </Field>
          <Field label={t('search.to')}>
            {(id) => (
              <input
                id={id}
                type="date"
                value={custom.to}
                max={ref}
                onChange={(e) => e.target.value && setCustom((c) => ({ ...c, to: e.target.value }))}
              />
            )}
          </Field>
        </div>
      )}
      <nav className="row" style={{ gap: 8, flexWrap: 'wrap' }} aria-label={t('reports.more')}>
        <Link to="/calendar" className="chip">
          {t('nav.calendar')}
        </Link>
        <Link to={`/reports/year/${ref.slice(0, 4)}`} className="chip">
          {t('reports.yearInReview')}
        </Link>
        <Link to="/tax" className="chip">
          {t('reports.taxHelper')}
        </Link>
      </nav>

      <div className="stat-grid">
        <div className="card stack">
          <span className="label">{t('activity.moneyIn')}</span>
          <span className="value-md num text-pos">{formatMoney(moneyIn)}</span>
        </div>
        <div className="card stack">
          <span className="label">{t('activity.moneyOut')}</span>
          <span className="value-md num">{formatMoney(moneyOut)}</span>
        </div>
        <div className="card stack">
          <span className="label">{t('activity.net')}</span>
          <span className="value-md num">{formatMoney(moneyIn - moneyOut, { sign: true })}</span>
        </div>
        <div className="card stack">
          <span className="label">{t('reports.savingsRate')}</span>
          <span className="value-md num">{savingsRate === undefined ? '—' : formatPercent(savingsRate / 100)}</span>
        </div>
      </div>

      <div className="report-grid">
        <section className="card stack" style={{ gap: 16 }} aria-label={t('reports.byCategory')}>
          <h2 className="section-title">{t('reports.whereWent')}</h2>
          {byCategory.length === 0 ? (
            <p className="empty">{t('reports.noSpending')}</p>
          ) : (
            <div className="donut-layout">
              <Donut
                label={t('reports.byCategoryTotal', { amount: formatMoney(totalSpent) })}
                segments={byCategory.map((r) => ({ value: r.total, color: `var(--cat-${r.category.color})` }))}
                center={
                  <>
                    <span className="small muted">{t('reports.spent')}</span>
                    <span className="value-md num">{formatWhole(totalSpent)}</span>
                  </>
                }
              />
              <ul className="legend">
                {byCategory.map((r) => (
                  <li key={r.category.id} style={catVar(r.category.color)}>
                    <span className="dot" />
                    <span className="grow">{r.category.name}</span>
                    <span className="num muted small">{formatPercent(r.share)}</span>
                    <span className="num" style={{ minWidth: 84, textAlign: 'end' }}>
                      {formatMoney(r.total)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>

        <section className="card stack" style={{ gap: 16 }} aria-label={t('reports.byMonth')}>
          <h2 className="section-title">{t('reports.lastSix')}</h2>
          <GroupedBars
            caption={t('reports.byMonth')}
            groups={months.map((m) => ({ label: formatMonthShort(m.month), values: [m.income, m.spending] }))}
            series={[
              { name: t('activity.moneyIn'), color: 'var(--cat-income)' },
              { name: t('activity.moneyOut'), color: 'var(--accent)' },
            ]}
          />
        </section>

        <section className="card stack" style={{ gap: 12 }} aria-label={t('reports.topPayees')}>
          <h2 className="section-title">{t('reports.topPayees')}</h2>
          {payees.length === 0 && <p className="empty">{t('reports.noSpending')}</p>}
          <ol className="rank">
            {payees.map((p) => (
              <li key={p.payee}>
                <span className="grow item-title">{p.payee}</span>
                <span className="small muted">{t('reports.times', { count: p.count })}</span>
                <span className="num" style={{ minWidth: 84, textAlign: 'end' }}>
                  {formatMoney(p.total)}
                </span>
              </li>
            ))}
          </ol>
        </section>

        <section className="card stack" style={{ gap: 12 }} aria-label={t('reports.forecast')}>
          <div className="section-head">
            <h2 className="section-title">{t('reports.forecast')}</h2>
            <span className={'pill ' + (low ? 'pill--warn' : 'pill--pos')}>{low ? t('reports.mayRunLow') : t('reports.onTrack')}</span>
          </div>
          <BalanceLine
            points={forecast.points}
            threshold={data.settings.lowBalanceThreshold}
            label={t('reports.forecastLabel', { amount: formatMoney(forecast.lowest.balance) })}
          />
          <p className="small muted">
            {t('reports.forecastExplain', { daily: formatMoney(forecast.avgDailySpend), income: formatMoney(forecast.expectedIncome) })}{' '}
            {t('reports.dashedPrefix')}
            <Link to="/settings">{t('reports.lowBalanceWarning')}</Link>
            {t('reports.dashedSuffix')}
          </p>
        </section>
      </div>
      <section className="card stack" style={{ gap: 12 }} aria-labelledby="compare-title">
        <div className="section-head">
          <h2 className="section-title" id="compare-title">
            {t('reports.compareTitle')}
          </h2>
          <label className="row small" style={{ gap: 6 }}>
            <input type="checkbox" checked={compare} onChange={(e) => setCompare(e.target.checked)} />
            {t('reports.compareWith', { from: formatShort(before.from), to: formatShort(before.to) })}
          </label>
        </div>
        {compare &&
          (comparison.length === 0 ? (
            <p className="empty">{t('reports.noSpending')}</p>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">{t('fields.category')}</th>
                  <th scope="col" className="num-col">
                    {t('reports.thisPeriod')}
                  </th>
                  <th scope="col" className="num-col">
                    {t('reports.previousPeriod')}
                  </th>
                  <th scope="col" className="num-col">
                    {t('reports.change')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {comparison.map((r) => (
                  <tr key={r.category.id}>
                    <th scope="row" translate="no">
                      {r.category.name}
                    </th>
                    <td className="num-col num">{formatMoney(r.current)}</td>
                    <td className="num-col num">{formatMoney(r.previous)}</td>
                    <td className={'num-col num' + (r.change > 0 ? ' text-warn' : r.change < 0 ? ' text-pos' : '')}>
                      {formatMoney(r.change, { sign: true })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ))}
      </section>

      {trends.length > 0 && (
        <section className="card stack" style={{ gap: 12 }} aria-labelledby="trends-title">
          <h2 className="section-title" id="trends-title">
            {t('reports.trendsTitle')}
          </h2>
          <table className="table">
            <thead>
              <tr>
                <th scope="col">{t('fields.category')}</th>
                <th scope="col">{t('reports.twelveMonths')}</th>
                <th scope="col" className="num-col">
                  {t('reports.monthlyAverage')}
                </th>
              </tr>
            </thead>
            <tbody>
              {trends.map((r) => (
                <tr key={r.category.id}>
                  <th scope="row" translate="no">
                    {r.category.name}
                  </th>
                  <td>
                    <Sparkline
                      values={r.months}
                      label={t('reports.trendLabel', { name: r.category.name })}
                      color={`var(--cat-${r.category.color})`}
                    />
                  </td>
                  <td className="num-col num">{formatMoney(r.average)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
      <p className="small muted">{t('reports.transfersExcluded')}</p>
    </main>
  );
}
