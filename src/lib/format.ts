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

/** Sets the language, digits and currency used by every formatter. Called when settings change. */
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

// Left-to-right isolates: an amount reads "−£6.97" the same way inside Arabic text.
const LRI = '\u2066';
const PDI = '\u2069';
/** Direction marks Intl adds to Arabic-locale numbers; the isolate does their job. */
const BIDI_MARKS = /[\u200E\u200F\u061C]/g;

/** Wraps text in Unicode isolates when the interface is right-to-left. */
export const isolate = (s: string): string => (config.isolate ? LRI + s.replace(BIDI_MARKS, '') + PDI : s);
/**
 * Wraps text that starts a mixed-direction string in a bidi isolate (Arabic), so amounts keep their order.
 */
export const isolateStart = (s: string): string => (config.isolate ? LRI + s.replace(BIDI_MARKS, '') : s);
/** Like isolateStart, for text that ends a mixed-direction string. */
export const isolateEnd = (s: string): string => (config.isolate ? s.replace(BIDI_MARKS, '') + PDI : s);

/** The current formatting settings. */
export const formatConfig = (): Readonly<FormatConfig> => config;

/** A cached Intl.NumberFormat for the interface language and digits. */
export function numberFormat(options: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = JSON.stringify(options);
  let f = numberCache.get(key);
  if (!f) numberCache.set(key, (f = new Intl.NumberFormat(config.locale, options)));
  return f;
}

/** A cached Intl.DateTimeFormat for the interface language and digits. */
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

/** A weekday's name in the display language: 1 Monday … 7 Sunday (ISO). */
export function weekdayName(isoDay: number): string {
  // 1 January 2024 was a Monday.
  return dateFormat({ weekday: 'long' }).format(new Date(2024, 0, isoDay));
}

/** The first day of the week for the display locale (1 Monday … 7 Sunday), where the browser knows it. */
export function localeWeekStart(): number {
  try {
    const locale = new Intl.Locale(config.locale) as Intl.Locale & {
      getWeekInfo?: () => { firstDay: number };
      weekInfo?: { firstDay: number };
    };
    return locale.getWeekInfo?.().firstDay ?? locale.weekInfo?.firstDay ?? 1;
  } catch {
    return 1;
  }
}
