/**
 * Delivers alerts (src/lib/alerts.ts):
 * - while Mizan is open: system notifications when an alert falls due;
 * - while it is closed: Web Push, if you sync. The server gets each upcoming reminder's time and
 *   a generic sentence only.
 * Each alert is notified once per device (the notices table) and uses its id as the
 * notification tag, so a pushed and a local notification for the same alert replace each other.
 */
import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import type { FinanceData, NotificationSettings } from '../db/types';
import { computeAlerts, DEFAULT_NOTIFICATIONS, deliverable, genericText, SCHEDULED_TYPES, type Alert } from '../lib/alerts';
import { isNative, scheduleNative, showNativeNow } from '../native/native';
import { api } from '../sync/client';

/** Whether this browser or app can show notifications at all. */
export const notificationsSupported = () => isNative() || (typeof window !== 'undefined' && 'Notification' in window);
/** Whether reminders can arrive while the app is closed (Web Push). */
export const pushSupported = () => notificationsSupported() && 'serviceWorker' in navigator && 'PushManager' in window;

/** This device's notification settings, with defaults. */
export const notificationSettings = (data: FinanceData): NotificationSettings => ({
  ...DEFAULT_NOTIFICATIONS,
  ...data.settings.notifications,
});

/** Alerts that are due now or were in the last week, newest first, for the notification centre. */
/** The current minute, updated while mounted. */
function useMinute(): number {
  const [minute, setMinute] = useState(() => Math.floor(Date.now() / 60_000));
  useEffect(() => {
    const id = window.setInterval(() => setMinute(Math.floor(Date.now() / 60_000)), 15_000);
    return () => window.clearInterval(id);
  }, []);
  return minute;
}

/** Alerts due in the last week (re-worked out every minute), newest first, and how many are unread. */
export function useAlerts(data: FinanceData | undefined) {
  const minute = useMinute();
  const alerts = useMemo(
    () => (data ? deliverable(computeAlerts(data, new Date(minute * 60_000)), notificationSettings(data)) : []),
    [data, minute],
  );
  const notices = useLiveQuery(() => db.notices.toArray(), [], []);
  const seen = new Set(notices.filter((n) => n.seenAt).map((n) => n.id));
  const now = minute * 60_000;
  const due = alerts.filter((a) => a.at <= now && a.at >= now - 7 * 86_400_000).reverse();
  return { due, unread: due.filter((a) => !seen.has(a.id)).length, seen };
}

/** Marks alerts as seen in the notification centre. */
export async function markSeen(ids: string[]): Promise<void> {
  const existing = new Map((await db.notices.bulkGet(ids)).filter(Boolean).map((n) => [n!.id, n!]));
  await db.notices.bulkPut(ids.map((id) => ({ ...existing.get(id), id, seenAt: existing.get(id)?.seenAt ?? Date.now() })));
}

/** Shows a notification natively or through the service worker, if permission was granted. */
export async function showNotification(title: string, options: NotificationOptions & { data?: { url: string } }): Promise<void> {
  if (isNative()) return showNativeNow(title, options.body ?? '', options.tag ?? title, options.data?.url);
  if (!notificationsSupported() || Notification.permission !== 'granted') return;
  const options2 = { icon: '/icon-192.png', badge: '/icon-192.png', ...options };
  const reg = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : undefined;
  if (reg) await reg.showNotification(title, options2);
  else new Notification(title, options2);
}

/** Notifies alerts as they fall due (checked every minute and on every change). */
async function notifyDue(alerts: Alert[], settings: NotificationSettings) {
  const now = Date.now();
  const due = alerts.filter((a) => a.at <= now && a.at >= now - 6 * 3_600_000);
  if (!due.length) return;
  const known = new Set((await db.notices.bulkGet(due.map((a) => a.id))).filter((n) => n?.notifiedAt).map((n) => n!.id));
  const fresh = due.filter((a) => !known.has(a.id));
  if (!fresh.length) return;
  // Recorded even when notifications are off, so turning them on later does not replay old alerts.
  const existing = await db.notices.bulkGet(fresh.map((a) => a.id));
  await db.notices.bulkPut(fresh.map((a, i) => ({ ...existing[i], id: a.id, notifiedAt: now })));
  if (!settings.enabled) return;
  for (const a of fresh) await showNotification(a.title, { body: a.body, tag: a.id, data: { url: a.link } });
}

let lastSchedule = '';

/** Uploads this device's upcoming reminders (generic text) when they change. */
async function uploadSchedule(alerts: Alert[], settings: NotificationSettings) {
  // In the native app reminders are scheduled on the device itself, with their full text.
  if (isNative()) {
    const schedule = settings.enabled ? alerts.filter((a) => SCHEDULED_TYPES.has(a.type)) : [];
    const signature = JSON.stringify(schedule.map((a) => [a.id, a.at, a.title]));
    if (signature !== lastSchedule) {
      await scheduleNative(schedule);
      lastSchedule = signature;
    }
    return;
  }
  const sync = await db.syncState.get('sync');
  if (!sync?.token || !settings.enabled || !pushSupported() || Notification.permission !== 'granted') return;
  const reg = await navigator.serviceWorker.getRegistration();
  if (!(await reg?.pushManager.getSubscription())) return;
  const now = Date.now();
  const reminders = alerts
    .filter((a) => SCHEDULED_TYPES.has(a.type) && a.at > now)
    .slice(0, 100)
    .map((a) => ({ at: a.at, tag: a.id, ...genericText(a.type) }));
  const signature = JSON.stringify(reminders);
  if (signature === lastSchedule) return;
  await api('/push/reminders', { method: 'PUT', body: { reminders }, token: sync.token });
  lastSchedule = signature;
}

/** Runs while unlocked. */
export function useNotifier(data: FinanceData | undefined) {
  useEffect(() => {
    if (!data) return;
    const settings = notificationSettings(data);
    const run = () => {
      const alerts = deliverable(computeAlerts(data, new Date()), settings);
      void notifyDue(alerts, settings).catch(() => undefined);
      void uploadSchedule(alerts, settings).catch(() => undefined);
    };
    run();
    const timer = window.setInterval(run, 60_000);
    return () => window.clearInterval(timer);
  }, [data]);
}

function base64UrlToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4);
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

/** Subscribes this device to push (needs sync and a service worker). Returns false if not possible. */
export async function enablePush(): Promise<boolean> {
  const sync = await db.syncState.get('sync');
  if (!sync?.token || !pushSupported()) return false;
  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg) return false;
  const { publicKey } = await api<{ publicKey: string }>('/push/key', { token: sync.token });
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64UrlToBytes(publicKey) as BufferSource }));
  await api('/push/subscription', { method: 'PUT', body: sub.toJSON(), token: sync.token });
  lastSchedule = '';
  return true;
}

/** Unsubscribes this device from Web Push and removes its subscription from the server. */
export async function disablePush(): Promise<void> {
  const reg = pushSupported() ? await navigator.serviceWorker.getRegistration() : undefined;
  await (await reg?.pushManager.getSubscription())?.unsubscribe();
  const sync = await db.syncState.get('sync');
  if (sync?.token) await api('/push/subscription', { method: 'DELETE', token: sync.token }).catch(() => undefined);
}
