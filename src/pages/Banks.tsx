/**
 * Settings → Bank connections: connect a bank through the aggregator, map its accounts, fetch new
 * transactions, and renew or end the consent.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import type { Institution } from '../../shared/api.ts';
import { Loading, PageHeader } from '../components/Layout';
import { Sheet, useConfirm } from '../components/ui/Dialog';
import { Field } from '../components/ui/forms';
import { useToast } from '../components/ui/Toast';
import {
  balanceDifference,
  banksAvailable,
  connectBank,
  disconnectBank,
  listInstitutions,
  mapBankAccount,
  matchBankBalance,
  refreshConnection,
  syncBanks,
} from '../banks/banks';
import { db } from '../db/db';
import type { BankConnection, FinanceData } from '../db/types';
import { t } from '../i18n';
import { regionName } from '../lib/format';
import { formatDate, toISO } from '../lib/dates';
import { formatMoney } from '../lib/money';
import { SyncApiError } from '../sync/client';

const COUNTRIES = ['GB', 'IE', 'FR', 'BE', 'DE', 'ES', 'IT', 'NL', 'PT'];

function errorText(err: unknown): string {
  if (err instanceof SyncApiError && err.status === 0) return t('sync.unreachable');
  return t('banks.failed');
}

/** Settings → Bank connections. */
export function Banks({ data }: { data?: FinanceData }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [params, setParams] = useSearchParams();
  const sync = useLiveQuery(async () => (await db.syncState.get('sync')) ?? null);
  const [available, setAvailable] = useState<boolean>();
  const [choosing, setChoosing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [now] = useState(() => Date.now());

  useEffect(() => {
    void banksAvailable().then(setAvailable);
  }, [sync?.token, sync?.syncKey]);

  // Back from the bank: check consent and list the accounts it shared.
  const returned = params.get('link');
  useEffect(() => {
    if (!returned) return;
    void refreshConnection(returned)
      .then((c) => toast({ message: c?.status === 'linked' ? t('banks.connected', { name: c.institutionName }) : t('banks.notConnected') }))
      .catch((err) => toast({ message: errorText(err) }))
      .finally(() => setParams({}, { replace: true }));
  }, [returned, setParams, toast]);

  if (!data || sync === undefined) return <Loading />;
  const accounts = data.accounts.filter((a) => !a.archived);

  async function fetchNow() {
    setBusy(true);
    try {
      const added = await syncBanks(data!, true);
      toast({ message: t('banks.fetched', { count: added }) });
    } catch (err) {
      toast({ message: errorText(err) });
    } finally {
      setBusy(false);
    }
  }

  async function disconnect(c: BankConnection) {
    const ok = await confirm({
      title: t('banks.disconnectTitle', { name: c.institutionName }),
      message: t('banks.disconnectBody'),
      confirmLabel: t('banks.disconnect'),
      danger: true,
    });
    if (!ok) return;
    try {
      await disconnectBank(c.id);
    } catch (err) {
      toast({ message: errorText(err) });
    }
  }

  return (
    <main className="screen screen--modal">
      <PageHeader title={t('banks.title')} />
      <Link to="/settings" className="link-btn" style={{ alignSelf: 'flex-start', padding: 0 }}>
        {t('common.backToSettings')}
      </Link>
      <p className="label">{t('banks.intro')}</p>

      {!sync?.syncKey ? (
        <div className="callout callout--info">
          <span>{t('banks.needsSync')}</span> <Link to="/settings/sync">{t('banks.setUpSync')}</Link>
        </div>
      ) : available === false ? (
        <p className="small muted">{t('banks.unavailable')}</p>
      ) : (
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <button type="button" className="btn btn--solid" onClick={() => setChoosing(true)} disabled={available === undefined}>
            {t('banks.connect')}
          </button>
          {data.bankConnections.length > 0 && (
            <button type="button" className="btn" onClick={fetchNow} disabled={busy}>
              {t('banks.fetchNow')}
            </button>
          )}
        </div>
      )}

      {data.bankConnections.map((c) => {
        const expired = c.status !== 'linked' || new Date(c.expiresAt).getTime() < now;
        return (
          <section className="section" key={c.id}>
            <h2 className="section-label" translate="no">
              {c.institutionName}
            </h2>
            <p className={`small ${expired ? 'text-warn' : 'muted'}`} style={{ padding: '0 4px' }}>
              {c.status === 'pending'
                ? t('banks.pending')
                : expired
                  ? t('banks.expired')
                  : t('banks.validUntil', { date: formatDate(toISO(new Date(c.expiresAt))) })}
            </p>
            <div className="list">
              {c.accounts.map((a) => {
                const diff = a.accountId ? balanceDifference(data, a.accountId, a.bankBalance) : null;
                const account = accounts.find((x) => x.id === a.accountId);
                return (
                  <div className="stack" key={a.bankAccountId} style={{ gap: 0 }}>
                    <Field label={`${a.name}${a.mask ? ` ${a.mask}` : ''}`}>
                      {(id) => (
                        <select
                          id={id}
                          value={a.accountId ?? ''}
                          onChange={(e) => void mapBankAccount(c.id, a.bankAccountId, e.target.value || undefined)}
                        >
                          <option value="">{t('banks.dontImport')}</option>
                          {accounts.map((acc) => (
                            <option key={acc.id} value={acc.id}>
                              {acc.name}
                            </option>
                          ))}
                        </select>
                      )}
                    </Field>
                    {a.lastSyncedAt && (
                      <p className="small muted" style={{ padding: '0 16px 10px' }}>
                        {t('banks.lastFetched', { date: formatDate(toISO(new Date(a.lastSyncedAt))) })}
                      </p>
                    )}
                    {account && diff !== null && diff !== 0 && (
                      <div className="callout callout--warn" style={{ margin: '0 12px 12px' }}>
                        <span>
                          {t('banks.balanceDiffers', {
                            bank: formatMoney(a.bankBalance ?? 0),
                            ledger: formatMoney((a.bankBalance ?? 0) - diff),
                          })}
                        </span>{' '}
                        <button type="button" className="link-btn" onClick={() => void matchBankBalance(account, diff)}>
                          {t('banks.matchBalance')}
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              {expired && sync?.syncKey && (
                <button type="button" className="btn btn--sm" onClick={() => setChoosing(true)}>
                  {t('banks.reconnect')}
                </button>
              )}
              <button type="button" className="btn btn--sm btn--danger" onClick={() => void disconnect(c)}>
                {t('banks.disconnect')}
              </button>
            </div>
          </section>
        );
      })}

      <p className="small muted">{t('banks.privacy')}</p>

      <Sheet open={choosing} onClose={() => setChoosing(false)} title={t('banks.chooseBank')}>
        {choosing && <ChooseBank language={data.settings.language} />}
      </Sheet>
    </main>
  );
}

function ChooseBank({ language }: { language: string }) {
  const toast = useToast();
  const [country, setCountry] = useState('GB');
  const [query, setQuery] = useState('');
  const [loaded, setLoaded] = useState<{ country: string; list: Institution[] }>();
  const list = loaded?.country === country ? loaded.list : undefined;

  useEffect(() => {
    let live = true;
    listInstitutions(country)
      .then((l) => live && setLoaded({ country, list: l }))
      .catch((err) => {
        if (live) setLoaded({ country, list: [] });
        toast({ message: errorText(err) });
      });
    return () => {
      live = false;
    };
  }, [country, toast]);

  const shown = useMemo(
    () => (list ?? []).filter((i) => i.name.toLowerCase().includes(query.trim().toLowerCase())).slice(0, 60),
    [list, query],
  );

  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className="list">
        <Field label={t('banks.country')}>
          {(id) => (
            <select id={id} value={country} onChange={(e) => setCountry(e.target.value)}>
              {COUNTRIES.map((c) => (
                <option key={c} value={c}>
                  {regionName(c)}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label={t('banks.search')}>
          {(id) => <input id={id} type="search" value={query} onChange={(e) => setQuery(e.target.value)} />}
        </Field>
      </div>
      {!list ? (
        <p className="small muted">{t('banks.loading')}</p>
      ) : (
        <div className="list" style={{ maxHeight: '50vh', overflow: 'auto' }}>
          {shown.map((i) => (
            <button
              key={i.id}
              type="button"
              className="list-row plain-btn"
              style={{ justifyContent: 'flex-start' }}
              onClick={() => void connectBank(i, language).catch((err) => toast({ message: errorText(err) }))}
            >
              <span translate="no">{i.name}</span>
            </button>
          ))}
          {shown.length === 0 && <p className="list-row small muted">{t('banks.noneFound')}</p>}
        </div>
      )}
      <p className="small muted">{t('banks.consentNote')}</p>
    </div>
  );
}
