/**
 * Serves the built web app (dist/) next to the API, so one container hosts both on the same
 * origin: the CSP stays connect-src 'self' and no CORS is needed. Used when WEB_DIR is set
 * (the Docker image sets it); static hosts such as Netlify serve the app themselves.
 *
 * Headers match netlify.toml and vercel.json: security headers on everything, the service
 * worker never cached, hashed assets cached for a year.
 */
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { HSTS, SECURITY_HEADERS } from '../security-headers.ts';

type Fetch = (request: Request, env?: unknown) => Response | Promise<Response>;

/**
 * Wraps the API so the same server also serves the built app from `root`, with SPA fallback and the app's
 * headers.
 */
export function withWebApp(api: { fetch: Fetch }, root: string, { https = true }: { https?: boolean } = {}): Hono {
  const app = new Hono();
  app.use('*', async (c, next) => {
    await next();
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) if (!c.res.headers.has(name)) c.res.headers.set(name, value);
    if (https) c.res.headers.set('Strict-Transport-Security', HSTS);
  });
  // Everything under /api goes to the API (with the connection info it uses for rate limits),
  // so unknown API paths are API 404s, never the app's index page.
  app.all('/api', (c) => api.fetch(c.req.raw, c.env));
  app.all('/api/*', (c) => api.fetch(c.req.raw, c.env));

  app.use('/assets/*', async (c, next) => {
    await next();
    if (c.res.ok) c.res.headers.set('Cache-Control', 'public, max-age=31536000, immutable');
  });
  app.use('*', async (c, next) => {
    await next();
    if (/^\/(sw\.js|sw-extra\.js|index\.html|manifest\.webmanifest)?$/.test(c.req.path)) c.res.headers.set('Cache-Control', 'no-cache');
  });
  app.use('*', serveStatic({ root }));
  // Single-page app: client-side routes like /bills get index.html.
  app.get('*', serveStatic({ root, path: 'index.html' }));
  return app;
}
