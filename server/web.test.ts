// @vitest-environment node
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { CONTENT_SECURITY_POLICY } from '../security-headers.ts';
import { withWebApp } from './web.ts';

const root = mkdtempSync(join(tmpdir(), 'mizan-web-'));
writeFileSync(join(root, 'index.html'), '<!doctype html><title>Mizan</title>');
writeFileSync(join(root, 'sw.js'), '// sw');
mkdirSync(join(root, 'assets'));
writeFileSync(join(root, 'assets', 'index-abc.js'), 'console.log(1)');

const api = new Hono().basePath('/api');
api.get('/health', (c) => c.json({ ok: true }));
const app = withWebApp(api, root);

describe('serving the web app next to the API', () => {
  it('routes /api to the API and unknown API paths to a 404', async () => {
    expect(await (await app.request('/api/health')).json()).toEqual({ ok: true });
    const missing = await app.request('/api/nope');
    expect(missing.status).toBe(404);
    expect(await missing.text()).not.toContain('<title>');
  });

  it('serves app routes with index.html and the security headers', async () => {
    const res = await app.request('/bills');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('<title>Mizan</title>');
    expect(res.headers.get('content-security-policy')).toBe(CONTENT_SECURITY_POLICY);
    expect(res.headers.get('strict-transport-security')).toMatch(/max-age=/);
  });

  it('never caches the service worker, and caches hashed assets for a year', async () => {
    expect((await app.request('/sw.js')).headers.get('cache-control')).toBe('no-cache');
    expect((await app.request('/assets/index-abc.js')).headers.get('cache-control')).toMatch(/immutable/);
  });
});
