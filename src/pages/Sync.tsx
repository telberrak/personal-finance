import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import type { Me } from '../../shared/api.ts';
import { Loading, PageHeader } from '../components/Layout';
import { Sheet, useConfirm } from '../components/ui/Dialog';
import { Field } from '../components/ui/forms';
import { useToast } from '../components/ui/Toast';
import { db } from '../db/db';
import type { FinanceData } from '../db/types';
import { t } from '../i18n';
import { formatDate, toISO, today } from '../lib/dates';
import { dateFormat } from '../lib/format';
import {
  addAccountPasskey,
  deleteAccount,
  getMe,
  joinWithRecoveryKey,
  removeAccountPasskey,
  requestCode,
  signInWithPasskey,
  signOut,
  signOutDevice,
  verifyCode,
  type SignInResult,
} from '../sync/account';
import { SyncApiError } from '../sync/client';
import { syncNow, useSyncStatus } from '../sync/engine';
import { WrongRecoveryKey } from '../sync/keys';

const passkeysAvailable = () => typeof window !== 'undefined' && !!window.PublicKeyCredential && window.isSecureContext;

/** A readable message for a failed sync call. */
function errorMessage(err: unknown, unauthorised = 'sync.failed'): string {
  if (err instanceof WrongRecoveryKey) return t('sync.wrongRecoveryKey');
  if (err instanceof DOMException && err.name === 'NotAllowedError') return '';
  if (!(err instanceof SyncApiError)) return t('sync.failed');
  if (err.status === 0) return t('sync.unreachable');
  if (err.status === 429) return t('sync.tooMany');
  if (err.status === 401) return t(unauthorised);
  return t('sync.failed');
}

/** "today at 14:05" or "3 October 2026". */
function when(ms: number): string {
  const d = new Date(ms);
  const iso = toISO(d);
  return iso === today() ? t('sync.todayAt', { time: dateFormat({ hour: '2-digit', minute: '2-digit' }).format(d) }) : formatDate(iso);
}

export function Sync({ data }: { data?: FinanceData }) {
  if (!data) return <Loading />;
  return (
    <main className="screen screen--modal">
      <PageHeader title={t('sync.title')} />
      <Link to="/settings" className="link-btn" style={{ alignSelf: 'flex-start', padding: 0 }}>
        {t('common.backToSettings')}
      </Link>
      <SyncPanel />
    </main>
  );
}

/** Everything about sync for the current state: sign in, recovery key, or status and devices. */
export function SyncPanel() {
  const state = useLiveQuery(async () => (await db.syncState.get('sync')) ?? null);
  const [newKey, setNewKey] = useState<string>();
  if (state === undefined) return <Loading />;

  const onSignedIn = (r: SignInResult) => {
    if (r.kind === 'created') setNewKey(r.recoveryKey);
  };

  return (
    <>
      {!state?.token ? (
        <SignIn signedOutEmail={state?.email} onSignedIn={onSignedIn} />
      ) : !state.syncKey ? (
        <EnterRecoveryKey email={state.email} />
      ) : (
        <SyncStatusView email={state.email} recoveryKey={state.recoveryKey} />
      )}
      <Sheet open={!!newKey} onClose={() => setNewKey(undefined)} title={t('sync.saveKeyTitle')}>
        {newKey && <RecoveryKeyNotice recoveryKey={newKey} onDone={() => setNewKey(undefined)} />}
      </Sheet>
    </>
  );
}

