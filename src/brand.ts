/**
 * Brand and operator details in one place. The support address and operator name come from the
 * server at runtime (GET /api/config, set in AWS Parameter Store), so they change without a new
 * build; the last values are remembered for offline use. VITE_* variables are a fallback for builds
 * without a server (see docs/LAUNCH.md).
 */
import { api } from './sync/client';

// Short name, used in the app and on home screens.
export const APP_NAME = 'Mizan';
// Full name for store listings, the install prompt and the website. Other finance apps are also called
// "Mizan", so the qualifier keeps ours distinct (see docs/LAUNCH.md).
export const APP_FULL_NAME = 'Mizan: Safe to Spend';
/** package.json version, injected by Vite (see vite.config.ts). */
export const APP_VERSION: string = __APP_VERSION__;

/** The contact details the server publishes. */
interface Contact {
  supportEmail?: string | null;
  operator?: string | null;
}

const STORAGE_KEY = 'mizan-contact';

function remembered(): Contact {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Contact;
  } catch {
    return {};
  }
}

let contact: Contact = remembered();

/** Shown in help, legal pages and error messages. */
export const supportEmail = (): string => contact.supportEmail || import.meta.env.VITE_SUPPORT_EMAIL || 'support@example.com';
/** The person or company named in the privacy policy and terms. */
export const operatorName = (): string => contact.operator || import.meta.env.VITE_OPERATOR_NAME || 'the Mizan team';

/** Fetches the current contact details from the server and remembers them. Failures keep the last ones. */
export async function refreshContact(): Promise<void> {
  try {
    contact = await api<Contact>('/config');
    localStorage.setItem(STORAGE_KEY, JSON.stringify(contact));
  } catch {
    // Offline, or no server (native builds without one): the remembered or built-in values stay.
  }
}
