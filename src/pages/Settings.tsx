/**
 * Settings: appearance, language and currency, pay cycle, budgets, accounts and categories, security (app
 * lock, passkeys, hide amounts), backup and export, sync, notifications and data.
 */
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link } from 'react-router';
import { Icon, type IconName } from '../components/Icon';
import { Loading, PageHeader } from '../components/Layout';
import { Sheet, useConfirm } from '../components/ui/Dialog';
import { downloadFile } from '../components/ui/download';
import { Field } from '../components/ui/forms';
import { useToast } from '../components/ui/Toast';
import { useIsDesktop } from '../components/useMediaQuery';
import {
  backupFileName,
  createBackup,
  daysSinceBackup,
  eraseAllData,
  markBackedUp,
  resetDemoData,
  restoreBackup,
  transactionsCsv,
  updateSettings,
  ValidationError,
} from '../db/repo';
import { db } from '../db/db';
import { ExchangeRates } from '../components/ExchangeRates';
import { disableNativeBiometric, enableNativeBiometric, isNative, nativeBiometricAvailable } from '../native/native';
import {
  addPasskey,
  changePin,
  decryptBackup,
  disableEncryption,
  enableEncryption,
  encryptBackup,
  isEncryptedBackup,
  lockNow,
  MIN_BACKUP_PASSWORD,
  passkeysSupported,
  removePasskey,
  SecurityError,
} from '../db/security';
import type { FinanceData, Settings as AppSettings, ThemePreference } from '../db/types';
import { formatDate, toISO, today } from '../lib/dates';
import { currencyName, formatMoney, parseMoney } from '../lib/money';
import { weekdayName } from '../lib/format';
import { isValidPin, pinSupported } from '../lib/pin';
import { CURRENCIES, LANGUAGES, t } from '../i18n';
import { NewsByEmail } from '../components/NewsByEmail';

const THEMES: { id: ThemePreference; label: string }[] = [
  { id: 'system', label: 'settings.theme.system' },
  { id: 'light', label: 'settings.theme.light' },
  { id: 'dark', label: 'settings.theme.dark' },
];

function LinkRow({ to, icon, title, detail }: { to: string; icon: IconName; title: string; detail: string }) {
  return (
    <Link to={to} className="list-row list-row--link">
      <div className="tile" aria-hidden="true">
        <Icon name={icon} size={20} />
      </div>
      <div className="grow stack" style={{ gap: 2 }}>
        <span className="item-title">{title}</span>
        <span className="item-meta">{detail}</span>
      </div>
      <Icon name="forward" size={18} />
    </Link>
  );
}

/** Text input that saves an amount when it loses focus. */
function MoneySetting({ label, value, onSave }: { label: string; value: number; onSave: (pence: number) => Promise<void> }) {
  const toast = useToast();
  const [text, setText] = useState<string>();
  return (
    <Field label={label}>
      {(id) => (
        <input
          id={id}
          inputMode="decimal"
          value={text ?? formatMoney(value)}
          onFocus={() => setText((value / 100).toFixed(2))}
          onChange={(e) => setText(e.target.value)}
          onBlur={async () => {
            if (text === undefined) return;
            const pence = parseMoney(text);
            if (pence !== null) await onSave(pence);
            else toast({ message: t('settings.amountHint') });
            setText(undefined);
          }}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
      )}
    </Field>
  );
}

function Section({ title, id, children }: { title: string; id?: string; children: ReactNode }) {
  return (
    <section className="section" id={id}>
      <h2 className="section-label">{title}</h2>
      {children}
    </section>
  );
}

