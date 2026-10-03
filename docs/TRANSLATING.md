# Languages and translation

Ledger ships in English. The code is ready for other languages, French and Arabic (right to left) first: adding one means adding a translation file, not changing screens.

## How it works

- **Strings:** all user-visible text is in [`src/locales/en.json`](../src/locales/en.json), grouped by area (`home.*`, `bills.*`, `errors.*`…). Code calls `t('area.key', { values })` from `src/i18n`.
- **Library:** [i18next](https://www.i18next.com/) handles interpolation (`{{name}}`) and plurals. Plural keys end in `_one`, `_other`, and for Arabic also `_zero`, `_two`, `_few`, `_many`.
- **Formatting:** money, numbers, percentages and dates go through `src/lib/format.ts`, `money.ts` and `dates.ts`, which use `Intl` with the chosen locale and currency. No other code formats numbers or dates.
- **Settings:** language and currency are separate settings (Settings → Language and currency). Changing the currency changes the symbol and format only; it does not convert amounts.
- **Right to left:**
  - `applyLocale` sets `dir` and `lang` on `<html>`;
  - CSS uses logical properties (`inline-start`/`inline-end`);
  - direction icons mirror via `.mirror-rtl`;
  - amounts are wrapped in Unicode isolates so `−£6.97` keeps its order inside Arabic text;
  - an Arabic font is loaded when needed.
- **User data:** payees, notes and category or account names you type are never translated. They are marked `translate="no"`, which also stops browser auto-translate from changing them.

## Adding French or Arabic

1. Copy `src/locales/en.json` to `src/locales/fr.json` (or `ar.json`) and translate the values. Keep every `{{placeholder}}` and do not translate keys.
2. For Arabic, add the plural forms each `_other` key needs: `_zero`, `_one`, `_two`, `_few`, `_many`, `_other`.
3. Register the language in `LANGUAGES` in [`src/i18n/index.ts`](../src/i18n/index.ts) and add its resources to `i18next.init`:
   - French: `{ code: 'fr', name: 'Français', dir: 'ltr', formatLocale: 'fr-FR' }`;
   - Arabic: `{ code: 'ar', name: 'العربية', dir: 'rtl', formatLocale: 'ar-u-nu-latn' }` (Latin digits), or `'ar'` for Arabic-Indic digits.
4. Run `npm test`. The key test fails if a key used in the code is missing from `en.json` or a plural set is incomplete.
5. Run the e2e suite and look at screens in the new language at phone and desktop sizes.

## Writing new screens

The lint rule `i18next/no-literal-string` fails the build on hard-coded text in JSX. When you add a screen:

- **Add keys to `en.json`.** Write whole sentences with placeholders: `t('bills.wentUp', { name, amount })`, never `name + ' went up'`.
- **Plurals:** use `t('key', { count })` with `_one`/`_other` keys, never `n === 1 ? '' : 's'`.
- **Formatting:** use `formatMoney`, `formatWhole`, `formatPercent`, `formatDate`… never `toFixed` or `toLocaleString` for display.
- **Layout:** use logical CSS (`margin-inline-start`, `text-align: start`) and add `translate="no"` to elements that show user data.

## Testing with pseudo-locales

Two test languages are built automatically from `en.json`:

- **`en-XA`:** accented, about 40% longer text, wrapped in `⟦…⟧`. Untranslated text stands out, and long translations show where layouts clip.
- **`ar-XB`:** the same text right to left, to check mirroring before real Arabic exists.

Open any page with `?locale=en-XA` or `?locale=ar-XB` (it lasts for the browser tab). In development they also appear in the language picker. `e2e/i18n.spec.ts` checks every screen in both.
