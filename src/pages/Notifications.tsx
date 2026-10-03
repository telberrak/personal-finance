import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Icon } from '../components/Icon';
import { Loading, PageHeader } from '../components/Layout';
import { Field } from '../components/ui/forms';
import { useToast } from '../components/ui/Toast';
import { updateSettings } from '../db/repo';
import type { FinanceData, NotificationSettings } from '../db/types';
import { t } from '../i18n';
import { ALERT_TYPES, type AlertType } from '../lib/alerts';
import { formatShort, toISO } from '../lib/dates';
import { dateFormat } from '../lib/format';
import {
  disablePush,
  enablePush,
  markSeen,
  notificationSettings,
  notificationsSupported,
  pushSupported,
  showNotification,
  useAlerts,
} from '../notify/notifier';

/** Bell with the number of unread alerts. */
export function NotificationBell({ data }: { data: FinanceData }) {
  const { unread } = useAlerts(data);
  return (
    <Link
      to="/notifications"
      className="icon-btn bell"
      aria-label={unread ? t('notifications.unread', { count: unread }) : t('notifications.title')}
    >
      <Icon name="bell" size={20} />
      {unread > 0 && (
        <span className="bell-badge" aria-hidden="true">
          {unread > 9 ? '9+' : unread}
        </span>
      )}
    </Link>
  );
}

function when(ms: number): string {
  const d = new Date(ms);
  return `${formatShort(toISO(d))} · ${dateFormat({ hour: '2-digit', minute: '2-digit' }).format(d)}`;
}

export function Notifications({ data }: { data?: FinanceData }) {
  const { due, seen } = useAlerts(data);
  // Opening the centre marks everything shown as read (after this render, so new ones still stand out).
  const ids = due.map((a) => a.id).join('|');
  useEffect(() => {
    if (ids) void markSeen(ids.split('|'));
  }, [ids]);
  if (!data) return <Loading />;

  return (
    <main className="screen screen--modal">
      <PageHeader title={t('notifications.title')} />
      <Link to="/" className="link-btn" style={{ alignSelf: 'flex-start', padding: 0 }}>
        {t('notifications.backHome')}
      </Link>
      {due.length === 0 ? (
        <p className="label">{t('notifications.empty')}</p>
      ) : (
        <div className="list">
          {due.map((a) => (
            <Link key={a.id} to={a.link} className={`list-row list-row--link${seen.has(a.id) ? '' : ' is-unread'}`}>
              <div className="grow stack" style={{ gap: 2 }}>
                <span className="item-title" translate="no">
                  {a.title}
                </span>
                <span className="item-meta">{a.body}</span>
              </div>
              <span className="small muted">{when(a.at)}</span>
            </Link>
          ))}
        </div>
      )}
      <NotificationPreferences data={data} />
    </main>
  );
}

/** This device's notification settings: on/off, types, quiet hours. */
export function NotificationPreferences({ data }: { data: FinanceData }) {
  const toast = useToast();
  const prefs = notificationSettings(data);
  const [permission, setPermission] = useState(() => (notificationsSupported() ? Notification.permission : 'denied'));
  const save = (patch: Partial<NotificationSettings>) => updateSettings({ notifications: { ...prefs, ...patch } });

  async function toggle(on: boolean) {
    if (on) {
      const result = notificationsSupported() ? await Notification.requestPermission() : 'denied';
      setPermission(result);
      if (result !== 'granted') return toast({ message: t('notifications.blocked') });
      await save({ enabled: true });
      // Push (while the app is closed) needs sync; local notifications work regardless.
      await enablePush().catch(() => false);
    } else {
      await save({ enabled: false });
      await disablePush().catch(() => undefined);
    }
  }

  const off = new Set(prefs.off);
  const setType = (type: AlertType, on: boolean) => save({ off: on ? prefs.off.filter((x) => x !== type) : [...prefs.off, type] });

  return (
    <section className="section" aria-labelledby="notif-prefs">
      <h2 className="section-label" id="notif-prefs">
        {t('notifications.settings')}
      </h2>
      {!notificationsSupported() ? (
        <p className="small muted">{t('notifications.unsupported')}</p>
      ) : (
        <>
          <label className="check-row">
            <input type="checkbox" checked={prefs.enabled && permission === 'granted'} onChange={(e) => void toggle(e.target.checked)} />
            <span>
              {t('notifications.enable')}
              <span className="small muted" style={{ display: 'block' }}>
                {pushSupported() ? t('notifications.enableHint') : t('notifications.enableHintNoPush')}
              </span>
            </span>
          </label>
          {permission === 'denied' && <p className="small text-warn">{t('notifications.blocked')}</p>}
        </>
      )}
      <div className="list">
        {ALERT_TYPES.map((type) => (
          <label className="check-row" key={type} style={{ padding: '10px 16px' }}>
            <input type="checkbox" checked={!off.has(type)} onChange={(e) => void setType(type, e.target.checked)} />
            <span>{t(`notifications.type.${type}`)}</span>
          </label>
        ))}
      </div>
      <div className="list">
        <Field label={t('notifications.quietFrom')}>
          {(id) => (
            <input id={id} type="time" value={prefs.quietStart} onChange={(e) => e.target.value && save({ quietStart: e.target.value })} />
          )}
        </Field>
        <Field label={t('notifications.quietTo')}>
          {(id) => (
            <input id={id} type="time" value={prefs.quietEnd} onChange={(e) => e.target.value && save({ quietEnd: e.target.value })} />
          )}
        </Field>
      </div>
      <p className="small muted" style={{ padding: '0 4px' }}>
        {t('notifications.quietNote')}
      </p>
      {prefs.enabled && permission === 'granted' && (
        <button
          type="button"
          className="btn"
          style={{ alignSelf: 'flex-start' }}
          onClick={() => void showNotification(t('notifications.testTitle'), { body: t('notifications.testBody'), tag: 'test' })}
        >
          {t('notifications.test')}
        </button>
      )}
    </section>
  );
}
