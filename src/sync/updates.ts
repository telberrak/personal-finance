/**
 * News by email, from the app: subscribing with any address (confirmed by an emailed link), the
 * signed-in account's choice (its address is already proven), and unsubscribing from a link.
 * The server keeps the record of consent; see server/subscribers.ts.
 */
import { db } from '../db/db';
import { currentLanguage, t } from '../i18n';
import { api } from './client';

/** Where in the app someone said yes. */
export type UpdatesSource = 'app' | 'signup' | 'settings';

/** The wording shown next to the opt-in, stored with the consent. */
export const consentText = () => t('updates.consent');

const language = () => currentLanguage().slice(0, 2);

async function token(): Promise<string | undefined> {
  return (await db.syncState.get('sync'))?.token;
}

/** Asks for news at any address: the server emails a link to confirm it. */
export async function subscribeToUpdates(email: string): Promise<void> {
  await api('/subscribe', { body: { email: email.trim(), language: language(), source: 'app', consent: consentText() } });
}

/** Whether the signed-in account gets news; undefined when not signed in to sync. */
export async function accountUpdates(): Promise<boolean | undefined> {
  const tk = await token();
  if (!tk) return undefined;
  return (await api<{ subscribed: boolean }>('/me/updates', { token: tk })).subscribed;
}

/** Turns news on or off for the signed-in account. */
export async function setAccountUpdates(subscribed: boolean, source: UpdatesSource = 'settings'): Promise<void> {
  const tk = await token();
  if (!tk) return;
  await api('/me/updates', {
    method: 'PUT',
    token: tk,
    body: subscribed ? { subscribed, language: language(), source, consent: consentText() } : { subscribed },
  });
}

/** Unsubscribes the address behind an unsubscribe link. */
export async function unsubscribeWithToken(unsubscribeToken: string): Promise<void> {
  await api('/unsubscribe', { body: { token: unsubscribeToken } });
}
