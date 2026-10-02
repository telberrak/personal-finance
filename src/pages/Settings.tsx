import { useState } from 'react';
import { Link } from 'react-router';
import { Icon } from '../components/Icon';
import { Loading } from '../components/Layout';
import { updateSettings } from '../db/db';
import { eraseAllData, resetDemoData } from '../db/seed';
import type { FinanceData, ThemePreference } from '../db/types';
import { formatMoney, parseMoney } from '../lib/money';

const THEMES: { id: ThemePreference; label: string }[] = [
  { id: 'system', label: 'System' },
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' },
];

export function Settings({ data }: { data?: FinanceData }) {
  const [savingsText, setSavingsText] = useState<string>();
  if (!data) return <Loading />;
  const { settings } = data;

  function commitSavings() {
    if (savingsText === undefined) return;
    const pence = parseMoney(savingsText);
    if (pence !== null) updateSettings({ monthlySavings: pence });
    setSavingsText(undefined);
  }

  return (
    <main className="screen screen--modal">
      <header className="screen-header">
        <Link to="/" className="icon-btn" aria-label="Back">
          <Icon name="back" size={20} strokeWidth={2} />
        </Link>
        <h1 style={{ fontSize: 17, fontWeight: 600 }}>Settings</h1>
        <span style={{ width: 44 }} />
      </header>

      <section className="section">
        <h2 className="section-label" id="theme-label">
          Appearance
        </h2>
        <div className="segmented" role="radiogroup" aria-labelledby="theme-label">
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
      </section>

      <section className="section">
        <h2 className="section-label">Pay cycle</h2>
        <div className="list">
          <div className="field">
            <label htmlFor="payday">Payday</label>
            <select id="payday" value={settings.payday} onChange={(e) => updateSettings({ payday: Number(e.target.value) })}>
              {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                <option key={d} value={d}>
                  Day {d} of the month
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="savings">Savings</label>
            <input
              id="savings"
              inputMode="decimal"
              value={savingsText ?? formatMoney(settings.monthlySavings)}
              onFocus={() => setSavingsText((settings.monthlySavings / 100).toFixed(2))}
              onChange={(e) => setSavingsText(e.target.value)}
              onBlur={commitSavings}
              onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            />
          </div>
        </div>
        <p className="small muted" style={{ padding: '0 4px' }}>
          Savings are set aside each pay cycle and left out of “safe to spend”.
        </p>
      </section>

      <section className="section">
        <h2 className="section-label">Data</h2>
        <p className="small muted" style={{ padding: '0 4px' }}>
          Everything is stored only on this device.
        </p>
        <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
          <button type="button" className="btn" onClick={() => confirm('Replace all data with fresh demo data?') && resetDemoData()}>
            Reset demo data
          </button>
          <button
            type="button"
            className="btn btn--danger"
            onClick={() => confirm('Erase all transactions, bills and budgets? This cannot be undone.') && eraseAllData()}
          >
            Erase all data
          </button>
        </div>
      </section>
    </main>
  );
}
