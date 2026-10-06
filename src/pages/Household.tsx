/**
 * Settings → Household: create a household, invite someone with a one-use link, choose which accounts to
 * share, leave. Also the /join page that opens an invitation.
 */
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import type { Space } from '../../shared/api.ts';
import { Loading, PageHeader } from '../components/Layout';
import { useConfirm } from '../components/ui/Dialog';
import { Field } from '../components/ui/forms';
import { useToast } from '../components/ui/Toast';
import { db } from '../db/db';
import { shareAccount, ValidationError } from '../db/repo';
import type { FinanceData } from '../db/types';
import { t } from '../i18n';
import { SyncApiError } from '../sync/client';
import { syncNow } from '../sync/engine';
import { createHousehold, inviteLink, joinHousehold, leaveHousehold, listHouseholds, parseInvitation } from '../sync/household';

function errorText(err: unknown) {
  if (err instanceof ValidationError) return err.message;
  if (err instanceof SyncApiError && err.status === 0) return t('sync.unreachable');
  if (err instanceof SyncApiError && err.status === 404) return t('household.inviteExpired');
  return t('household.failed');
}

/** Settings → Household. */
export function Household({ data }: { data?: FinanceData }) {
  const toast = useToast();
  const confirm = useConfirm();
  const sync = useLiveQuery(async () => (await db.syncState.get('sync')) ?? null);
  const keys = useLiveQuery(() => db.spaceKeys.toArray(), [], []);
  const [spaces, setSpaces] = useState<Space[]>([]);
  const [name, setName] = useState('');
  const [link, setLink] = useState<string>();

  const refresh = useCallback(() => {
    listHouseholds()
      .then(setSpaces)
      .catch(() => undefined);
  }, []);
  useEffect(refresh, [refresh, keys.length]);

  if (!data || sync === undefined) return <Loading />;
  const ready = !!sync?.token && !!sync.syncKey;
  const space = keys[0];
  const members = spaces.find((s) => s.id === space?.id)?.members ?? [];

  async function run(fn: () => Promise<unknown>) {
    try {
      await fn();
      refresh();
    } catch (err) {
      toast({ message: errorText(err) });
    }
  }

  return (
    <main className="screen screen--modal">
      <PageHeader title={t('household.title')} subtitle={t('household.subtitle')} />
      <Link to="/settings" className="link-btn" style={{ alignSelf: 'flex-start', padding: 0 }}>
        {t('common.backToSettings')}
      </Link>
      <p className="label">{t('household.intro')}</p>

      {!ready ? (
        <div className="callout callout--info">
          <span>{t('household.needsSync')}</span> <Link to="/settings/sync">{t('banks.setUpSync')}</Link>
        </div>
      ) : !space ? (
        <form
          className="stack"
          style={{ gap: 12 }}
          onSubmit={(e) => {
            e.preventDefault();
            void run(() => createHousehold(name || t('household.defaultName')));
          }}
        >
          <div className="list">
            <Field label={t('fields.name')}>
              {(id) => <input id={id} value={name} placeholder={t('household.defaultName')} onChange={(e) => setName(e.target.value)} />}
            </Field>
          </div>
          <button type="submit" className="btn btn--solid" style={{ alignSelf: 'flex-start' }}>
            {t('household.create')}
          </button>
        </form>
      ) : (
        <>
          <section className="section">
            <h2 className="section-label" translate="no">
              {space.name}
            </h2>
            <div className="list">
              {members.map((m) => (
                <div className="list-row" key={m.email}>
                  <span className="grow item-title" translate="no">
                    {m.email}
                  </span>
                  <span className="small muted">{m.you ? t('household.you') : m.owner ? t('household.creator') : ''}</span>
                </div>
              ))}
            </div>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <button type="button" className="btn" onClick={() => void run(async () => setLink(await inviteLink(space.id)))}>
                {t('household.invite')}
              </button>
            </div>
            {link && (
              <div className="card stack" style={{ gap: 8 }}>
                <p className="small">{t('household.linkIntro')}</p>
                <p className="recovery-key small" translate="no">
                  {link}
                </p>
                <div className="row" style={{ gap: 8 }}>
                  <button
                    type="button"
                    className="btn btn--sm"
                    onClick={() => void navigator.clipboard?.writeText(link).then(() => toast({ message: t('household.copied') }))}
                  >
                    {t('sync.copy')}
                  </button>
                  {typeof navigator.share === 'function' && (
                    <button
                      type="button"
                      className="btn btn--sm"
                      onClick={() => void navigator.share({ title: t('household.shareTitle'), url: link }).catch(() => undefined)}
                    >
                      {t('household.share')}
                    </button>
                  )}
                </div>
              </div>
            )}
          </section>

          <section className="section">
            <h2 className="section-label">{t('household.accounts')}</h2>
            <div className="list">
              {data.accounts
                .filter((a) => !a.archived)
                .map((a) => {
                  const mine = !a.ownerId || a.ownerId === sync.userId;
                  return (
                    <label className="check-row" key={a.id} style={{ padding: '10px 16px' }}>
                      <input
                        type="checkbox"
                        checked={a.spaceId === space.id}
                        disabled={!mine}
                        onChange={(e) =>
                          void run(async () => {
                            await shareAccount(a.id, e.target.checked ? space.id : undefined, sync.userId);
                            void syncNow();
                          })
                        }
                      />
                      <span translate="no">
                        {a.name}
                        {!mine && (
                          <span className="small muted" style={{ display: 'block' }}>
                            {t('household.sharedByOther')}
                          </span>
                        )}
                      </span>
                    </label>
                  );
                })}
            </div>
            <p className="small muted" style={{ padding: '0 4px' }}>
              {t('household.accountsNote')}
            </p>
          </section>

          <button
            type="button"
            className="btn btn--danger"
            style={{ alignSelf: 'flex-start' }}
            onClick={async () => {
              const ok = await confirm({
                title: t('household.leaveTitle'),
                message: t('household.leaveBody'),
                confirmLabel: t('household.leave'),
                danger: true,
              });
              if (ok) await run(() => leaveHousehold(space.id));
            }}
          >
            {t('household.leave')}
          </button>
        </>
      )}
    </main>
  );
}

