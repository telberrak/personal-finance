/**
 * Exchange rates for the currencies your accounts use: today's ECB rate (fetched from the sync server) or one
 * you type in. Used by Settings → Language and currency.
 */
import { useEffect, useState } from 'react';
import { updateSettings } from '../db/repo';
import type { FinanceData } from '../db/types';
import { t } from '../i18n';
import { formatDate, today } from '../lib/dates';
import { foreignCurrencies, ratesFromEcb, type FxRates } from '../lib/fx';
import { numberFormat } from '../lib/format';
import { normaliseNumber } from '../lib/money';
import { api } from '../sync/client';
import { Field } from './ui/forms';
import { useToast } from './ui/Toast';

/** Fetches the ECB rates for the currencies in use and saves them (manual rates are kept). */
export async function refreshRates(data: FinanceData): Promise<FxRates> {
  const ecb = await api<{ date: string; rates: Record<string, number> }>('/rates');
  const rates = ratesFromEcb(ecb, data.settings.currency, foreignCurrencies(data), data.settings.fxRates);
  await updateSettings({ fxRates: rates });
  return rates;
}

/** Once a day while the app is open, when foreign currencies are in use. Failures are silent: totals use the last rates. */
export function useDailyRates(data: FinanceData | undefined) {
  const needed = data ? foreignCurrencies(data).filter((c) => !data.settings.fxRates?.[c]?.manual) : [];
  const stale = !!data && needed.some((c) => (data.settings.fxRates?.[c]?.date ?? '') < today());
  const key = stale ? needed.join(',') : '';
  useEffect(() => {
    if (key && data) void refreshRates(data).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per set of stale currencies
  }, [key]);
}

/** Settings section: a rate per foreign currency, from the ECB or typed in. */
export function ExchangeRates({ data }: { data: FinanceData }) {
  const toast = useToast();
  const home = data.settings.currency;
  const currencies = foreignCurrencies(data);
  const rates = data.settings.fxRates ?? {};
  const [edits, setEdits] = useState<Record<string, string>>({});
  if (!currencies.length) return null;
  const show = (r: number) => numberFormat({ maximumFractionDigits: 4 }).format(r);

  async function save(cur: string) {
    const text = edits[cur];
    const value = text !== undefined ? Number(normaliseNumber(text)) : NaN;
    if (!(value > 0)) return toast({ message: t('fx.rateHint') });
    await updateSettings({ fxRates: { ...rates, [cur]: { rate: value, date: today(), manual: true } } });
    setEdits(({ [cur]: _done, ...rest }) => rest);
  }

  return (
    <section className="section" aria-labelledby="fx-title">
      <h2 className="section-label" id="fx-title">
        {t('fx.title')}
      </h2>
      <div className="list">
        {currencies.map((cur) => (
          <Field key={cur} label={t('fx.rateLabel', { currency: cur, home })}>
            {(id) => (
              <input
                id={id}
                inputMode="decimal"
                value={edits[cur] ?? (rates[cur] ? show(rates[cur].rate) : '')}
                placeholder={t('fx.missing')}
                onChange={(e) => setEdits({ ...edits, [cur]: e.target.value })}
                onBlur={() => edits[cur] !== undefined && void save(cur)}
              />
            )}
          </Field>
        ))}
      </div>
      <p className="small muted" style={{ padding: '0 4px' }}>
        {currencies
          .filter((c) => rates[c])
          .map((c) => t(rates[c].manual ? 'fx.manualOn' : 'fx.ecbOn', { currency: c, date: formatDate(rates[c].date) }))
          .join(' ')}{' '}
        {t('fx.note')}
      </p>
      <button
        type="button"
        className="btn"
        style={{ alignSelf: 'flex-start' }}
        onClick={() =>
          void refreshRates(data).then(
            () => toast({ message: t('fx.updated') }),
            () => toast({ message: t('fx.unavailable') }),
          )
        }
      >
        {t('fx.update')}
      </button>
    </section>
  );
}
