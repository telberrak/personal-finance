import { useRef, useState, type FormEvent, type ReactNode } from 'react';
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
  clearPin,
  createBackup,
  daysSinceBackup,
  eraseAllData,
  markBackedUp,
  resetDemoData,
  restoreBackup,
  setPin,
  transactionsCsv,
  updateSettings,
  ValidationError,
} from '../db/repo';
import type { FinanceData, ThemePreference } from '../db/types';
import { today } from '../lib/dates';
import { currencyName, formatMoney, parseMoney } from '../lib/money';
import { isValidPin, pinSupported } from '../lib/pin';
import { CURRENCIES, LANGUAGES, t } from '../i18n';

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

export function Settings({ data }: { data?: FinanceData }) {
  const confirm = useConfirm();
  const toast = useToast();
  const isDesktop = useIsDesktop();
  const fileInput = useRef<HTMLInputElement>(null);
  const [pinSheet, setPinSheet] = useState(false);
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

  async function onBackup() {
    const backup = await createBackup();
    downloadFile(backupFileName(), JSON.stringify(backup, null, 2), 'application/json');
    await markBackedUp();
    toast({ message: t('settings.backupDone') });
  }

  async function onCsv() {
    downloadFile(`ledger-transactions-${today()}.csv`, await transactionsCsv(), 'text/csv');
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
    try {
      const { transactions } = await restoreBackup(await file.text());
      toast({ message: t('settings.restored', { count: transactions }) });
    } catch (err) {
      toast({ message: err instanceof ValidationError ? err.message : t('settings.restoreFailed') });
    }
  }

  async function onRemovePin() {
    const ok = await confirm({ title: t('settings.lockOffTitle'), confirmLabel: t('settings.turnOff') });
    if (!ok) return;
    await clearPin();
    toast({ message: t('settings.lockOffDone') });
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
            to="/settings/accounts"
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
        </div>
      </Section>

      <Section title={t('settings.security')}>
        <div className="list">
          <div className="list-row">
            <div className="tile" aria-hidden="true">
              <Icon name="lock" size={20} />
            </div>
            <div className="grow stack" style={{ gap: 2 }}>
              <span className="item-title">{t('settings.appLock')}</span>
              <span className="item-meta">
                {!pinSupported() ? t('settings.lockNeedsHttps') : settings.pinHash ? t('settings.lockOn') : t('settings.lockOff')}
              </span>
            </div>
            {pinSupported() && (
              <button type="button" className="btn btn--sm" onClick={() => setPinSheet(true)}>
                {settings.pinHash ? t('settings.changePin') : t('settings.setPin')}
              </button>
            )}
          </div>
          {settings.pinHash && (
            <>
              <Field label={t('settings.lockAfter')}>
                {(id) => (
                  <select
                    id={id}
                    value={settings.lockAfterMinutes}
                    onChange={(e) => updateSettings({ lockAfterMinutes: Number(e.target.value) })}
                  >
                    <option value={0}>{t('settings.immediately')}</option>
                    <option value={1}>{t('settings.minutes', { count: 1 })}</option>
                    <option value={5}>{t('settings.minutes', { count: 5 })}</option>
                    <option value={15}>{t('settings.minutes', { count: 15 })}</option>
                    <option value={60}>{t('settings.oneHour')}</option>
                  </select>
                )}
              </Field>
              <button type="button" className="list-row plain-btn text-warn" onClick={onRemovePin}>
                {t('settings.turnOffLock')}
              </button>
            </>
          )}
        </div>
        <p className="small muted" style={{ padding: '0 4px' }}>
          {t('settings.lockNote')}
        </p>
      </Section>

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
          <button type="button" className="btn btn--solid" onClick={onBackup}>
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

      <Sheet open={pinSheet} onClose={() => setPinSheet(false)} title={settings.pinHash ? t('settings.changePin') : t('settings.setAPin')}>
        {pinSheet && <PinForm onDone={() => setPinSheet(false)} />}
      </Sheet>
    </main>
  );
}

function PinForm({ onDone }: { onDone: () => void }) {
  const toast = useToast();
  const [pin, setPinText] = useState('');
  const [again, setAgain] = useState('');
  const valid = isValidPin(pin) && pin === again;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!valid) return;
    try {
      await setPin(pin);
      toast({ message: t('settings.lockIsOn') });
      onDone();
    } catch (err) {
      toast({ message: err instanceof ValidationError ? err.message : t('settings.pinFailed') });
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
        <button type="submit" className="btn btn--solid" disabled={!valid}>
          {t('settings.savePin')}
        </button>
      </div>
    </form>
  );
}
