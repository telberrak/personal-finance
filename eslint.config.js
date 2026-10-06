/**
 * ESLint: TypeScript and React rules, plus i18next/no-literal-string so no visible text is hard-coded in JSX
 * (it must go through t() and the locale files).
 */
import js from '@eslint/js';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import i18next from 'eslint-plugin-i18next';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'dev-dist', 'coverage', 'playwright-report', 'test-results', 'android', 'ios'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  jsxA11y.flatConfigs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser } },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      // Inputs on a full-screen form are deliberately focused on open (Add transaction).
      'jsx-a11y/no-autofocus': 'off',
    },
  },
  {
    // No hard-coded user-visible text: every string goes through t() (see docs/ROADMAP_PRO.md, multi-language rules).
    files: ['src/**/*.tsx'],
    ignores: ['src/**/*.test.tsx'],
    plugins: { i18next },
    rules: {
      'i18next/no-literal-string': [
        'error',
        {
          mode: 'jsx-only',
          'jsx-attributes': { include: ['^(aria-label|title|placeholder|alt|label|caption|subtitle|message|confirmLabel|cancelLabel)$'] },
          // Punctuation, numbers and symbols on their own are not translatable text (hyphen last: no range).
          words: { exclude: ['[ .,:;!?()…·—–+×%/|0-9-]*', '⇄'] },
        },
      ],
    },
  },
  {
    files: ['public/**/*.js'],
    languageOptions: { globals: { ...globals.serviceworker } },
  },
  {
    files: ['scripts/**', '*.config.{js,ts}', 'e2e/**'],
    languageOptions: { globals: { ...globals.node } },
  },
);
