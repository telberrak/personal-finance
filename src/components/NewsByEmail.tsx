/**
 * Settings → News by email. Signed in to sync: a switch for the account's address (no confirmation
 * needed). Otherwise: an address field; the server emails a link to confirm it (double opt-in).
 */
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState, type FormEvent } from 'react';
import { db } from '../db/db';
import { t } from '../i18n';
import { SyncApiError } from '../sync/client';
import { accountUpdates, setAccountUpdates, subscribeToUpdates } from '../sync/updates';
import { Field } from './ui/forms';
import { useToast } from './ui/Toast';

const failure = (err: unknown) =>
  err instanceof SyncApiError && err.status === 0
    ? t('sync.unreachable')
    : err instanceof SyncApiError && err.status === 429
      ? t('sync.tooMany')
      : err instanceof SyncApiError && err.status === 502
        ? t('sync.emailFailed')
        : t('updates.failed');

/** The news-by-email setting. */
export function NewsByEmail() {
  const signedIn = useLiveQuery(async () => !!(await db.syncState.get('sync'))?.token);
  return (
    <div className="stack" style={{ gap: 10 }}>
      <p className="small muted" style={{ padding: '0 4px' }}>
        {t('updates.intro')}
      </p>
      {signedIn === undefined ? null : signedIn ? <AccountSwitch /> : <SubscribeForm />}
    </div>
  );
}

function AccountSwitch() {
  const toast = useToast();
  const [on, setOn] = useState<boolean>();
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    accountUpdates()
      .then((v) => live && setOn(!!v))
      .catch(() => live && setOn(false));
    return () => {
      live = false;
    };
  }, []);

  async function change(next: boolean) {
    setBusy(true);
    try {
      await setAccountUpdates(next);
      setOn(next);
      toast({ message: next ? t('updates.on') : t('updates.off') });
    } catch (err) {
      toast({ message: failure(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <label className="check-row">
      <input type="checkbox" checked={!!on} disabled={on === undefined || busy} onChange={(e) => void change(e.target.checked)} />
      <span>{t('updates.consent')}</span>
    </label>
  );
}

function SubscribeForm() {
  const [email, setEmail] = useState('');
  const [state, setState] = useState<'idle' | 'busy' | 'sent'>('idle');
  const [error, setError] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    setState('busy');
    setError('');
    try {
      await subscribeToUpdates(email);
      setState('sent');
    } catch (err) {
      setError(failure(err));
      setState('idle');
    }
  }

  if (state === 'sent')
    return (
      <p className="card" role="status">
        {t('updates.checkEmail')}
      </p>
    );
  return (
    <form className="stack" style={{ gap: 10 }} onSubmit={submit}>
      <div className="list">
        <Field label={t('updates.email')}>
          {(id) => <input id={id} type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />}
        </Field>
      </div>
      <p className="small muted" style={{ padding: '0 4px' }}>
        {t('updates.consent')}
      </p>
      {error && (
        <p className="text-warn small" role="alert">
          {error}
        </p>
      )}
      <button type="submit" className="btn" style={{ alignSelf: 'flex-start' }} disabled={state === 'busy' || !email.includes('@')}>
        {t('updates.subscribe')}
      </button>
    </form>
  );
}
