import type { Context } from 'hono';

/**
 * The visitor's address, for rate limits. In production the API sits behind Caddy, which replaces
 * any X-Forwarded-For sent by the visitor with the real address, so the first entry can be trusted.
 * Without a proxy (local development) everyone is 'local'.
 */
export const clientIp = (c: Context): string => c.req.header('x-forwarded-for')?.split(',')[0].trim() || 'local';
