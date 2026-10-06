/**
 * Tax helper: income and expenses marked with a tax heading, totalled per tax year (UK or France), with a CSV
 * export for an accountant.
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { Loading, PageHeader } from '../components/Layout';
import { downloadFile } from '../components/ui/download';
import { Field } from '../components/ui/forms';
import { updateSettings } from '../db/repo';
import type { FinanceData } from '../db/types';
import { t } from '../i18n';
import { formatDate, today } from '../lib/dates';
import { regionName } from '../lib/format';
import { formatMoney } from '../lib/money';
import { TAX_SYSTEMS, taxSummary, taxSystem, taxYearOf, taxYearRange } from '../lib/tax';

/** The Tax helper screen. */
export function Tax({ data }: { data?: FinanceData }) {
  const system = taxSystem(data?.settings.taxCountry);
  const current = taxYearOf(system, today());
  const [year, setYear] = useState(current);
  const summary = useMemo(() => (data ? taxSummary(data.transactions, system, year) : []), [data, system, year]);
  if (!data) return <Loading />;
  const { from, to } = taxYearRange(system, year);
  const yearLabel = (y: number) => (system.yearStart === '01-01' ? String(y) : `${y}–${String(y + 1).slice(2)}`);
  const income = summary.filter((s) => s.heading.kind === 'income').reduce((s, x) => s + x.total, 0);
  const expenses = summary.filter((s) => s.heading.kind === 'expense').reduce((s, x) => s + x.total, 0);

  function exportCsv() {
    const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    const lines = [[t('tax.csv.heading'), t('tax.csv.date'), t('tax.csv.payee'), t('tax.csv.amount'), t('tax.csv.note')].join(',')];
    for (const s of summary)
      for (const x of s.items)
        lines.push([t(s.heading.label), x.date, x.payee, (Math.abs(x.amount) / 100).toFixed(2), x.note ?? ''].map(esc).join(','));
    downloadFile(`mizan-tax-${yearLabel(year)}.csv`, lines.join('\n'), 'text/csv');
  }

  return (
    <main className="screen report-print">
      <PageHeader title={t('tax.title')} subtitle={t('tax.subtitle')} />
      <p className="small muted">{t('tax.disclaimer')}</p>
      <div className="list no-print">
        <Field label={t('tax.country')}>
          {(id) => (
            <select id={id} value={system.country} onChange={(e) => updateSettings({ taxCountry: e.target.value })}>
              {TAX_SYSTEMS.map((s) => (
                <option key={s.country} value={s.country}>
                  {regionName(s.country)}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label={t('tax.year')}>
          {(id) => (
            <select id={id} value={year} onChange={(e) => setYear(Number(e.target.value))}>
              {[current, current - 1, current - 2, current - 3].map((y) => (
                <option key={y} value={y}>
                  {yearLabel(y)}
                </option>
              ))}
            </select>
          )}
        </Field>
      </div>
      <p className="label">{t('tax.range', { from: formatDate(from), to: formatDate(to) })}</p>

      <div className="stat-grid">
        <div className="card stack">
          <span className="label">{t('tax.totalIncome')}</span>
          <span className="value-md num">{formatMoney(income)}</span>
        </div>
        <div className="card stack">
          <span className="label">{t('tax.totalExpenses')}</span>
          <span className="value-md num">{formatMoney(expenses)}</span>
        </div>
      </div>

      {summary.map((s) => (
        <section className="section" key={s.heading.id}>
          <h2 className="section-label">
            {t(s.heading.label)} · {formatMoney(s.total)}
          </h2>
          {s.items.length === 0 ? (
            <p className="small muted" style={{ padding: '0 4px' }}>
              {t('tax.noneMarked')}
            </p>
          ) : (
            <div className="list">
              {s.items.map((x) => (
                <Link key={x.id} to={`/transactions/${x.id}`} className="list-row list-row--link">
                  <div className="grow stack" style={{ gap: 2 }}>
                    <span className="item-title" translate="no">
                      {x.payee}
                    </span>
                    <span className="item-meta">{formatDate(x.date)}</span>
                  </div>
                  <span className="amount">{formatMoney(Math.abs(x.amount))}</span>
                </Link>
              ))}
            </div>
          )}
        </section>
      ))}

      <div className="row no-print" style={{ gap: 8, flexWrap: 'wrap' }}>
        <button type="button" className="btn btn--solid" onClick={exportCsv}>
          {t('tax.export')}
        </button>
        <button type="button" className="btn" onClick={() => window.print()}>
          {t('review.print')}
        </button>
      </div>
      <p className="small muted">{t('tax.howTo')}</p>
    </main>
  );
}
