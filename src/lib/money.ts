import { formatConfig, isolate, isolateEnd, isolateStart, numberFormat } from './format';

/** All money is stored as integer minor units (pence, cents...) to avoid floating-point drift. */
export type Pence = number;

/** £1,234.50, −£23.40, or +£42.00 when `sign` is set and the amount is positive. Uses the display locale and currency. */
export function formatMoney(pence: Pence, opts: { sign?: boolean } = {}): string {
  const body = numberFormat({ style: 'currency', currency: formatConfig().currency }).format(Math.abs(pence) / 100);
  if (pence < 0) return isolate('−' + body);
  if (opts.sign && pence > 0) return isolate('+' + body);
  return isolate(body);
}

/** Whole units with no minor part, for compact labels: £750. */
export function formatWhole(pence: Pence): string {
  return isolate(
    numberFormat({ style: 'currency', currency: formatConfig().currency, maximumFractionDigits: 0, minimumFractionDigits: 0 }).format(
      Math.round(pence / 100),
    ),
  );
}

/** Arabic-Indic (\u0660-\u0669) and Persian (\u06F0-\u06F9) digits to ASCII; Arabic decimal/thousands marks to '.' and ','. */
function westernDigits(s: string): string {
  return s
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/\u066B/g, '.')
    .replace(/\u066C/g, ',');
}

/**
 * Normalises a typed or imported number to "1234.56" form, or null.
 * Accepts "1,234.56", "1 234,56", "12,50" and Arabic-Indic digits. A comma followed by exactly three digits is a
 * thousands separator; followed by one or two digits at the end it is the decimal mark.
 */
export function normaliseNumber(input: string): string | null {
  let s = westernDigits(input).replace(/[\s\u00A0\u202F'\u2019]/g, '');
  s = s.replace(/[^\d.,+-]/g, ''); // currency symbols and letters
  if (!/\d/.test(s)) return null;
  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  if (lastDot >= 0 && lastComma >= 0) {
    // Both present: whichever comes last is the decimal mark.
    s = lastComma > lastDot ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (lastComma >= 0) {
    s = /,\d{1,2}$/.test(s) && s.indexOf(',') === lastComma ? s.replace(',', '.') : s.replace(/,(?=\d{3}(\D|$))/g, '');
    if (s.includes(',')) return null;
  }
  return s;
}

/** Parses user input such as "23.4", "£1,200", "12,50" or "0.99" into minor units. Returns null when invalid. */
export function parseMoney(input: string): Pence | null {
  const s = normaliseNumber(input);
  if (s === null || !/^\d*(\.\d{0,2})?$/.test(s) || s === '' || s === '.') return null;
  const [whole, frac = ''] = s.split('.');
  return Number(whole || '0') * 100 + Number(frac.padEnd(2, '0'));
}

/** Characters allowed while typing an amount (digits in any script, separators, spaces). */
export const MONEY_INPUT_CHARS = /[^\d\u0660-\u0669\u06F0-\u06F9.,\u066B\u066C\s]/g;

/**
 * Splits a formatted amount at the decimal mark for display ("£981" + ".91", "981" + ",91 €"),
 * using the locale's own number parts rather than assuming '.'.
 */
export function moneyParts(pence: Pence): { main: string; fraction: string } {
  const parts = numberFormat({ style: 'currency', currency: formatConfig().currency }).formatToParts(Math.abs(pence) / 100);
  const at = parts.findIndex((p) => p.type === 'decimal');
  const join = (ps: Intl.NumberFormatPart[]) => ps.map((p) => p.value).join('');
  const sign = pence < 0 ? '−' : '';
  // The isolate opens in `main` and closes in `fraction`: both render in one paragraph.
  return at < 0
    ? { main: isolate(sign + join(parts)), fraction: '' }
    : { main: isolateStart(sign + join(parts.slice(0, at))), fraction: isolateEnd(join(parts.slice(at))) };
}

/** The display currency's symbol: £, €, MAD… */
export function currencySymbol(): string {
  const parts = numberFormat({ style: 'currency', currency: formatConfig().currency }).formatToParts(0);
  return parts.find((p) => p.type === 'currency')?.value ?? formatConfig().currency;
}

/** 0.82 → "82%" (or "82 %" in French). */
export function formatPercent(ratio: number): string {
  return numberFormat({ style: 'percent', maximumFractionDigits: 0 }).format(ratio);
}

/** "British Pound (GBP)" in the display language. */
export function currencyName(code: string): string {
  try {
    const name = new Intl.DisplayNames(formatConfig().locale, { type: 'currency' }).of(code);
    return name && name !== code ? `${name} (${code})` : code;
  } catch {
    return code;
  }
}

/** "0.00" or "0,00": an empty-amount placeholder in the display locale. */
export function zeroPlaceholder(): string {
  return numberFormat({ minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(0);
}