/** Opened from an invitation link: /join#… (the key in the fragment never reaches a server). */
export function JoinHousehold() {
  const navigate = useNavigate();
  const toast = useToast();
  const sync = useLiveQuery(async () => (await db.syncState.get('sync')) ?? null);
  const [invitation] = useState(() => {
    const hash = window.location.hash || sessionStorage.getItem('ledger-invite') || '';
    if (window.location.hash) sessionStorage.setItem('ledger-invite', window.location.hash);
    return parseInvitation(hash);
  });
  const [busy, setBusy] = useState(false);
  if (sync === undefined) return <Loading />;

  if (!invitation)
    return (
      <main className="screen">
        <p className="label">{t('household.badLink')}</p>
      </main>
    );
  const ready = !!sync?.token && !!sync.syncKey;

  async function join() {
    setBusy(true);
    try {
      await joinHousehold(invitation!);
      sessionStorage.removeItem('ledger-invite');
      toast({ message: t('household.joined', { name: invitation!.name }) });
      navigate('/settings/household', { replace: true });
    } catch (err) {
      toast({ message: errorText(err) });
      setBusy(false);
    }
  }

  return (
    <main className="screen screen--modal">
      <PageHeader title={t('household.joinTitle', { name: invitation.name || t('household.defaultName') })} />
      <p className="label">{t('household.joinIntro')}</p>
      {ready ? (
        <button type="button" className="btn btn--solid" style={{ alignSelf: 'flex-start' }} disabled={busy} onClick={() => void join()}>
          {t('household.join')}
        </button>
      ) : (
        <div className="callout callout--info">
          <span>{t('household.joinNeedsSync')}</span> <Link to="/settings/sync">{t('banks.setUpSync')}</Link>
        </div>
      )}
    </main>
  );
}
