import { describe, expect, it } from 'vitest';
import { HSTS, SECURITY_HEADERS } from '../security-headers';
import indexHtml from '../index.html?raw';
import netlifyToml from '../netlify.toml?raw';
import vercelJson from '../vercel.json?raw';

const expected = { ...SECURITY_HEADERS, 'Strict-Transport-Security': HSTS };

describe('hosting security headers', () => {
  it('netlify.toml sends the same headers as security-headers.ts', () => {
    const toml = netlifyToml;
    for (const [key, value] of Object.entries(expected)) expect(toml).toContain(`${key} = "${value}"`);
  });

  it('vercel.json sends the same headers as security-headers.ts', () => {
    const config = JSON.parse(vercelJson) as { headers: { source: string; headers: { key: string; value: string }[] }[] };
    const all = config.headers.find((h) => h.source === '/(.*)')!.headers;
    expect(Object.fromEntries(all.map((h) => [h.key, h.value]))).toEqual(expected);
  });

  it('the page loads nothing from other origins', () => {
    expect(indexHtml).not.toMatch(/https?:\/\//);
  });
});
