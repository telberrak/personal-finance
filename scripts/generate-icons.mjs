// Renders the SVG app icons to the PNG sizes iOS and Android need. Run: npm run icons
// Uses Playwright's browser (the installed Edge locally, so nothing is downloaded).
import { chromium } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const OUTPUTS = [
  { src: 'public/icon.svg', out: 'public/icon-192.png', size: 192, transparent: true },
  { src: 'public/icon.svg', out: 'public/icon-512.png', size: 512, transparent: true },
  { src: 'public/icon-maskable.svg', out: 'public/icon-maskable-512.png', size: 512 },
  { src: 'public/icon-maskable.svg', out: 'public/apple-touch-icon.png', size: 180 },
];

const browser = await chromium.launch(process.env.CI ? {} : { channel: 'msedge' });
const page = await browser.newPage({ deviceScaleFactor: 1 });
for (const { src, out, size, transparent } of OUTPUTS) {
  const svg = (await readFile(src, 'utf8')).replace('<svg ', `<svg width="${size}" height="${size}" `);
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<style>html,body{margin:0;background:transparent}</style>${svg}`);
  await page.locator('svg').screenshot({ path: out, omitBackground: !!transparent });
  console.log(`wrote ${out} (${size}×${size})`);
}
await browser.close();
