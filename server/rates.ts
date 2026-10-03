/**
 * Exchange rates: the European Central Bank's daily reference rates (about 30 currencies, euro
 * based), cached for six hours. Public data, so no sign-in is needed. Currencies the ECB does not
 * publish (e.g. MAD, AED, SAR) are entered by hand in the app.
 */
import type { Hono } from 'hono';

const ECB = 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml';
const TTL_MS = 6 * 3_600_000;

export interface EcbRates {
  date: string;
  /** Units of each currency per euro. */
  rates: Record<string, number>;
}

export function parseEcb(xml: string): EcbRates {
  const date = xml.match(/time=['"](\d{4}-\d{2}-\d{2})['"]/)?.[1];
  const rates: Record<string, number> = {};
  for (const m of xml.matchAll(/currency=['"]([A-Z]{3})['"]\s+rate=['"]([\d.]+)['"]/g)) rates[m[1]] = Number(m[2]);
  if (!date || !Object.keys(rates).length) throw new Error('Unexpected ECB response');
  return { date, rates };
}

export function rateRoutes(app: Hono, fetchImpl: typeof fetch = fetch) {
  let cache: { at: number; data: EcbRates } | undefined;
  app.get('/rates', async (c) => {
    if (!cache || Date.now() - cache.at > TTL_MS) {
      try {
        const res = await fetchImpl(ECB);
        if (!res.ok) throw new Error(`ECB returned ${res.status}`);
        cache = { at: Date.now(), data: parseEcb(await res.text()) };
      } catch (err) {
        if (!cache) return c.json({ error: 'Exchange rates are not available right now.' }, 502);
        console.error('[rates]', err instanceof Error ? err.message : 'failed'); // serve the last good rates
      }
    }
    c.header('cache-control', 'public, max-age=3600');
    return c.json(cache.data);
  });
}
