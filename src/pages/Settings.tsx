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
import { formatMoney, parseMoney } from '../lib/money';
import { isValidPin, pinSupported } from '../lib/pin';

const THEMES: { id: ThemePreference; label: string }[] = [
  { id: 'system', label: 'System' },
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' },
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
            else toast({ message: 'Enter an amount, like 200 or 150.50' });
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
      title: 'Reset demo data?',
      message: 'This replaces everything in the app with fresh demo data.',
      confirmLabel: 'Reset',
      danger: true,
    });
    if (!ok) return;
    await resetDemoData();
    toast({ message: 'Demo data restored' });
  }

  async function onErase() {
    const ok = await confirm({
      title: 'Erase all data?',
      message: 'All transactions, bills, budgets and goals on this device will be deleted. This cannot be undone.',
      confirmLabel: 'Erase',
      danger: true,
    });
    if (!ok) return;
    await eraseAllData();
    toast({ message: 'All data erased' });
  }

  async function onBackup() {
    const backup = await createBackup();
    downloadFile(backupFileName(), JSON.stringify(backup, null, 2), 'application/json');
    await markBackedUp();
    toast({ message: 'Backup downloaded' });
  }

  async function onCsv() {
    downloadFile(`ledger-transactions-${today()}.csv`, await transactionsCsv(), 'text/csv');
  }

  async function onRestoreFile(file: File | undefined) {
    if (!file) return;
    const ok = await confirm({
      title: 'Restore this backup?',
      message: `Everything in the app will be replaced with the contents of ${file.name}.`,
      confirmLabel: 'Restore',
      danger: true,
    });
    if (!ok) return;
    try {
      const { transactions } = await restoreBackup(await file.text());
      toast({ message: `Backup restored: ${transactions} transactions` });
    } catch (err) {
      toast({ message: err instanceof ValidationError ? err.message : 'Could not read that backup.' });
    }
  }

  async function onRemovePin() {
    const ok = await confirm({ title: 'Turn off the app lock?', confirmLabel: 'Turn off' });
    if (!ok) return;
    await clearPin();
    toast({ message: 'App lock turned off' });
  }

  return (
    <main className="screen screen--modal">
      {isDesktop ? (
        <PageHeader title="Settings" />
      ) : (
        <header className="screen-header">
          <Link to="/" className="icon-btn" aria-label="Back">
            <Icon name="back" size={20} strokeWidth={2} />
          </Link>
          <h1 style={{ fontSize: 17, fontWeight: 600 }}>Settings</h1>
          <span style={{ width: 44 }} />
        </header>
      )}

      <Section title="Appearance">
        <div className="segmented" role="radiogroup" aria-label="Theme">
          {THEMES.map((t) => (
            <button
              key={t.id}
              type="button"
              role="radio"
              aria-checked={settings.theme === t.id}
              onClick={() => updateSettings({ theme: t.id })}
            >
              {t.label}
            </button>
          ))}
        </div>
      </Section>

      <Section title="Pay cycle">
        <div className="list">
          <Field label="Payday">
            {(id) => (
              <select id={id} value={settings.payday} onChange={(e) => updateSettings({ payday: Number(e.target.value) })}>
                {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                  <option key={d} value={d}>
                    Day {d} of the month
                  </option>
                ))}
              </select>
            )}
          </Field>
          <MoneySetting label="Savings" value={settings.monthlySavings} onSave={(v) => updateSettings({ monthlySavings: v })} />
          <MoneySetting
            label="Warn below"
            value={settings.lowBalanceThreshold}
            onSave={(v) => updateSettings({ lowBalanceThreshold: v })}
          />
        </div>
        <p className="small muted" style={{ padding: '0 4px' }}>
          Savings are set aside each pay cycle and left out of “safe to spend”. You are warned when your forecast balance may drop below the
          low balance amount.
        </p>
      </Section>

      <Section title="Budgets">
        <div className="segmented" role="radiogroup" aria-label="Budget period">
          <button
            type="button"
            role="radio"
            aria-checked={settings.budgetPeriod === 'month'}
            onClick={() => updateSettings({ budgetPeriod: 'month' })}
          >
            Calendar month
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={settings.budgetPeriod === 'payday'}
            onClick={() => updateSettings({ budgetPeriod: 'payday' })}
          >
            Payday to payday
          </button>
        </div>
        <label className="check-row">
          <input type="checkbox" checked={settings.budgetRollover} onChange={(e) => updateSettings({ budgetRollover: e.target.checked })} />
          <span>
            Carry over what is left
            <span className="small muted" style={{ display: 'block' }}>
              Unspent (or overspent) budget moves into the next period
            </span>
          </span>
        </label>
      </Section>

      <Section title="Manage">
        <div className="list">
          <LinkRow
            to="/settings/accounts"
            icon="wallet"
            title="Accounts"
            detail={`${data.accounts.filter((a) => !a.archived).length} open`}
          />
          <LinkRow
            to="/settings/categories"
            icon="tag"
            title="Categories"
            detail={`${data.categories.filter((c) => !c.system && !c.archived).length} categories`}
          />
          <LinkRow to="/settings/rules" icon="rules" title="Rules and payee names" detail={`${data.rules.length} rules`} />
          <LinkRow to="/import" icon="upload" title="Import a bank statement" detail="CSV from your bank" />
        </div>
      </Section>

      <Section title="Security">
        <div className="list">
          <div className="list-row">
            <div className="tile" aria-hidden="true">
              <Icon name="lock" size={20} />
            </div>
            <div className="grow stack" style={{ gap: 2 }}>
              <span className="item-title">App lock</span>
              <span className="item-meta">
                {!pinSupported() ? 'Needs HTTPS or localhost' : settings.pinHash ? 'On — PIN required to open' : 'Off'}
              </span>
            </div>
            {pinSupported() && (
              <button type="button" className="btn btn--sm" onClick={() => setPinSheet(true)}>
                {settings.pinHash ? 'Change PIN' : 'Set PIN'}
              </button>
            )}
          </div>
          {settings.pinHash && (
            <>
              <Field label="Lock after">
                {(id) => (
                  <select
                    id={id}
                    value={settings.lockAfterMinutes}
                    onChange={(e) => updateSettings({ lockAfterMinutes: Number(e.target.value) })}
                  >
                    <option value={0}>Immediately</option>
                    <option value={1}>1 minute</option>
                    <option value={5}>5 minutes</option>
                    <option value={15}>15 minutes</option>
                    <option value={60}>1 hour</option>
                  </select>
                )}
              </Field>
              <button type="button" className="list-row plain-btn text-warn" onClick={onRemovePin}>
                Turn off app lock
              </button>
            </>
          )}
        </div>
        <p className="small muted" style={{ padding: '0 4px' }}>
          The PIN keeps others out of the app on this device. If you forget it, clear this site’s data in your browser to start again.
        </p>
      </Section>

      <Section title="Backup" id="backup">
        <p className="label" style={{ padding: '0 4px' }}>
          {backupAge === undefined ? 'Not backed up yet.' : backupAge === 0 ? 'Last backup: today.' : `Last backup: ${backupAge} days ago.`}{' '}
          Your data only lives on this device, so keep a copy somewhere safe.
        </p>
        <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
          <button type="button" className="btn btn--solid" onClick={onBackup}>
            <Icon name="download" size={18} />
            Download backup
          </button>
          <button type="button" className="btn" onClick={() => fileInput.current?.click()}>
            <Icon name="upload" size={18} />
            Restore from backup
          </button>
          <button type="button" className="btn" onClick={onCsv}>
            Export transactions (CSV)
          </button>
          <input
            ref={fileInput}
            type="file"
            accept="application/json,.json"
            hidden
            aria-label="Backup file"
            onChange={(e) => {
              void onRestoreFile(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
        </div>
      </Section>

      <Section title="Data">
        <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
          <button type="button" className="btn" onClick={onReset}>
            Reset demo data
          </button>
          <button type="button" className="btn btn--danger" onClick={onErase}>
            Erase all data
          </button>
        </div>
      </Section>

      <Sheet open={pinSheet} onClose={() => setPinSheet(false)} title={settings.pinHash ? 'Change PIN' : 'Set a PIN'}>
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
      toast({ message: 'App lock is on' });
      onDone();
    } catch (err) {
      toast({ message: err instanceof ValidationError ? err.message : 'Could not set the PIN.' });
    }
  }

  return (
    <form className="stack" style={{ gap: 16 }} onSubmit={submit}>
      <div className="list">
        <Field label="New PIN">
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
        <Field label="Repeat">
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
      <p className="small muted">4 to 8 digits.{again && pin !== again ? ' The PINs do not match.' : ''}</p>
      <div className="grid-2">
        <button type="button" className="btn" onClick={onDone}>
          Cancel
        </button>
        <button type="submit" className="btn btn--solid" disabled={!valid}>
          Save PIN
        </button>
      </div>
    </form>
  );
}
