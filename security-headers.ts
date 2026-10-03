/**
 * HTTP security headers, used by `vite preview` (so the e2e tests run under them) and copied into
 * netlify.toml and vercel.json. src/security-headers.test.ts fails if the copies drift apart.
 *
 * The app loads nothing from other origins: scripts, styles and fonts are all bundled.
 * Inline `style` attributes (React's style prop) are the only inline content allowed.
 */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "style-src-attr 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "worker-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

export const SECURITY_HEADERS: Record<string, string> = {
  'Content-Security-Policy': CONTENT_SECURITY_POLICY,
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
};

/** Only over HTTPS (the hosting configs); browsers ignore it on localhost anyway. */
export const HSTS = 'max-age=63072000; includeSubDomains';
