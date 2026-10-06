/**
 * /updates: where links in news emails land. It works for anyone (no account, not set up, or
 * locked), so it is shown outside the app's normal screens:
 *
 * - ?status=check-email | confirmed | invalid  after subscribing or confirming;
 * - ?unsubscribe=<token>  a button to unsubscribe (a button, so link scanners cannot do it).
 *
 * ?locale= picks the language, as everywhere in the app.
 */
import { useEffect, useState } from 'react';
import { applyLocale, t } from '../i18n';
import { unsubscribeWithToken } from '../sync/updates';

type Status = 'check-email' | 'confirmed' | 'invalid' | 'unsubscribed';
const STATUSES: Status[] = ['check-email', 'confirmed', 'invalid', 'unsubscribed'];

/** The news-by-email result page. */
export function Updates() {
  const params = new URLSearchParams(window.location.search);
  const unsubscribeToken = params.get('unsubscribe');
  const fromUrl = params.get('status') as Status | null;
  const [status, setStatus] = useState<Status | undefined>(fromUrl && STATUSES.includes(fromUrl) ? fromUrl : undefined);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  applyLocale('en', 'GBP');

  useEffect(() => {
    document.title = t('updates.title');
  }, []);

  async function unsubscribe() {
    setBusy(true);
    setFailed(false);
    try {
      await unsubscribeWithToken(unsubscribeToken!);
      setStatus('unsubscribed');
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="screen screen--modal" style={{ maxWidth: 560, margin: '0 auto' }}>
      <h1 className="screen-title">{t('updates.title')}</h1>
      {status ? (
        <p className="card" role="status">
          {t(`updates.status.${status}`)}
        </p>
      ) : unsubscribeToken ? (
        <section className="card stack" style={{ gap: 12 }}>
          <p>{t('updates.unsubscribeQuestion')}</p>
          {failed && (
            <p className="text-warn small" role="alert">
              {t('updates.failed')}
            </p>
          )}
          <button type="button" className="btn btn--solid" style={{ alignSelf: 'flex-start' }} disabled={busy} onClick={unsubscribe}>
            {t('updates.unsubscribe')}
          </button>
        </section>
      ) : (
        <p className="card">{t('updates.status.invalid')}</p>
      )}
      <a href="/" className="link-btn" style={{ alignSelf: 'flex-start', padding: 0 }}>
        {t('updates.openApp')}
      </a>
    </main>
  );
}
