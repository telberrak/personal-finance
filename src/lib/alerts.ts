/**
 * Alerts worked out on the device from your data: what to tell you, and when.
 * The in-app notification centre shows those that are due; system notifications and Web Push
 * deliver them (see src/notify). Nothing here leaves the device except, for push, a time and a
 * generic sentence ("A bill is due tomorrow") with no names or amounts.
 */
import type { FinanceData, NotificationSettings } from '../db/types';
import { t } from '../i18n';
import { addDays, daysBetween, fromISO, toISO, type ISODate } from './dates';
import { forecastBalance } from './forecast';
import { formatMoney } from './money';
import { periodFor } from './periods';
import { nextOccurrence, nextPayday } from './recurring';
import { billOccurrences, budgetProgress, isTransfer } from './selectors';
import { payeeKey } from './payees';

export const ALERT_TYPES = ['billDue', 'payday', 'budget', 'lowBalance', 'unusual', 'trialEnding', 'renewal', 'bankConsent'] as const;
export type AlertType = (typeof ALERT_TYPES)[number];

/** Types that can be scheduled ahead and pushed while the app is closed. */
export const SCHEDULED_TYPES = new Set<AlertType>(['billDue', 'payday', 'trialEnding', 'renewal', 'bankConsent']);

export interface Alert {
  /** Stable: the same event always has the same id, so it is shown and notified once. */
  id: string;
  type: AlertType;
  /** When to notify (ms since epoch). */
  at: number;
  title: string;
  body: string;
  /** App path to open. */
  link: string;
}

export const DEFAULT_NOTIFICATIONS: NotificationSettings = { enabled: false, off: [], quietStart: '22:00', quietEnd: '07:30' };

/** A local date and time ("HH:MM") as ms. */
function at(date: ISODate, time: string): number {
  const d = fromISO(date);
  const [h, m] = time.split(':').map(Number);
  d.setHours(h, m, 0, 0);
  return d.getTime();
}

const minutesOf = (time: string) => {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
};