function SignIn({ signedOutEmail, onSignedIn }: { signedOutEmail?: string; onSignedIn: (r: SignInResult) => void }) {
  const [email, setEmail] = useState(signedOutEmail ?? '');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function run(fn: () => Promise<void>, unauthorised?: string) {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (err) {
      setError(errorMessage(err, unauthorised));
    } finally {
      setBusy(false);
    }
  }

  const send = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      await requestCode(email.trim());
      setSent(true);
    });
  };
  const verify = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => onSignedIn(await verifyCode(email.trim(), code)), 'sync.codeWrong');
  };

  return (
    <section className="stack" style={{ gap: 16 }}>
      {signedOutEmail ? (
        <p className="text-warn small" role="status">
          {t('sync.signedOutRemote', { email: signedOutEmail })}
        </p>
      ) : (
        <p className="label">{t('sync.intro')}</p>
      )}
      {!sent ? (
        <form className="stack" style={{ gap: 12 }} onSubmit={send}>
          <div className="list">
            <Field label={t('sync.email')}>
              {(id) => (
                <input id={id} type="email" autoComplete="email" value={email} required onChange={(e) => setEmail(e.target.value)} />
              )}
            </Field>
          </div>
          <button type="submit" className="btn btn--solid" disabled={busy || !email.includes('@')}>
            {t('sync.sendCode')}
          </button>
        </form>
      ) : (
        <form className="stack" style={{ gap: 12 }} onSubmit={verify}>
          <p className="small muted">{t('sync.codeSent', { email: email.trim() })}</p>
          <div className="list">
            <Field label={t('sync.code')}>
              {(id) => (
                <input
                  id={id}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  value={code}
                  autoFocus
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                />
              )}
            </Field>
          </div>
          <div className="grid-2">
            <button type="button" className="btn" onClick={() => setSent(false)}>
              {t('sync.changeEmail')}
            </button>
            <button type="submit" className="btn btn--solid" disabled={busy || code.length !== 6}>
              {t('sync.signIn')}
            </button>
          </div>
        </form>
      )}
      {passkeysAvailable() && (
        <button
          type="button"
          className="btn"
          disabled={busy}
          onClick={() => void run(async () => onSignedIn(await signInWithPasskey()), 'sync.passkeyUnknown')}
        >
          {t('sync.signInPasskey')}
        </button>
      )}
      {error && (
        <p className="text-warn small" role="alert">
          {error}
        </p>
      )}
      <p className="small muted">{t('sync.privacyNote')}</p>
    </section>
  );
}

