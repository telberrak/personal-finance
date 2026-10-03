import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { readFileSync } from 'node:fs';
import { ocrAssets } from './ocr-assets.ts';
import { SECURITY_HEADERS } from './security-headers.ts';

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8')) as { version: string };

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(version) },
  plugins: [
    react(),
    ocrAssets(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['icon.svg', 'apple-touch-icon.png'],
      workbox: {
        // Works offline with the Latin font; the Arabic font is cached by the browser once used.
        globPatterns: ['**/*.{js,css,html,svg,png}', 'assets/geist-*.woff2'],
        // Web Push reminders, and receipts shared to the installed app (sw-extra.js).
        importScripts: ['sw-extra.js'],
        // Receipt reading (12 MB) is not pre-cached: it is cached the first time it is used.
        globIgnores: ['ocr/**'],
        runtimeCaching: [{ urlPattern: /\/ocr\//, handler: 'CacheFirst', options: { cacheName: 'ocr' } }],
      },
      manifest: {
        name: 'Mizan: Safe to Spend',
        short_name: 'Mizan',
        description: 'Everyday money: spending, bills and budgets.',
        theme_color: '#14161A',
        background_color: '#F4F5F2',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        // "Share" a photo or PDF from another app straight into a new expense.
        share_target: {
          action: '/share-receipt',
          method: 'POST',
          enctype: 'multipart/form-data',
          params: { files: [{ name: 'receipt', accept: ['image/*', 'application/pdf'] }] },
        },
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
        ],
      },
    }),
  ],
  // The production preview (and so the e2e tests) runs under the same headers as the hosted app.
  // The sync API (npm run server) is reached at /api on the app's own origin.
  server: {
    proxy: { '/api': process.env.LEDGER_API ?? 'http://localhost:8787' },
    // The local sync API's database changes constantly and is not app code.
    watch: { ignored: ['**/.ledger-*data*/**'] },
  },
  preview: { headers: SECURITY_HEADERS, proxy: { '/api': process.env.LEDGER_API ?? 'http://localhost:8787' } },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}', 'server/**/*.test.ts'],
    setupFiles: ['src/test/setup.ts'],
  },
});