/** Moves a time out of quiet hours (to the end of them). Quiet hours may cross midnight. */
export function outsideQuietHours(ms: number, quietStart: string, quietEnd: string): number {
  if (quietStart === quietEnd) return ms;
  const d = new Date(ms);
  const now = d.getHours() * 60 + d.getMinutes();
  const start = minutesOf(quietStart);
  const end = minutesOf(quietEnd);
  const quiet = start < end ? now >= start && now < end : now >= start || now < end;
  if (!quiet) return ms;
  const day = toISO(d);
  // Ends today, or tomorrow when quiet hours started this evening.
  const endDay = start > end && now >= start ? addDays(day, 1) : day;
  return at(endDay, quietEnd);
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** All alerts around `now`: the past week (for the centre) and the next 8 days (to schedule). */
export function computeAlerts(data: FinanceData, now: Date): Alert[] {
  const today = toISO(now);
  const nowMs = now.getTime();
  const out: Alert[] = [];
  const horizon = addDays(today, 8);

  // Bills: the day before, at 9am.
  for (const o of billOccurrences(data.recurring, data.transactions, today, horizon)) {
    if (o.paid) continue;
    out.push({
      id: `billDue:${o.rule.id}:${o.date}`,
      type: 'billDue',
      at: at(addDays(o.date, -1), '09:00'),
      title: t('alerts.billDue.title', { name: o.rule.name }),
      body: t('alerts.billDue.body', { amount: formatMoney(o.rule.amount) }),
      link: '/bills',
    });
  }

  // Payday, at 8am.
  const payday = nextPayday(addDays(today, -1), data.settings.payday);
  if (daysBetween(today, payday) <= 8) {
    out.push({
      id: `payday:${payday}`,
      type: 'payday',
      at: at(payday, '08:00'),
      title: t('alerts.payday.title'),
      body: t('alerts.payday.body'),
      link: '/',
    });
  }

  // Free trials: two days before they end. Yearly renewals: a week before.
  for (const r of data.recurring) {
    if (!r.active) continue;
    if (r.trialEndsOn && r.trialEndsOn >= today && r.trialEndsOn <= horizon) {
      out.push({
        id: `trial:${r.id}:${r.trialEndsOn}`,
        type: 'trialEnding',
        at: at(addDays(r.trialEndsOn, -2), '09:00'),
        title: t('alerts.trialEnding.title', { name: r.name }),
        body: t('alerts.trialEnding.body', { amount: formatMoney(r.amount) }),
        link: `/bills/${r.id}`,
      });
    }
    if (r.frequency === 'yearly') {
      const next = nextOccurrence(r, today);
      if (next && daysBetween(today, next) <= 8 + 7 && daysBetween(today, next) >= 0) {
        out.push({
          id: `renewal:${r.id}:${next}`,
          type: 'renewal',
          at: at(addDays(next, -7), '09:00'),
          title: t('alerts.renewal.title', { name: r.name }),
          body: t('alerts.renewal.body', { amount: formatMoney(r.amount) }),
          link: `/bills/${r.id}`,
        });
      }
    }
  }

  // Budgets at 80% and 100% of this period. Shown when it happens.
  const period = periodFor(today, data.settings.budgetPeriod, data.settings.payday);
  for (const p of budgetProgress(data.budgets, data.categories, data.transactions, period)) {
    const level = p.ratio >= 1 ? 100 : p.ratio >= 0.8 ? 80 : 0;
    if (!level) continue;
    out.push({
      id: `budget${level}:${p.category.id}:${period.from}`,
      type: 'budget',
      at: nowMs,
      title: t(level === 100 ? 'alerts.budget.over' : 'alerts.budget.near', { name: p.category.name }),
      body: t('alerts.budget.body', { spent: formatMoney(p.spent), limit: formatMoney(p.limit) }),
      link: '/budgets',
    });
  }

  // Forecast below the warning level within a month.
  if (data.accounts.length) {
    const { lowest } = forecastBalance(data, today, 30);
    if (lowest.balance < data.settings.lowBalanceThreshold) {
      out.push({
        id: `low:${lowest.date}`,
        type: 'lowBalance',
        at: nowMs,
        title: t('alerts.lowBalance.title'),
        body: t('alerts.lowBalance.body', { amount: formatMoney(lowest.balance), days: daysBetween(today, lowest.date) }),
        link: '/reports',
      });
    }
  }

  // Unusual payments in the last three days: more than twice the usual for that payee.
  const history = new Map<string, number[]>();
  const recent = [];
  for (const tx of data.transactions) {
    if (isTransfer(tx) || tx.amount >= 0 || tx.splitIndex) continue;
    if (tx.date >= addDays(today, -3)) recent.push(tx);
    else {
      const key = payeeKey(tx.payee);
      history.set(key, [...(history.get(key) ?? []), -tx.amount]);
    }
  }
  for (const tx of recent) {
    const past = history.get(payeeKey(tx.payee));
    if (!past || past.length < 3) continue;
    const usual = median(past);
    if (-tx.amount > usual * 2 && -tx.amount - usual >= 1000) {
      out.push({
        id: `unusual:${tx.id}`,
        type: 'unusual',
        at: tx.createdAt ?? at(tx.date, '12:00'),
        title: t('alerts.unusual.title', { name: tx.payee }),
        body: t('alerts.unusual.body', { amount: formatMoney(-tx.amount), usual: formatMoney(Math.round(usual)) }),
        link: `/transactions/${tx.id}`,
      });
    }
  }

  return out.sort((a, b) => a.at - b.at);
}

/** Alerts after applying the device's settings: types switched off are dropped, quiet hours respected. */
export function deliverable(alerts: Alert[], settings: NotificationSettings): Alert[] {
  const off = new Set(settings.off);
  return alerts.filter((a) => !off.has(a.type)).map((a) => ({ ...a, at: outsideQuietHours(a.at, settings.quietStart, settings.quietEnd) }));
}

/** For push: the same moments, with a sentence that says nothing about your money. */
export function genericText(type: AlertType): { title: string; body: string } {
  return { title: t(`alerts.generic.${type}`), body: t('alerts.generic.body') };
}
