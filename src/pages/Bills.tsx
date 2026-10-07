/**
 * Bills: what is due in the next 30 days (and overdue), all bills, card subscriptions, price-rise alerts and
 * suggested bills, with the month's committed and paid totals.
 */
import { useState } from 'react';
import { Link } from 'react-router';
import { Icon } from '../components/Icon';
import { Loading, PageHeader } from '../components/Layout';
import { BillRow, catVar, ruleLabel } from '../components/rows';
import { useToast } from '../components/ui/Toast';
import { useIsDesktop } from '../components/useMediaQuery';
import { deleteTransaction, dismissPriceAlert, dismissSuggestion, markBillPaid } from '../db/repo';
import type { FinanceData, Recurring } from '../db/types';
import { addDays, dueLabel, endOfMonth, formatMonth, formatShort, startOfMonth, today, type ISODate } from '../lib/dates';
import { formatMoney } from '../lib/money';
import { detectRecurring, type RecurringSuggestion } from '../lib/matching';
import { nextOccurrence } from '../lib/recurring';
import { billOccurrences, MATCH_WINDOW_DAYS, overdueBills, type BillOccurrence } from '../lib/selectors';
import { t } from '../i18n';

type Tab = 'upcoming' | 'all' | 'subscriptions';
const TABS: { id: Tab; label: string }[] = [
  { id: 'upcoming', label: 'bills.tabs.upcoming' },
  { id: 'all', label: 'bills.tabs.all' },
  { id: 'subscriptions', label: 'bills.tabs.subscriptions' },
];

/** Bills → Upcoming lists what is due this many days ahead. */
const UPCOMING_DAYS = 30;

const PER_YEAR: Record<Recurring['frequency'], number> = { weekly: 52, monthly: 12, yearly: 1 };
const freqLabel = (f: Recurring['frequency']) => t(`bills.freq.${f}`);

const isOverdue = (o: BillOccurrence, ref: ISODate) => !o.paid && o.date < addDays(ref, -MATCH_WINDOW_DAYS);
/** Mark-as-paid is offered once a bill is due (or nearly). */
const canMarkPaid = (o: BillOccurrence, ref: ISODate) => !o.paid && o.date <= addDays(ref, 2);

function Status({ o, refDate }: { o: BillOccurrence; refDate: ISODate }) {
  if (o.paid)
    return (
      <span className="row muted" style={{ gap: 6 }}>
        <Icon name="check" size={16} strokeWidth={2.2} />
        {t('bills.paid')}
      </span>
    );
  if (isOverdue(o, refDate)) return <span className="pill pill--warn">{t('bills.overdue')}</span>;
  return <span className="muted">{dueLabel(o.date, refDate)}</span>;
}

function suggestionLink(s: RecurringSuggestion) {
  const q = new URLSearchParams({
    name: s.payee,
    amount: String(s.amount),
    frequency: s.frequency,
    date: s.nextDate,
    category: s.categoryId,
    account: s.accountId,
  });
  return `/bills/new?${q}`;
}

