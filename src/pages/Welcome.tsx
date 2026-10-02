import { useState, type FormEvent } from 'react';
import { Field, MoneyInput } from '../components/ui/forms';
import { useToast } from '../components/ui/Toast';
import { completeOnboarding, startWithDemoData, ValidationError } from '../db/repo';
import { parseMoney } from '../lib/money';

/** First-run setup: start fresh with your own balance, or explore with demo data. */
export function Welcome() {
  const toast = useToast();
  const [step, setStep] = useState<'choose' | 'fresh'>('choose');
  const [accountName, setAccountName] = useState('Current account');
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
      toast({ message: err instanceof ValidationError ? err.message : 'Could not finish setup.' });
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
              <h1 className="screen-title">Welcome to Ledger</h1>
              <p className="label" style={{ fontSize: 15, lineHeight: 1.5 }}>
                Track everyday spending, direct debits and budgets, and always know what is safe to spend until payday. Everything stays on
                this device.
              </p>
            </div>
            <button type="button" className="btn btn--primary" onClick={() => setStep('fresh')}>
              Set up my account
            </button>
            <button type="button" className="btn" style={{ height: 54, borderRadius: 16 }} onClick={explore} disabled={busy}>
              Explore with demo data
            </button>
          </>
        ) : (
          <form className="stack" style={{ gap: 16 }} onSubmit={startFresh}>
            <div className="stack" style={{ gap: 6 }}>
              <h1 className="screen-title">Your main account</h1>
              <p className="label">You can add more accounts, bills and budgets later.</p>
            </div>
            <div className="stack" style={{ gap: 4 }}>
              <span className="section-label">Current balance</span>
              <MoneyInput value={balanceText} onChange={setBalanceText} label="Current balance in pounds" autoFocus />
            </div>
            <div className="list">
              <Field label="Name">
                {(id) => <input id={id} value={accountName} onChange={(e) => setAccountName(e.target.value)} autoComplete="off" />}
              </Field>
              <Field label="Payday">
                {(id) => (
                  <select id={id} value={payday} onChange={(e) => setPayday(Number(e.target.value))}>
                    {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                      <option key={d} value={d}>
                        Day {d} of the month
                      </option>
                    ))}
                  </select>
                )}
              </Field>
              <Field label="Savings">
                {(id) => (
                  <input
                    id={id}
                    inputMode="decimal"
                    placeholder="Per month, e.g. 200"
                    value={savingsText}
                    onChange={(e) => setSavingsText(e.target.value)}
                  />
                )}
              </Field>
            </div>
            <div className="grid-2">
              <button type="button" className="btn" style={{ height: 54, borderRadius: 16 }} onClick={() => setStep('choose')}>
                Back
              </button>
              <button type="submit" className="btn btn--primary" disabled={busy}>
                Start
              </button>
            </div>
          </form>
        )}
      </div>
    </main>
  );
}
