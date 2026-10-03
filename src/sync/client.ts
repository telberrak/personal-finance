/**
 * Calls to the sync API. On the web it is served under /api on the app's own origin, so the CSP
 * stays 'self'. The native apps are not served by the web host, so they are built with
 * VITE_API_ORIGIN (e.g. https://mizan.example.com) and the server allows them through CORS.
 */
import type { ApiError } from '../../shared/api.ts';

const API_BASE = `${import.meta.env.VITE_API_ORIGIN ?? ''}/api`;

export class SyncApiError extends Error {
  name = 'SyncApiError';
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Status 0: the server could not be reached. */
export async function api<T>(path: string, opts: { method?: string; body?: unknown; token?: string } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method: opts.method ?? (opts.body === undefined ? 'GET' : 'POST'),
      headers: {
        ...(opts.body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
      },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    });
  } catch {
    throw new SyncApiError(0, 'offline');
  }
  const text = await res.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : undefined;
  } catch {
    // A static host without the API answers with the app's HTML.
    throw new SyncApiError(res.ok ? 0 : res.status, 'not the sync server');
  }
  if (!res.ok) throw new SyncApiError(res.status, (data as ApiError | undefined)?.error ?? res.statusText);
  return data as T;
}
