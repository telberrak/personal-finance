import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Loading, MonthSwitcher, PageHeader } from '../components/Layout';
import type { FinanceData } from '../db/types';
import { t } from '../i18n';
import { calendarMonth, type CalendarDay } from '../lib/calendar';
import { dateFormat, localeWeekStart } from '../lib/format';
import { formatDay, formatLong, shiftMonth, startOfMonth, today } from '../lib/dates';
import { formatMoney, formatWhole } from '../lib/money';

/** Weekday names in the display language, starting on `first` (1 Monday … 7 Sunday). */
function weekdays(first: number): string[] {
  const f = dateFormat({ weekday: 'short' });
  return Array.from({ length: 7 }, (_, i) => f.format(new Date(2024, 0, ((first - 1 + i) % 7) + 1))); // 1 Jan 2024 was a Monday
}

export function Calendar({ data }: { data?: FinanceData }) {
  const [params, setParams] = useSearchParams();
  const ref = today();
  const month = params.get('month') ?? startOfMonth(ref);
  const [selected, setSelected] = useState<string>(ref);
  const first = data?.settings.weekStart ?? localeWeekStart();
  // calendarMonth counts days like Date#getDay: 0 is Sunday.
  const weeks = useMemo(() => (data ? calendarMonth(data, month, ref, first % 7) : []), [data, month, ref, first]);
  if (!data) return <Loading />;
  const days = weeks.flat();
  const day = days.find((d) => d.date === selected) ?? days.find((d) => d.inMonth)!;
  const names = weekdays(first);

  return (
    <main className="screen">
      <PageHeader
        title={t('calendar.title')}
        subtitle={t('calendar.subtitle')}
        // Up to three months ahead: the forecast is useful there.
        actions={<MonthSwitcher month={month} current={startOfMonth(shiftMonth(ref, 3))} onChange={(m) => setParams({ month: m })} />}
      />
      <div className="calendar-layout">
        <div className="calendar card" role="grid" aria-label={t('calendar.gridLabel')}>
          <div className="calendar-row calendar-head" role="row">
            {names.map((n) => (
              <span key={n} role="columnheader" className="small muted">
                {n}
              </span>
            ))}
          </div>
          {weeks.map((week) => (
            <div className="calendar-row" role="row" key={week[0].date}>
              {week.map((d) => (
                <DayCell key={d.date} day={d} today={d.date === ref} selected={d.date === day.date} onSelect={() => setSelected(d.date)} />
              ))}
            </div>
          ))}
        </div>
        <DayDetails day={day} />
      </div>
      <p className="small muted">{t('calendar.legend')}</p>
    </main>
  );
}

function DayCell({
  day,
  today: isToday,
  selected,
  onSelect,
}: {
  day: CalendarDay;
  today: boolean;
  selected: boolean;
  onSelect: () => void;
}) {
  const unpaid = day.bills.filter((b) => !b.paid).length;
  const label = [
    formatLong(day.date),
    day.payday ? t('calendar.payday') : '',
    day.bills.length ? t('calendar.billsCount', { count: day.bills.length }) : '',
    day.balance !== undefined
      ? t(day.forecast ? 'calendar.forecastBalance' : 'calendar.balance', { amount: formatMoney(day.balance) })
      : '',
  ]
    .filter(Boolean)
    .join(', ');
  return (
    <button
      type="button"
      role="gridcell"
      aria-selected={selected}
      aria-label={label}
      className={[
        'calendar-day',
        day.inMonth ? '' : 'is-outside',
        isToday ? 'is-today' : '',
        selected ? 'is-selected' : '',
        day.low ? 'is-low' : '',
      ].join(' ')}
      onClick={onSelect}
    >
      <span className="calendar-date">{formatDay(day.date)}</span>
      <span className="calendar-marks" aria-hidden="true">
        {day.payday && <span className="mark mark--pay" />}
        {unpaid > 0 && <span className="mark mark--bill" />}
        {day.bills.length > unpaid && <span className="mark mark--paid" />}
      </span>
      {day.balance !== undefined && (
        <span className={'calendar-balance num' + (day.forecast ? ' is-forecast' : '')} aria-hidden="true">
          {formatWhole(day.balance)}
        </span>
      )}
    </button>
  );
}

function DayDetails({ day }: { day: CalendarDay }) {
  return (
    <section className="card stack" style={{ gap: 12 }} aria-live="polite" aria-label={t('calendar.details')}>
      <h2 className="section-title">{formatLong(day.date)}</h2>
      {day.balance !== undefined && (
        <p className={day.low ? 'text-warn' : ''}>
          {t(day.forecast ? 'calendar.forecastBalance' : 'calendar.balance', { amount: formatMoney(day.balance) })}
        </p>
      )}
      {day.payday && (
        <p className="pill pill--pos" style={{ alignSelf: 'flex-start' }}>
          {t('calendar.payday')}
        </p>
      )}
      {day.bills.length > 0 && (
        <ul className="stack" style={{ gap: 6, listStyle: 'none', padding: 0 }}>
          {day.bills.map((b) => (
            <li key={b.rule.id} className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
              <Link to={`/bills/${b.rule.id}`} translate="no">
                {b.rule.name}
              </Link>
              <span className="small muted">{b.paid ? t('calendar.paid') : t('calendar.due')}</span>
              <span className="num">{formatMoney(-b.rule.amount)}</span>
            </li>
          ))}
        </ul>
      )}
      {(day.income > 0 || day.spending > 0) && (
        <p className="small">
          {t('calendar.inOut', { in: formatMoney(day.income), out: formatMoney(day.spending) })}{' '}
          <Link to={`/activity?month=${startOfMonth(day.date)}`}>{t('calendar.seeActivity')}</Link>
        </p>
      )}
      {!day.payday && day.bills.length === 0 && day.income === 0 && day.spending === 0 && (
        <p className="small muted">{day.forecast ? t('calendar.nothingDue') : t('calendar.quietDay')}</p>
      )}
    </section>
  );
}
