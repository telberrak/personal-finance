import i18next from 'i18next';
import ar from '../locales/ar.json';
import en from '../locales/en.json';
import fr from '../locales/fr.json';
import { configureFormatting } from '../lib/format';
import { pseudoLocalise } from './pseudo';

/** A supported language: its code, its name in itself, text direction and formatting locale. */
export interface Language {
  code: string;
  /** Name shown in the picker, in the language itself. */
  name: string;
  dir: 'ltr' | 'rtl';
  /** Locale used for Intl number and date formatting. */
  formatLocale: string;
  /** Test-only languages are hidden from normal users. */
  pseudo?: boolean;
}

/**
 * Languages the app can show. French and Arabic are first translations, to be reviewed by
 * native speakers (see docs/TRANSLATING.md). Arabic shows Latin digits by default; Settings can
 * switch to Arabic-Indic digits.
 */
export const LANGUAGES: Language[] = [
  { code: 'en', name: 'English', dir: 'ltr', formatLocale: 'en-GB' },
  { code: 'fr', name: 'Français', dir: 'ltr', formatLocale: 'fr-FR' },
  { code: 'ar', name: 'العربية', dir: 'rtl', formatLocale: 'ar-u-nu-latn' },
  // Pseudo-locales for testing: accented and ~40% longer text exposes hard-coded strings and clipping;
  // the RTL one checks right-to-left layout before real Arabic translations exist.
  { code: 'en-XA', name: 'Ƥśéûðö (test)', dir: 'ltr', formatLocale: 'en-GB', pseudo: true },
  { code: 'ar-XB', name: 'RTL test', dir: 'rtl', formatLocale: 'en-GB', pseudo: true },
];

/** Home currencies offered in Settings. */
export const CURRENCIES = ['GBP', 'EUR', 'USD', 'MAD', 'AED', 'SAR', 'EGP', 'TND', 'DZD', 'CHF', 'CAD'] as const;

const pseudoResources = pseudoLocalise(en);

void i18next.init({
  lng: 'en',
  fallbackLng: 'en',
  initAsync: false,
  resources: {
    en: { translation: en },
    fr: { translation: fr },
    ar: { translation: ar },
    'en-XA': { translation: pseudoResources },
    'ar-XB': { translation: pseudoResources },
  },
  interpolation: { escapeValue: false }, // React escapes already
  returnNull: false,
});

/** Translate. Re-renders on language change come from settings changing, which re-renders the app. */
export const t: typeof i18next.t = ((...args: Parameters<typeof i18next.t>) => i18next.t(...args)) as typeof i18next.t;

/** A language by code, English if unknown. */
export const languageOf = (code: string): Language => LANGUAGES.find((l) => l.code === code) ?? LANGUAGES[0];

/** The language being shown now (the setting, or a ?locale= override). */
export const currentLanguage = (): string => i18next.language || 'en';

/** A test language chosen with ?locale=en-XA stays for the browser session without being saved. */
function sessionOverride(): string | undefined {
  try {
    const fromUrl = new URLSearchParams(window.location.search).get('locale');
    if (fromUrl && LANGUAGES.some((l) => l.code === fromUrl)) sessionStorage.setItem('ledger-locale', fromUrl);
    return sessionStorage.getItem('ledger-locale') ?? undefined;
  } catch {
    return undefined;
  }
}

let arabicFontLoaded = false;

/** The locale used for numbers and dates, with the digits chosen in Settings (Arabic). */
export function formatLocaleOf(lang: Language, digits?: 'latn' | 'arab'): string {
  if (lang.code !== 'ar' || !digits) return lang.formatLocale;
  return digits === 'arab' ? 'ar' : 'ar-u-nu-latn';
}

/** Applies language, text direction and number/date formatting. Safe to call on every render. */
export function applyLocale(languageCode: string, currency: string, hideAmounts = false, digits?: 'latn' | 'arab'): Language {
  const lang = languageOf(sessionOverride() ?? languageCode);
  if (i18next.language !== lang.code) void i18next.changeLanguage(lang.code);
  configureFormatting({ locale: formatLocaleOf(lang, digits), currency, isolate: lang.dir === 'rtl', hideAmounts });
  const html = document.documentElement;
  if (html.lang !== lang.code) html.lang = lang.code;
  if (html.dir !== lang.dir) html.dir = lang.dir;
  if (lang.dir === 'rtl' && !arabicFontLoaded) {
    arabicFontLoaded = true;
    // Bundled but loaded on demand: only right-to-left languages need it.
    void Promise.all([
      import('@fontsource/ibm-plex-sans-arabic/arabic-400.css'),
      import('@fontsource/ibm-plex-sans-arabic/arabic-500.css'),
      import('@fontsource/ibm-plex-sans-arabic/arabic-600.css'),
      import('@fontsource/ibm-plex-sans-arabic/arabic-700.css'),
    ]);
  }
  return lang;
}

export default i18next;