/** The Bills screen. */
export function Bills({ data }: { data?: FinanceData }) {
  const [tab, setTab] = useState<Tab>('upcoming');
  const isDesktop = useIsDesktop();
  const toast = useToast();
  if (!data) return <Loading />;

  const ref = today();
  const month = billOccurrences(data.recurring, data.transactions, startOfMonth(ref), endOfMonth(ref));
  const overdue = overdueBills(data, ref).filter((o) => o.date < startOfMonth(ref)); // earlier months; this month's are in `month`
  const committed = month.reduce((s, o) => s + o.rule.amount, 0);
  const paid = month.filter((o) => o.paid).reduce((s, o) => s + o.rule.amount, 0);
  // What is due: anything unpaid this month, and the next 30 days even when they run into next
  // month, so a bill added for early next month shows straight away.
  const horizon = addDays(ref, UPCOMING_DAYS);
  const ahead = horizon > endOfMonth(ref) ? billOccurrences(data.recurring, data.transactions, addDays(endOfMonth(ref), 1), horizon) : [];
  const due = [...overdue, ...month.filter((o) => !o.paid), ...ahead.filter((o) => !o.paid)];
  const hasBills = data.recurring.some((r) => r.active);
  const done = month.filter((o) => o.paid);
  const priceRises = data.recurring.filter(
    (r) => r.active && !r.priceAlertDismissed && r.previousAmount !== undefined && r.amount > r.previousAmount,
  );
  const active = data.recurring
    .filter((r) => r.active)
    .map((rule) => ({ rule, next: nextOccurrence(rule, ref) }))
    .filter((a) => !a.rule.endDate || !a.next || a.next <= a.rule.endDate)
    .sort((a, b) => (a.next ?? '9999').localeCompare(b.next ?? '9999'));
  const paused = data.recurring.filter((r) => !r.active);
  const subscriptions = active.filter((a) => a.rule.method === 'card');
  const recurringList = tab === 'all' ? active : subscriptions;
  const nextDue = due.find((o) => o.date >= ref);
  const dismissed = new Set(data.settings.dismissedSuggestions ?? []);
  const suggestions = detectRecurring(data.transactions, data.recurring, ref).filter((s) => !dismissed.has(s.key));

  async function pay(o: BillOccurrence) {
    const id = await markBillPaid(o.rule, o.date);
    toast({
      message: t('bills.markedPaid', { name: o.rule.name }),
      action: {
        label: t('common.undo'),
        onClick: async () => {
          await deleteTransaction(id);
        },
      },
    });
  }

  const markPaidButton = (o: BillOccurrence) =>
    canMarkPaid(o, ref) && (
      <button type="button" className="btn btn--sm" onClick={() => pay(o)}>
        {t('bills.markPaid')}
      </button>
    );

  const tabs = (
    <div className="segmented" role="tablist" aria-label={t('bills.views')}>
      {TABS.map((tb) => (
        <button key={tb.id} type="button" role="tab" aria-selected={tab === tb.id} onClick={() => setTab(tb.id)}>
          {t(tb.label)}
        </button>
      ))}
    </div>
  );

  const addButton = isDesktop ? (
    <Link to="/bills/new" className="btn btn--solid">
      <Icon name="plus" size={18} strokeWidth={2.2} />
      {t('bills.add')}
    </Link>
  ) : (
    <Link to="/bills/new" className="icon-btn" aria-label={t('bills.add')}>
      <Icon name="plus" size={20} strokeWidth={2} />
    </Link>
  );

  const summary = (
    <section className="card stack" style={{ gap: 12 }} aria-label={t('bills.commitments', { month: formatMonth(ref) })}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <div className="stack">
          <span className="label">{t('bills.committedIn', { month: formatMonth(ref) })}</span>
          <span className="value-lg num">{formatMoney(committed)}</span>
        </div>
        <span className="label">{t('bills.payments', { count: month.length })}</span>
      </div>
      <div className="bar bar--thick" style={catVar('bills')}>
        <span style={{ width: `${committed ? (paid / committed) * 100 : 0}%` }} />
      </div>
      <div className="row small" style={{ justifyContent: 'space-between', fontSize: 13 }}>
        <span className="row" style={{ gap: 6 }}>
          <span className="dot" style={catVar('bills')} />
          {t('bills.paidAmount', { amount: formatMoney(paid) })}
        </span>
        <span className="row" style={{ gap: 6 }}>
          <span className="dot" style={{ background: 'var(--track)', border: '1px solid var(--border)' }} />
          {t('bills.stillToGo', { amount: formatMoney(committed - paid) })}
        </span>
      </div>
    </section>
  );

  const alerts = priceRises.map((r) => (
    <section key={r.id} className="callout" aria-label={t('bills.priceChange')}>
      <span className="callout-icon">
        <Icon name="trendUp" size={20} />
      </span>
      <div className="stack grow" style={{ gap: 2 }}>
        <span style={{ fontSize: 14, fontWeight: 600 }}>
          {t('bills.wentUp', { name: r.name, amount: formatMoney(r.amount - (r.previousAmount ?? 0)) })}
        </span>
        <span className="label">{t('bills.nowWas', { now: formatMoney(r.amount), was: formatMoney(r.previousAmount ?? 0) })}</span>
      </div>
      <button
        type="button"
        className="icon-btn icon-btn--ghost"
        aria-label={t('bills.dismissAlert', { name: r.name })}
        onClick={() => dismissPriceAlert(r.id)}
      >
        <Icon name="close" size={18} />
      </button>
    </section>
  ));

  const suggestionSection = suggestions.length > 0 && (
    <section className="section" aria-label={t('bills.suggested')}>
      <h2 className="section-title">{t('bills.looksRegular')}</h2>
      <div className="list">
        {suggestions.map((s) => (
          <div key={s.key} className="list-row">
            <div className="tile" style={catVar('bills')} aria-hidden="true">
              <Icon name="calendar" size={18} />
            </div>
            <div className="grow stack" style={{ gap: 2 }}>
              <span className="item-title">{s.payee}</span>
              <span className="item-meta">
                {t(s.frequency === 'weekly' ? 'bills.suggestionWeekly' : 'bills.suggestionMonthly', {
                  amount: formatMoney(s.amount),
                  count: s.count,
                })}
              </span>
            </div>
            <Link to={suggestionLink(s)} className="btn btn--sm">
              {t('bills.addAsBill')}
            </Link>
            <button
              type="button"
              className="icon-btn icon-btn--ghost"
              aria-label={t('bills.notABill', { name: s.payee })}
              onClick={() => dismissSuggestion(s.key)}
            >
              <Icon name="close" size={18} />
            </button>
          </div>
        ))}
      </div>
    </section>
  );

  if (isDesktop) {
    return (
      <main className="screen">
        <PageHeader
          title={t('bills.title')}
          subtitle={t('bills.subtitle')}
          actions={
            <>
              {tabs}
              {addButton}
            </>
          }
        />
        <div className="split">
          {summary}
          <div className="stack" style={{ gap: 12 }}>
            {nextDue && (
              <section className="card row" aria-label={t('bills.nextPayment')}>
                <div className="grow stack">
                  <span className="label">{t('bills.nextPayment')}</span>
                  <span className="value-md">{nextDue.rule.name}</span>
                  <span className="label">
                    {ruleLabel(nextDue.rule)} · {dueLabel(nextDue.date, ref)}
                  </span>
                </div>
                <span className="value-md num">{formatMoney(nextDue.rule.amount)}</span>
              </section>
            )}
            {alerts}
          </div>
        </div>

        {tab === 'upcoming' ? (
          <div className="table-card">
            <table className="table">
              <caption className="visually-hidden">{t('bills.comingUp')}</caption>
              <thead>
                <tr>
                  <th scope="col">{t('columns.due')}</th>
                  <th scope="col">{t('columns.payee')}</th>
                  <th scope="col">{t('columns.type')}</th>
                  <th scope="col">{t('columns.status')}</th>
                  <th scope="col" className="num-col">
                    {t('columns.amount')}
                  </th>
                  <th scope="col">
                    <span className="visually-hidden">{t('columns.actions')}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {due.length + done.length === 0 && (
                  <tr>
                    <td colSpan={6} className="empty">
                      {hasBills ? t('bills.nothingSoon') : t('bills.noneThisMonth')} <Link to="/bills/new">{t('bills.addFirst')}</Link>
                    </td>
                  </tr>
                )}
                {[...due, ...done].map((o) => (
                  <tr key={o.rule.id + o.date} className={o.paid ? 'is-muted' : undefined}>
                    <td className="num">{formatShort(o.date)}</td>
                    <td>
                      <Link to={`/bills/${o.rule.id}`} className="item-title row-link">
                        {o.rule.name}
                      </Link>
                    </td>
                    <td className="muted">{ruleLabel(o.rule)}</td>
                    <td>
                      <Status o={o} refDate={ref} />
                    </td>
                    <td className="num-col amount">{formatMoney(o.rule.amount)}</td>
                    <td className="num-col">{markPaidButton(o)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="table-card">
            <table className="table">
              <caption className="visually-hidden">{tab === 'all' ? t('bills.allRecurring') : t('bills.cardSubscriptions')}</caption>
              <thead>
                <tr>
                  <th scope="col">{t('columns.payee')}</th>
                  <th scope="col">{t('columns.type')}</th>
                  <th scope="col">{t('columns.frequency')}</th>
                  <th scope="col">{t('columns.nextPayment')}</th>
                  <th scope="col" className="num-col">
                    {t('columns.amount')}
                  </th>
                  <th scope="col" className="num-col">
                    {t('columns.perYear')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {recurringList.length === 0 && (
                  <tr>
                    <td colSpan={6} className="empty">
                      {t('common.noneYet')}
                    </td>
                  </tr>
                )}
                {recurringList.map(({ rule, next }) => (
                  <tr key={rule.id}>
                    <td>
                      <Link to={`/bills/${rule.id}`} className="item-title row-link">
                        {rule.name}
                      </Link>
                    </td>
                    <td className="muted">{ruleLabel(rule)}</td>
                    <td className="muted">{freqLabel(rule.frequency)}</td>
                    <td className="num">{next ? formatShort(next) : '—'}</td>
                    <td className="num-col amount">{formatMoney(rule.amount)}</td>
                    <td className="num-col num muted">{formatMoney(rule.amount * PER_YEAR[rule.frequency])}</td>
                  </tr>
                ))}
                {tab === 'all' &&
                  paused.map((rule) => (
                    <tr key={rule.id} className="is-muted">
                      <td>
                        <Link to={`/bills/${rule.id}`} className="item-title row-link">
                          {rule.name}
                        </Link>
                      </td>
                      <td>{ruleLabel(rule)}</td>
                      <td>{freqLabel(rule.frequency)}</td>
                      <td>{t('bills.paused')}</td>
                      <td className="num-col">{formatMoney(rule.amount)}</td>
                      <td className="num-col">—</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
        {suggestionSection}
      </main>
    );
  }

  return (
    <main className="screen">
      <PageHeader title={t('bills.title')} actions={addButton} />
      {tabs}
      {summary}
      {alerts}

      {tab === 'upcoming' && (
        <>
          <section className="section">
            <h2 className="section-label">{t('bills.comingUp')}</h2>
            <div className="list">
              {due.length === 0 && (
                <p className="empty">
                  {month.length
                    ? t('bills.allPaidFor', { month: formatMonth(ref) })
                    : hasBills
                      ? t('bills.nothingSoon')
                      : t('bills.noBills')}
                </p>
              )}
              {due.map((o) => (
                <BillRow
                  key={o.rule.id + o.date}
                  rule={o.rule}
                  date={o.date}
                  to={`/bills/${o.rule.id}`}
                  meta={
                    isOverdue(o, ref) ? (
                      <span className="text-warn">{t('bills.overdueOn', { date: formatShort(o.date) })}</span>
                    ) : (
                      `${ruleLabel(o.rule)} · ${dueLabel(o.date, ref)}`
                    )
                  }
                  trailing={
                    canMarkPaid(o, ref) ? (
                      <span className="stack" style={{ alignItems: 'flex-end', gap: 4 }}>
                        <span className="amount">{formatMoney(o.rule.amount)}</span>
                        {markPaidButton(o)}
                      </span>
                    ) : undefined
                  }
                />
              ))}
            </div>
          </section>
          {done.length > 0 && (
            <section className="section">
              <h2 className="section-label">{t('bills.paid')}</h2>
              <div className="list">
                {done.map((o) => (
                  <BillRow key={o.rule.id + o.date} rule={o.rule} date={o.date} to={`/bills/${o.rule.id}`} meta={ruleLabel(o.rule)} paid />
                ))}
              </div>
            </section>
          )}
        </>
      )}

      {tab !== 'upcoming' && (
        <section className="section">
          <h2 className="section-label">{tab === 'all' ? t('bills.allRecurring') : t('bills.cardSubscriptions')}</h2>
          <div className="list">
            {recurringList.length === 0 && <p className="empty">{t('common.noneYet')}</p>}
            {recurringList.map(({ rule, next }) => (
              <BillRow
                key={rule.id}
                rule={rule}
                date={next ?? rule.startDate}
                to={`/bills/${rule.id}`}
                meta={[ruleLabel(rule), freqLabel(rule.frequency), next && t('bills.nextOn', { date: formatShort(next) })]
                  .filter(Boolean)
                  .join(' · ')}
                trailing={
                  <span className="stack" style={{ alignItems: 'flex-end', gap: 2 }}>
                    <span className="amount">{formatMoney(rule.amount)}</span>
                    <span className="small muted num">
                      {t('bills.perYearShort', { amount: formatMoney(rule.amount * PER_YEAR[rule.frequency]) })}
                    </span>
                  </span>
                }
              />
            ))}
            {tab === 'all' &&
              paused.map((rule) => (
                <BillRow key={rule.id} rule={rule} date={rule.startDate} to={`/bills/${rule.id}`} meta={t('bills.paused')} paid />
              ))}
          </div>
        </section>
      )}
      {suggestionSection}
    </main>
  );
}
