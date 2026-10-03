/**
 * The one place that knows the display locale and currency. Money and date helpers read it,
 * so nothing else in the app hard-codes 'en-GB' or 'GBP'. Set from the user's settings
 * (see applyLocale in src/i18n).
 */
export interface FormatConfig {
  /** BCP 47 locale for Intl formatting, e.g. 'en-GB', 'fr-FR', 'ar-u-nu-latn'. */
  locale: string;
  /** ISO 4217 code, e.g. 'GBP', 'EUR', 'MAD'. */
  currency: string;
  /**
   * Right-to-left interface: wrap formatted amounts in first-strong isolates so "−£6.97" keeps its
   * order inside Arabic text (an Arabic-formatted amount resolves to RTL by itself).
   */
  isolate: boolean;
  /** Privacy mode: amounts show as "£•••" (Settings → Security → Hide amounts). */
  hideAmounts: boolean;
}

let config: FormatConfig = { locale: 'en-GB', currency: 'GBP', isolate: false, hideAmounts: false };
const numberCache = new Map<string, Intl.NumberFormat>();
const dateCache = new Map<string, Intl.DateTimeFormat>();

export function configureFormatting(next: Partial<FormatConfig>): void {
  const merged = { ...config, ...next };
  if (
    merged.locale === config.locale &&
    merged.currency === config.currency &&
    merged.isolate === config.isolate &&
    merged.hideAmounts === config.hideAmounts
  )
    return;
  config = merged;
  numberCache.clear();
  dateCache.clear();
}

const FSI = '\u2068';
const PDI = '\u2069';

/** Wraps text in Unicode isolates when the interface is right-to-left. */
export const isolate = (s: string): string => (config.isolate ? FSI + s + PDI : s);
export const isolateStart = (s: string): string => (config.isolate ? FSI + s : s);
export const isolateEnd = (s: string): string => (config.isolate ? s + PDI : s);

export const formatConfig = (): Readonly<FormatConfig> => config;

export function numberFormat(options: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = JSON.stringify(options);
  let f = numberCache.get(key);
  if (!f) numberCache.set(key, (f = new Intl.NumberFormat(config.locale, options)));
  return f;
}

export function dateFormat(options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = JSON.stringify(options);
  let f = dateCache.get(key);
  if (!f) dateCache.set(key, (f = new Intl.DateTimeFormat(config.locale, options)));
  return f;
}

/** ["a", "b", "c"] → "a, b, c" in the display locale's style. */
export function formatList(items: string[]): string {
  try {
    return new Intl.ListFormat(config.locale, { style: 'narrow', type: 'unit' }).format(items);
  } catch {
    return items.join(', ');
  }
}

/** A country's name in the display language, from its ISO 3166 code ("GB" → "United Kingdom"). */
export function regionName(code: string): string {
  try {
    return new Intl.DisplayNames([config.locale], { type: 'region' }).of(code) ?? code;
  } catch {
    return code;
  }
}