/** The Settings screen. */
export function Settings({ data }: { data?: FinanceData }) {
  const confirm = useConfirm();
  const toast = useToast();
  const isDesktop = useIsDesktop();
  const fileInput = useRef<HTMLInputElement>(null);
  const [backupSheet, setBackupSheet] = useState(false);
  const [lockedFile, setLockedFile] = useState<{ name: string; text: string }>();
  if (!data) return <Loading />;
  const { settings } = data;
  const backupAge = daysSinceBackup(settings);

  async function onReset() {
    const ok = await confirm({
      title: t('settings.resetTitle'),
      message: t('settings.resetBody'),
      confirmLabel: t('settings.reset'),
      danger: true,
    });
    if (!ok) return;
    await resetDemoData();
    toast({ message: t('settings.resetDone') });
  }

  async function onErase() {
    const ok = await confirm({
      title: t('settings.eraseTitle'),
      message: t('settings.eraseBody'),
      confirmLabel: t('settings.erase'),
      danger: true,
    });
    if (!ok) return;
    await eraseAllData();
    toast({ message: t('settings.eraseDone') });
  }

  async function onCsv() {
    downloadFile(`mizan-transactions-${today()}.csv`, await transactionsCsv(), 'text/csv');
  }

  async function onRestoreFile(file: File | undefined) {
    if (!file) return;
    const ok = await confirm({
      title: t('settings.restoreTitle'),
      message: t('settings.restoreBody', { file: file.name }),
      confirmLabel: t('settings.restore'),
      danger: true,
    });
    if (!ok) return;
    const text = await file.text();
    if (isEncryptedBackup(text)) setLockedFile({ name: file.name, text });
    else await restore(text);
  }

  /** Returns false if the restore failed (the message is shown). */
  async function restore(text: string): Promise<boolean> {
    try {
      const { transactions } = await restoreBackup(text);
      toast({ message: t('settings.restored', { count: transactions }) });
      return true;
    } catch (err) {
      toast({ message: err instanceof ValidationError ? err.message : t('settings.restoreFailed') });
      return false;
    }
  }

  return (
    <main className="screen screen--modal">
      {isDesktop ? (
        <PageHeader title={t('settings.title')} />
      ) : (
        <header className="screen-header">
          <Link to="/" className="icon-btn" aria-label={t('common.back')}>
            <Icon name="back" size={20} strokeWidth={2} />
          </Link>
          <h1 style={{ fontSize: 17, fontWeight: 600 }}>{t('settings.title')}</h1>
          <span style={{ width: 44 }} />
        </header>
      )}

      <Section title={t('settings.appearance')}>
        <div className="segmented" role="radiogroup" aria-label={t('settings.themeLabel')}>
          {THEMES.map((th) => (
            <button
              key={th.id}
              type="button"
              role="radio"
              aria-checked={settings.theme === th.id}
              onClick={() => updateSettings({ theme: th.id })}
            >
              {t(th.label)}
            </button>
          ))}
        </div>
      </Section>

      <Section title={t('settings.languageRegion')}>
        <div className="list">
          <Field label={t('settings.language')}>
            {(id) => (
              <select id={id} value={settings.language} onChange={(e) => updateSettings({ language: e.target.value })}>
                {LANGUAGES.filter((l) => !l.pseudo || import.meta.env.DEV).map((l) => (
                  <option key={l.code} value={l.code}>
                    {l.name}
                  </option>
                ))}
              </select>
            )}
          </Field>
          {settings.language === 'ar' && (
            <Field label={t('settings.digits')}>
              {(id) => (
                <select
                  id={id}
                  value={settings.digits ?? 'latn'}
                  onChange={(e) => updateSettings({ digits: e.target.value as 'latn' | 'arab' })}
                >
                  <option value="latn">{t('settings.digitsLatin')}</option>
                  <option value="arab">{t('settings.digitsArabic')}</option>
                </select>
              )}
            </Field>
          )}
          <Field label={t('settings.weekStart')}>
            {(id) => (
              <select
                id={id}
                value={settings.weekStart ?? 0}
                onChange={(e) => updateSettings({ weekStart: Number(e.target.value) || undefined })}
              >
                <option value={0}>{t('settings.weekStartAuto')}</option>
                {[1, 6, 7].map((d) => (
                  <option key={d} value={d}>
                    {weekdayName(d)}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label={t('settings.currency')}>
            {(id) => (
              <select id={id} value={settings.currency} onChange={(e) => updateSettings({ currency: e.target.value })}>
                {CURRENCIES.map((c) => (
                  <option key={c} value={c}>
                    {currencyName(c)}
                  </option>
                ))}
              </select>
            )}
          </Field>
        </div>
        <p className="small muted" style={{ padding: '0 4px' }}>
          {t('settings.currencyNote')}
        </p>
      </Section>

      <ExchangeRates data={data} />

      <Section title={t('settings.payCycle')}>
        <div className="list">
          <Field label={t('settings.payday')}>
            {(id) => (
              <select id={id} value={settings.payday} onChange={(e) => updateSettings({ payday: Number(e.target.value) })}>
                {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                  <option key={d} value={d}>
                    {t('settings.paydayOption', { day: d })}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <MoneySetting
            label={t('settings.savings')}
            value={settings.monthlySavings}
            onSave={(v) => updateSettings({ monthlySavings: v })}
          />
          <MoneySetting
            label={t('settings.warnBelow')}
            value={settings.lowBalanceThreshold}
            onSave={(v) => updateSettings({ lowBalanceThreshold: v })}
          />
        </div>
        <p className="small muted" style={{ padding: '0 4px' }}>
          {t('settings.payCycleNote')}
        </p>
      </Section>

      <Section title={t('settings.budgets')}>
        <div className="segmented" role="radiogroup" aria-label={t('settings.budgetPeriod')}>
          <button
            type="button"
            role="radio"
            aria-checked={settings.budgetPeriod === 'month'}
            onClick={() => updateSettings({ budgetPeriod: 'month' })}
          >
            {t('settings.calendarMonth')}
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={settings.budgetPeriod === 'payday'}
            onClick={() => updateSettings({ budgetPeriod: 'payday' })}
          >
            {t('settings.paydayToPayday')}
          </button>
        </div>
        <label className="check-row">
          <input type="checkbox" checked={settings.budgetRollover} onChange={(e) => updateSettings({ budgetRollover: e.target.checked })} />
          <span>
            {t('settings.rollover')}
            <span className="small muted" style={{ display: 'block' }}>
              {t('settings.rolloverHint')}
            </span>
          </span>
        </label>
      </Section>

      <Section title={t('settings.manage')}>
        <div className="list">
          <LinkRow
            to="/accounts"
            icon="wallet"
            title={t('settings.accounts')}
            detail={t('settings.accountsOpen', { count: data.accounts.filter((a) => !a.archived).length })}
          />
          <LinkRow
            to="/settings/categories"
            icon="tag"
            title={t('settings.categories')}
            detail={t('settings.categoriesCount', { count: data.categories.filter((c) => !c.system && !c.archived).length })}
          />
          <LinkRow
            to="/settings/rules"
            icon="rules"
            title={t('settings.rules')}
            detail={t('settings.rulesCount', { count: data.rules.length })}
          />
          <LinkRow to="/import" icon="upload" title={t('settings.importStatement')} detail={t('settings.importDetail')} />
          <SyncRow />
          <LinkRow to="/settings/household" icon="wallet" title={t('settings.household')} detail={t('settings.householdDetail')} />
          <LinkRow to="/help" icon="search" title={t('settings.help')} detail={t('settings.helpDetail')} />
          <LinkRow to="/settings/about" icon="more" title={t('settings.about')} detail={t('settings.aboutDetail')} />
          <LinkRow to="/settings/banks" icon="wallet" title={t('settings.banks')} detail={t('settings.banksDetail')} />
          <LinkRow to="/notifications" icon="bell" title={t('settings.notifications')} detail={t('settings.notificationsDetail')} />
        </div>
      </Section>

      <SecuritySection settings={settings} />

      <Section title={t('settings.backup')} id="backup">
        <p className="label" style={{ padding: '0 4px' }}>
          {backupAge === undefined
            ? t('settings.notBackedUp')
            : backupAge === 0
              ? t('settings.backupToday')
              : t('settings.backupDays', { count: backupAge })}{' '}
          {t('settings.backupNote')}
        </p>
        <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
          <button type="button" className="btn btn--solid" onClick={() => setBackupSheet(true)}>
            <Icon name="download" size={18} />
            {t('settings.downloadBackup')}
          </button>
          <button type="button" className="btn" onClick={() => fileInput.current?.click()}>
            <Icon name="upload" size={18} />
            {t('settings.restoreFromBackup')}
          </button>
          <button type="button" className="btn" onClick={onCsv}>
            {t('settings.exportCsv')}
          </button>
          <input
            ref={fileInput}
            type="file"
            accept="application/json,.json"
            hidden
            aria-label={t('settings.backupFile')}
            onChange={(e) => {
              void onRestoreFile(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
        </div>
      </Section>

      <Section title={t('settings.newsByEmail')} id="news">
        <NewsByEmail />
      </Section>

      <Section title={t('settings.data')}>
        <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
          <button type="button" className="btn" onClick={onReset}>
            {t('settings.resetDemo')}
          </button>
          <button type="button" className="btn btn--danger" onClick={onErase}>
            {t('settings.eraseAll')}
          </button>
        </div>
      </Section>

      <Sheet open={backupSheet} onClose={() => setBackupSheet(false)} title={t('settings.downloadBackup')}>
        {backupSheet && <BackupForm onDone={() => setBackupSheet(false)} />}
      </Sheet>
      <Sheet open={!!lockedFile} onClose={() => setLockedFile(undefined)} title={t('security.openBackup')}>
        {lockedFile && (
          <PasswordForm
            intro={t('security.openBackupIntro', { file: lockedFile.name })}
            submitLabel={t('settings.restore')}
            onCancel={() => setLockedFile(undefined)}
            onSubmit={async (password) => {
              const text = await decryptBackup(lockedFile.text, password);
              if (await restore(text)) setLockedFile(undefined);
            }}
          />
        )}
      </Sheet>
    </main>
  );
}

function PinForm({ change, onDone }: { change: boolean; onDone: () => void }) {
  const toast = useToast();
  const [pin, setPinText] = useState('');
  const [again, setAgain] = useState('');
  const [saving, setSaving] = useState(false);
  const valid = isValidPin(pin) && pin === again;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!valid) return;
    setSaving(true);
    try {
      if (change) await changePin(pin);
      else await enableEncryption(pin);
      toast({ message: change ? t('security.pinChanged') : t('settings.lockIsOn') });
      onDone();
    } catch (err) {
      toast({ message: err instanceof SecurityError ? err.message : t('settings.pinFailed') });
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="stack" style={{ gap: 16 }} onSubmit={submit}>
      <div className="list">
        <Field label={t('settings.newPin')}>
          {(id) => (
            <input
              id={id}
              type="password"
              inputMode="numeric"
              autoComplete="new-password"
              maxLength={8}
              value={pin}
              onChange={(e) => setPinText(e.target.value.replace(/\D/g, ''))}
            />
          )}
        </Field>
        <Field label={t('settings.repeat')}>
          {(id) => (
            <input
              id={id}
              type="password"
              inputMode="numeric"
              autoComplete="new-password"
              maxLength={8}
              value={again}
              onChange={(e) => setAgain(e.target.value.replace(/\D/g, ''))}
            />
          )}
        </Field>
      </div>
      <p className="small muted">
        {t('settings.pinDigits')}
        {again && pin !== again ? t('settings.pinMismatch') : ''}
      </p>
      <div className="grid-2">
        <button type="button" className="btn" onClick={onDone}>
          {t('common.cancel')}
        </button>
        <button type="submit" className="btn btn--solid" disabled={!valid || saving}>
          {t('settings.savePin')}
        </button>
      </div>
    </form>
  );
}

const LOCK_TIMES = [0, 1, 5, 15, 60];

function SecuritySection({ settings }: { settings: AppSettings }) {
  const confirm = useConfirm();
  const toast = useToast();
  const keyring = useLiveQuery(() => db.keyring.toArray(), [], []);
  const [pinSheet, setPinSheet] = useState(false);
  const [passkeys, setPasskeys] = useState(false);
  const [biometric, setBiometric] = useState(false);
  useEffect(() => {
    // The native app uses Face ID / fingerprint through the system keychain instead of passkeys.
    if (isNative()) void nativeBiometricAvailable().then(setBiometric);
    else void passkeysSupported().then(setPasskeys);
  }, []);
  const lockOn = keyring.some((k) => k.kind === 'pin');
  const nativeOn = keyring.some((k) => k.kind === 'native');

  async function toggleBiometric(on: boolean) {
    try {
      if (on) await enableNativeBiometric(t('lock.biometricReason'));
      else await disableNativeBiometric();
    } catch {
      toast({ message: t('lock.biometricFailed') });
    }
  }
  const keys = keyring.filter((k) => k.kind === 'passkey');

  async function onTurnOff() {
    const ok = await confirm({ title: t('settings.lockOffTitle'), message: t('security.offBody'), confirmLabel: t('settings.turnOff') });
    if (!ok) return;
    await disableEncryption();
    toast({ message: t('settings.lockOffDone') });
  }

  async function onAddPasskey() {
    try {
      await addPasskey();
      toast({ message: t('security.passkeyAdded') });
    } catch (err) {
      if (err instanceof DOMException && err.name === 'NotAllowedError') return; // cancelled
      toast({ message: err instanceof SecurityError ? err.message : t('security.passkeyFailed') });
    }
  }

  async function onRemovePasskey(id: string) {
    const ok = await confirm({ title: t('security.removePasskeyTitle'), confirmLabel: t('security.remove'), danger: true });
    if (ok) await removePasskey(id);
  }

  return (
    <Section title={t('settings.security')}>
      <div className="list">
        <div className="list-row">
          <div className="tile" aria-hidden="true">
            <Icon name="lock" size={20} />
          </div>
          <div className="grow stack" style={{ gap: 2 }}>
            <span className="item-title">{t('settings.appLock')}</span>
            <span className="item-meta">
              {!pinSupported() ? t('settings.lockNeedsHttps') : lockOn ? t('settings.lockOn') : t('settings.lockOff')}
            </span>
          </div>
          {pinSupported() && (
            <button type="button" className="btn btn--sm" onClick={() => setPinSheet(true)}>
              {lockOn ? t('settings.changePin') : t('settings.setPin')}
            </button>
          )}
        </div>
        {lockOn && (
          <>
            <Field label={t('settings.lockAfter')}>
              {(id) => (
                <select
                  id={id}
                  value={settings.lockAfterMinutes}
                  onChange={(e) => updateSettings({ lockAfterMinutes: Number(e.target.value) })}
                >
                  {LOCK_TIMES.map((m) => (
                    <option key={m} value={m}>
                      {m === 0 ? t('settings.immediately') : m === 60 ? t('settings.oneHour') : t('settings.minutes', { count: m })}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            {passkeys &&
              keys.map((k) => (
                <div className="list-row" key={k.id}>
                  <div className="grow stack" style={{ gap: 2 }}>
                    <span className="item-title">{t('security.passkey')}</span>
                    <span className="item-meta">{t('security.passkeyAddedOn', { date: formatDate(toISO(new Date(k.createdAt))) })}</span>
                  </div>
                  <button type="button" className="btn btn--sm" onClick={() => onRemovePasskey(k.id)}>
                    {t('security.remove')}
                  </button>
                </div>
              ))}
            {passkeys && (
              <button type="button" className="list-row plain-btn" onClick={onAddPasskey}>
                {t('security.addPasskey')}
              </button>
            )}
            {biometric && (
              <label className="check-row" style={{ padding: '10px 16px' }}>
                <input type="checkbox" checked={nativeOn} onChange={(e) => void toggleBiometric(e.target.checked)} />
                <span>{t('security.nativeBiometric')}</span>
              </label>
            )}
            <button type="button" className="list-row plain-btn" onClick={lockNow}>
              {t('security.lockNow')}
            </button>
            <button type="button" className="list-row plain-btn text-warn" onClick={onTurnOff}>
              {t('settings.turnOffLock')}
            </button>
          </>
        )}
      </div>
      <p className="small muted" style={{ padding: '0 4px' }}>
        {lockOn ? t('security.encryptedNote') : t('settings.lockNote')}
      </p>
      <label className="check-row">
        <input type="checkbox" checked={!!settings.hideAmounts} onChange={(e) => updateSettings({ hideAmounts: e.target.checked })} />
        <span>
          {t('security.hideAmounts')}
          <span className="small muted" style={{ display: 'block' }}>
            {t('security.hideAmountsHint')}
          </span>
        </span>
      </label>
      <Sheet open={pinSheet} onClose={() => setPinSheet(false)} title={lockOn ? t('settings.changePin') : t('settings.setAPin')}>
        {pinSheet && <PinForm change={lockOn} onDone={() => setPinSheet(false)} />}
      </Sheet>
    </Section>
  );
}

function BackupForm({ onDone }: { onDone: () => void }) {
  const toast = useToast();
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const short = password.length > 0 && password.length < MIN_BACKUP_PASSWORD;
  const mismatch = !!again && password !== again;
  const valid = !short && password === again;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!valid) return;
    setBusy(true);
    try {
      const json = JSON.stringify(await createBackup(), null, 2);
      const file = password ? await encryptBackup(json, password) : json;
      downloadFile(backupFileName(), file, 'application/json');
      await markBackedUp();
      toast({ message: t('settings.backupDone') });
      onDone();
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="stack" style={{ gap: 16 }} onSubmit={submit}>
      <p className="small muted">{t('security.backupPasswordIntro')}</p>
      <div className="list">
        <Field label={t('security.password')}>
          {(id) => (
            <input id={id} type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          )}
        </Field>
        <Field label={t('settings.repeat')}>
          {(id) => <input id={id} type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} />}
        </Field>
      </div>
      <p className="small muted" role={short || mismatch ? 'alert' : undefined}>
        {short
          ? t('security.passwordShort', { count: MIN_BACKUP_PASSWORD })
          : mismatch
            ? t('security.passwordMismatch')
            : password
              ? t('security.passwordWarning')
              : t('security.noPasswordNote')}
      </p>
      <div className="grid-2">
        <button type="button" className="btn" onClick={onDone}>
          {t('common.cancel')}
        </button>
        <button type="submit" className="btn btn--solid" disabled={!valid || busy}>
          {password ? t('security.downloadEncrypted') : t('settings.downloadBackup')}
        </button>
      </div>
    </form>
  );
}

function PasswordForm({
  intro,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  intro: string;
  submitLabel: string;
  onSubmit: (password: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await onSubmit(password);
    } catch (err) {
      setError(err instanceof SecurityError ? err.message : t('settings.restoreFailed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="stack" style={{ gap: 16 }} onSubmit={submit}>
      <p className="small muted">{intro}</p>
      <div className="list">
        <Field label={t('security.password')}>
          {(id) => (
            <input
              id={id}
              type="password"
              autoComplete="current-password"
              autoFocus
              value={password}
              aria-invalid={!!error}
              onChange={(e) => {
                setPassword(e.target.value);
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
      <div className="grid-2">
        <button type="button" className="btn" onClick={onCancel}>
          {t('common.cancel')}
        </button>
        <button type="submit" className="btn btn--solid" disabled={!password || busy}>
          {submitLabel}
        </button>
      </div>
    </form>
  );
}

function SyncRow() {
  const state = useLiveQuery(() => db.syncState.get('sync'));
  return (
    <LinkRow
      to="/settings/sync"
      icon="upload"
      title={t('settings.sync')}
      detail={state?.syncKey ? t('settings.syncOn', { email: state.email }) : t('settings.syncOff')}
    />
  );
}