function EnterRecoveryKey({ email }: { email: string }) {
  const confirm = useConfirm();
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    const ok = await confirm({
      title: t('sync.replaceTitle'),
      message: t('sync.replaceBody'),
      confirmLabel: t('sync.replace'),
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    setError('');
    try {
      await joinWithRecoveryKey(key);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="stack" style={{ gap: 16 }} onSubmit={submit}>
      <p className="label">{t('sync.enterKeyIntro', { email })}</p>
      <div className="list">
        <Field label={t('sync.recoveryKey')}>
          {(id) => (
            <input
              id={id}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              placeholder={t('sync.keyPlaceholder')}
              value={key}
              aria-invalid={!!error}
              onChange={(e) => {
                setKey(e.target.value);
                setError('');
              }}
            />
          )}
        </Field>
      </div>
      {error && (
        <p className="text-warn small" role="alert">
          {error}
        </p>
      )}
      <button type="submit" className="btn btn--solid" disabled={busy || key.replace(/[\s-]/g, '').length < 32}>
        {t('sync.startSyncing')}
      </button>
      <button type="button" className="btn" onClick={() => void signOut()}>
        {t('sync.cancelSignIn')}
      </button>
    </form>
  );
}

function RecoveryKeyNotice({ recoveryKey, onDone }: { recoveryKey: string; onDone: () => void }) {
  const toast = useToast();
  return (
    <div className="stack" style={{ gap: 16 }}>
      <p className="small muted">{t('sync.saveKeyBody')}</p>
      <p className="recovery-key" translate="no">
        {recoveryKey}
      </p>
      <div className="grid-2">
        <button
          type="button"
          className="btn"
          onClick={() =>
            void navigator.clipboard
              ?.writeText(recoveryKey)
              .then(() => toast({ message: t('sync.copied') }))
              .catch(() => undefined)
          }
        >
          {t('sync.copy')}
        </button>
        <button type="button" className="btn btn--solid" onClick={onDone}>
          {t('sync.savedIt')}
        </button>
      </div>
    </div>
  );
}

function SyncStatusView({ email, recoveryKey }: { email: string; recoveryKey?: string }) {
  const confirm = useConfirm();
  const toast = useToast();
  const status = useSyncStatus();
  const pending = useLiveQuery(() => db.outbox.count(), [], 0);
  const [me, setMe] = useState<Me>();
  const [showKey, setShowKey] = useState(false);

  const refresh = useCallback(() => {
    getMe()
      .then(setMe)
      .catch(() => undefined);
  }, []);
  useEffect(refresh, [refresh]);

  const statusText =
    status.phase === 'syncing'
      ? t('sync.syncing')
      : status.phase === 'offline'
        ? t('sync.offline')
        : status.phase === 'error'
          ? t('sync.error')
          : pending > 0
            ? t('sync.pending', { count: pending })
            : status.lastSyncAt
              ? t('sync.upToDate', { when: when(status.lastSyncAt) })
              : t('sync.waiting');

  async function act(fn: () => Promise<unknown>, done?: string) {
    try {
      await fn();
      if (done) toast({ message: done });
      refresh();
    } catch (err) {
      const message = errorMessage(err);
      if (message) toast({ message });
    }
  }

  async function onSignOut() {
    if (await confirm({ title: t('sync.signOutTitle'), message: t('sync.signOutBody'), confirmLabel: t('sync.signOut') })) await signOut();
  }

  async function onDelete() {
    const ok = await confirm({ title: t('sync.deleteTitle'), message: t('sync.deleteBody'), confirmLabel: t('sync.delete'), danger: true });
    if (ok) await act(deleteAccount, t('sync.deleted'));
  }

  return (
    <>
      <section className="section">
        <div className="list">
          <div className="list-row">
            <div className="grow stack" style={{ gap: 2 }}>
              <span className="item-title" translate="no">
                {email}
              </span>
              <span className="item-meta" role="status">
                {statusText}
              </span>
            </div>
            <button type="button" className="btn btn--sm" onClick={() => void syncNow()} disabled={status.phase === 'syncing'}>
              {t('sync.syncNow')}
            </button>
          </div>
        </div>
        <p className="small muted" style={{ padding: '0 4px' }}>
          {t('sync.e2eNote')}
        </p>
      </section>

      <section className="section">
        <h2 className="section-label">{t('sync.devices')}</h2>
        <div className="list">
          {!me && <p className="list-row small muted">{t('sync.loadingDevices')}</p>}
          {me?.devices.map((d) => (
            <div className="list-row" key={d.id}>
              <div className="grow stack" style={{ gap: 2 }}>
                <span className="item-title">{d.name}</span>
                <span className="item-meta">
                  {d.current ? t('sync.thisDeviceNow') : t('sync.lastSeen', { when: when(Date.parse(d.lastSeenAt)) })}
                </span>
              </div>
              {!d.current && (
                <button
                  type="button"
                  className="btn btn--sm"
                  onClick={async () => {
                    const ok = await confirm({ title: t('sync.signOutDeviceTitle', { name: d.name }), confirmLabel: t('sync.signOut') });
                    if (ok) await act(() => signOutDevice(d.id), t('sync.deviceSignedOut'));
                  }}
                >
                  {t('sync.signOut')}
                </button>
              )}
            </div>
          ))}
        </div>
      </section>

      {passkeysAvailable() && (
        <section className="section">
          <h2 className="section-label">{t('sync.accountPasskeys')}</h2>
          <div className="list">
            {me?.passkeys.map((p) => (
              <div className="list-row" key={p.id}>
                <div className="grow stack" style={{ gap: 2 }}>
                  <span className="item-title">{t('security.passkey')}</span>
                  <span className="item-meta">{t('security.passkeyAddedOn', { date: formatDate(toISO(new Date(p.createdAt))) })}</span>
                </div>
                <button type="button" className="btn btn--sm" onClick={() => void act(() => removeAccountPasskey(p.id))}>
                  {t('security.remove')}
                </button>
              </div>
            ))}
            <button type="button" className="list-row plain-btn" onClick={() => void act(addAccountPasskey, t('sync.passkeyAdded'))}>
              {t('sync.addPasskey')}
            </button>
          </div>
          <p className="small muted" style={{ padding: '0 4px' }}>
            {t('sync.passkeyNote')}
          </p>
        </section>
      )}

      {recoveryKey && (
        <section className="section">
          <h2 className="section-label">{t('sync.recoveryKey')}</h2>
          {showKey ? (
            <p className="recovery-key" translate="no">
              {recoveryKey}
            </p>
          ) : (
            <button type="button" className="btn" style={{ alignSelf: 'flex-start' }} onClick={() => setShowKey(true)}>
              {t('sync.showKey')}
            </button>
          )}
          <p className="small muted" style={{ padding: '0 4px' }}>
            {t('sync.keyNote')}
          </p>
        </section>
      )}

      <section className="section">
        <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
          <button type="button" className="btn" onClick={onSignOut}>
            {t('sync.signOutHere')}
          </button>
          <button type="button" className="btn btn--danger" onClick={onDelete}>
            {t('sync.deleteAccount')}
          </button>
        </div>
      </section>
    </>
  );
}
