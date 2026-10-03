/**
 * Opt-in, cookie-free usage counts (Settings → About). Only event names from a fixed list are
 * sent, batched; the server keeps daily totals with no identifier. Off unless you turn it on.
 */
import { api } from '../sync/client';

export type UsageEvent =
  | 'app_open'
  | 'transaction_added'
  | 'import_done'
  | 'bill_added'
  | 'sync_enabled'
  | 'bank_connected'
  | 'household_joined'
  | 'receipt_read'
  | 'language_fr'
  | 'language_ar';

let enabled = false;
let queue: UsageEvent[] = [];
let timer: ReturnType<typeof setTimeout> | undefined;

export function setUsageSharing(on: boolean) {
  enabled = on;
  if (!on) queue = [];
}

export function track(event: UsageEvent) {
  if (!enabled) return;
  queue.push(event);
  clearTimeout(timer);
  timer = setTimeout(() => {
    const events = queue;
    queue = [];
    void api('/events', { body: { events } }).catch(() => undefined);
  }, 5_000);
}
