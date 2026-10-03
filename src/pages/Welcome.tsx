import { useState, type FormEvent } from 'react';
import { Field, MoneyInput } from '../components/ui/forms';
import { useToast } from '../components/ui/Toast';
import { completeOnboarding, startWithDemoData, ValidationError } from '../db/repo';
import { SyncPanel } from './Sync';
import { parseMoney } from '../lib/money';
import { t } from '../i18n';

/** First-run setup: start fresh with your own balance, or explore with demo data. */
export function Welcome() {
  const toast = useToast();
  const [step, setStep] = useState<'choose' | 'fresh' | 'sync'>('choose');
  const [accountName, setAccountName] = useState(() => t('accounts.defaultName'));
  const [balanceText, setBalanceText] = useState('');
  const [payday, setPayday] = useState(25);
  const [savingsText, setSavingsText] = useState('');
  const [busy, setBusy] = useState(false);

  const balance = parseMoney(balanceText);

  async function startFresh(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await completeOnboarding({ accountName, balance: balance ?? 0, payday, monthlySavings: parseMoney(savingsText) ?? 0 });
    } catch (err) {
      setBusy(false);
      toast({ message: err instanceof ValidationError ? err.message : t('welcome.setupFailed') });
    }
  }

  async function explore() {
    setBusy(true);
    await startWithDemoData();
  }

  return (
    <main className="welcome">
      <div className="welcome-card stack" style={{ gap: 20 }}>
        <img src="/icon.svg" alt="" width={56} height={56} style={{ borderRadius: 14 }} />
        {step === 'choose' ? (
          <>
            <div className="stack" style={{ gap: 8 }}>
              <h1 className="screen-title">{t('welcome.title')}</h1>
              <p className="label" style={{ fontSize: 15, lineHeight: 1.5 }}>
                {t('welcome.intro')}
              </p>
            </div>
            <button type="button" className="btn btn--primary" onClick={() => setStep('fresh')}>
              {t('welcome.setup')}
            </button>
            <button type="button" className="btn" style={{ height: 54, borderRadius: 16 }} onClick={explore} disabled={busy}>
              {t('welcome.demo')}
            </button>
            <button type="button" className="link-btn" onClick={() => setStep('sync')}>
              {t('welcome.haveAccount')}
            </button>
          </>
        ) : step === 'sync' ? (
          <div className="stack" style={{ gap: 16 }}>
            <h1 className="screen-title">{t('sync.title')}</h1>
            <SyncPanel />
            <button type="button" className="btn" onClick={() => setStep('choose')}>
              {t('welcome.back')}
            </button>
          </div>
        ) : (
          <form className="stack" style={{ gap: 16 }} onSubmit={startFresh}>
            <div className="stack" style={{ gap: 6 }}>
              <h1 className="screen-title">{t('welcome.mainAccount')}</h1>
              <p className="label">{t('welcome.addLater')}</p>
            </div>
            <div className="stack" style={{ gap: 4 }}>
              <span className="section-label">{t('welcome.currentBalance')}</span>
              <MoneyInput value={balanceText} onChange={setBalanceText} label={t('welcome.currentBalance')} autoFocus />
            </div>
            <div className="list">
              <Field label={t('fields.name')}>
                {(id) => <input id={id} value={accountName} onChange={(e) => setAccountName(e.target.value)} autoComplete="off" />}
              </Field>
              <Field label={t('settings.payday')}>
                {(id) => (
                  <select id={id} value={payday} onChange={(e) => setPayday(Number(e.target.value))}>
                    {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                      <option key={d} value={d}>
                        {t('settings.paydayOption', { day: d })}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
              <Field label={t('settings.savings')}>
                {(id) => (
                  <input
                    id={id}
                    inputMode="decimal"
                    placeholder={t('welcome.savingsPlaceholder')}
                    value={savingsText}
                    onChange={(e) => setSavingsText(e.target.value)}
                  />
                )}
              </Field>
            </div>
            <div className="grid-2">
              <button type="button" className="btn" style={{ height: 54, borderRadius: 16 }} onClick={() => setStep('choose')}>
                {t('common.back')}
              </button>
              <button type="submit" className="btn btn--primary" disabled={busy}>
                {t('welcome.start')}
              </button>
            </div>
          </form>
        )}
      </div>
    </main>
  );
}
