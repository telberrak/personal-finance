import { useState } from 'react';
import { Icon } from '../components/Icon';
import { Loading } from '../components/Layout';
import { BillRow, catVar, methodLabel } from '../components/rows';
import type { FinanceData, Recurring } from '../db/types';
import { dueLabel, endOfMonth, formatMonth, formatShort, startOfMonth, today } from '../lib/dates';
import { formatMoney } from '../lib/money';
import { nextOccurrence } from '../lib/recurring';
import { billOccurrences } from '../lib/selectors';

type Tab = 'upcoming' | 'all' | 'subscriptions';
const TABS: { id: Tab; label: string }[] = [
  { id: 'upcoming', label: 'Upcoming' },
  { id: 'all', label: 'All' },
  { id: 'subscriptions', label: 'Subscriptions' },
];

const PER_YEAR: Record<Recurring['frequency'], number> = { weekly: 52, monthly: 12, yearly: 1 };
const FREQ_LABEL: Record<Recurring['frequency'], string> = { weekly: 'Weekly', monthly: 'Monthly', yearly: 'Yearly' };

export function Bills({ data }: { data?: FinanceData }) {
  const [tab, setTab] = useState<Tab>('upcoming');
  if (!data) return <Loading />;

  const ref = today();
  const month = billOccurrences(data.recurring, data.transactions, startOfMonth(ref), endOfMonth(ref));
  const committed = month.reduce((s, o) => s + o.rule.amount, 0);
  const paid = month.filter((o) => o.paid).reduce((s, o) => s + o.rule.amount, 0);
  const due = month.filter((o) => !o.paid);
  const done = month.filter((o) => o.paid);
  const priceRises = data.recurring.filter((r) => r.active && r.previousAmount !== undefined && r.amount > r.previousAmount);
  const active = data.recurring
    .filter((r) => r.active)
    .map((rule) => ({ rule, next: nextOccurrence(rule, ref) }))
    .sort((a, b) => (a.next ?? '9999').localeCompare(b.next ?? '9999'));
  const subscriptions = active.filter((a) => a.rule.method === 'card');

  return (
    <main className="screen">
      <header className="screen-header">
        <h1 className="screen-title">Bills</h1>
      </header>

      <div className="segmented" role="tablist" aria-label="Bill views">
        {TABS.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      <section className="card stack" style={{ gap: 12 }} aria-label={`${formatMonth(ref)} commitments`}>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-end' }}>
          <div className="stack">
            <span className="label">Committed in {formatMonth(ref)}</span>
            <span className="value-lg num">{formatMoney(committed)}</span>
          </div>
          <span className="label">{month.length} payments</span>
        </div>
        <div className="bar bar--thick" style={catVar('bills')}>
          <span style={{ width: `${committed ? (paid / committed) * 100 : 0}%` }} />
        </div>
        <div className="row small" style={{ justifyContent: 'space-between', fontSize: 13 }}>
          <span className="row" style={{ gap: 6 }}>
            <span className="dot" style={catVar('bills')} />
            Paid {formatMoney(paid)}
          </span>
          <span className="row" style={{ gap: 6 }}>
            <span className="dot" style={{ background: 'var(--track)', border: '1px solid var(--border)' }} />
            Still to go {formatMoney(committed - paid)}
          </span>
        </div>
      </section>

      {priceRises.map((r) => (
        <section key={r.id} className="callout" aria-label="Price change">
          <span className="callout-icon">
            <Icon name="trendUp" size={20} />
          </span>
          <div className="stack" style={{ gap: 2 }}>
            <span style={{ fontSize: 14, fontWeight: 600 }}>
              {r.name} went up by {formatMoney(r.amount - (r.previousAmount ?? 0))}
            </span>
            <span className="label">
              Now {formatMoney(r.amount)}, was {formatMoney(r.previousAmount ?? 0)}
            </span>
          </div>
        </section>
      ))}

      {tab === 'upcoming' && (
        <>
          <section className="section">
            <h2 className="section-label">Due this month</h2>
            <div className="list">
              {due.length === 0 && <p className="empty">All paid for {formatMonth(ref)}.</p>}
              {due.map((o) => (
                <BillRow key={o.rule.id + o.date} rule={o.rule} date={o.date} meta={`${methodLabel(o.rule.method)} · ${dueLabel(o.date, ref)}`} />
              ))}
            </div>
          </section>
          {done.length > 0 && (
            <section className="section">
              <h2 className="section-label">Paid</h2>
              <div className="list">
                {done.map((o) => (
                  <BillRow key={o.rule.id + o.date} rule={o.rule} date={o.date} meta={methodLabel(o.rule.method)} paid />
                ))}
              </div>
            </section>
          )}
        </>
      )}

      {tab !== 'upcoming' && (
        <section className="section">
          <h2 className="section-label">{tab === 'all' ? 'All recurring payments' : 'Card subscriptions'}</h2>
          <div className="list">
            {(tab === 'all' ? active : subscriptions).length === 0 && <p className="empty">None yet.</p>}
            {(tab === 'all' ? active : subscriptions).map(({ rule, next }) => (
              <BillRow
                key={rule.id}
                rule={rule}
                date={next ?? rule.startDate}
                meta={`${methodLabel(rule.method)} · ${FREQ_LABEL[rule.frequency]}${next ? ' · next ' + formatShort(next) : ''}`}
                trailing={
                  <span className="stack" style={{ alignItems: 'flex-end', gap: 2 }}>
                    <span className="amount">{formatMoney(rule.amount)}</span>
                    <span className="small muted num">{formatMoney(rule.amount * PER_YEAR[rule.frequency])}/yr</span>
                  </span>
                }
              />
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
