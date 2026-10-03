import { useMemo } from 'react';
import { Link, useParams } from 'react-router';
import { Loading, PageHeader } from '../components/Layout';
import type { FinanceData } from '../db/types';
import { t } from '../i18n';
import { formatMonthYear, today } from '../lib/dates';
import { formatMoney, formatPercent } from '../lib/money';
import { yearReview } from '../lib/reports';

/** A year at a glance; prints cleanly as a report (Print or save as PDF). */
export function YearReview({ data }: { data?: FinanceData }) {
  const params = useParams();
  const thisYear = Number(today().slice(0, 4));
  const year = Number(params.year) || thisYear;
  const review = useMemo(() => (data ? yearReview(data.transactions, data.categories, year) : undefined), [data, year]);
  if (!data || !review) return <Loading />;
  const years = [...new Set(data.transactions.map((x) => Number(x.date.slice(0, 4))))].sort((a, b) => b - a);

  return (
    <main className="screen report-print">
      <PageHeader
        title={t('review.title', { year })}
        subtitle={t('review.subtitle')}
        actions={
          <button type="button" className="btn no-print" onClick={() => window.print()}>
            {t('review.print')}
          </button>
        }
      />
      <nav className="row no-print" style={{ gap: 8, flexWrap: 'wrap' }} aria-label={t('review.years')}>
        {years.map((y) => (
          <Link key={y} to={`/reports/year/${y}`} className="chip" aria-current={y === year ? 'page' : undefined}>
            {y}
          </Link>
        ))}
      </nav>

      {review.transactions === 0 ? (
        <p className="label">{t('review.empty')}</p>
      ) : (
        <>
          <div className="stat-grid">
            <div className="card stack">
              <span className="label">{t('activity.moneyIn')}</span>
              <span className="value-md num text-pos">{formatMoney(review.income)}</span>
            </div>
            <div className="card stack">
              <span className="label">{t('activity.moneyOut')}</span>
              <span className="value-md num">{formatMoney(review.spending)}</span>
            </div>
            <div className="card stack">
              <span className="label">{t('review.saved')}</span>
              <span className="value-md num">{formatMoney(review.saved, { sign: true })}</span>
            </div>
            <div className="card stack">
              <span className="label">{t('reports.savingsRate')}</span>
              <span className="value-md num">{review.savingsRate === undefined ? '—' : formatPercent(review.savingsRate)}</span>
            </div>
          </div>

          <section className="card stack" style={{ gap: 8 }}>
            <h2 className="section-title">{t('review.highlights')}</h2>
            <p>{t('review.count', { count: review.transactions })}</p>
            <p>{t('review.bills', { amount: formatMoney(review.bills) })}</p>
            {review.biggestMonth && (
              <p>
                {t('review.biggestMonth', {
                  month: formatMonthYear(review.biggestMonth.month),
                  amount: formatMoney(review.biggestMonth.spending),
                })}
              </p>
            )}
          </section>

          <div className="report-grid">
            <section className="card stack" style={{ gap: 8 }}>
              <h2 className="section-title">{t('review.topCategories')}</h2>
              <ol className="rank">
                {review.topCategories.map((c) => (
                  <li key={c.category.id}>
                    <span className="grow item-title">{c.category.name}</span>
                    <span className="small muted">{formatPercent(c.share)}</span>
                    <span className="num">{formatMoney(c.total)}</span>
                  </li>
                ))}
              </ol>
            </section>
            <section className="card stack" style={{ gap: 8 }}>
              <h2 className="section-title">{t('reports.topPayees')}</h2>
              <ol className="rank">
                {review.topPayees.map((p) => (
                  <li key={p.payee}>
                    <span className="grow item-title" translate="no">
                      {p.payee}
                    </span>
                    <span className="small muted">{t('reports.times', { count: p.count })}</span>
                    <span className="num">{formatMoney(p.total)}</span>
                  </li>
                ))}
              </ol>
            </section>
          </div>
        </>
      )}
      <Link to="/reports" className="link-btn no-print" style={{ alignSelf: 'flex-start' }}>
        {t('review.backToReports')}
      </Link>
    </main>
  );
}
