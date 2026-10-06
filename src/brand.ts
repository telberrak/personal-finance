/**
 * Brand and operator details in one place, so a rename or a new support address is a one-line
 * change. Set at build time with VITE_* variables (see docs/LAUNCH.md).
 */
// Short name, used in the app and on home screens.
export const APP_NAME = 'Mizan';
// Full name for store listings, the install prompt and the website. Other finance apps are also called
// "Mizan", so the qualifier keeps ours distinct (see docs/LAUNCH.md).
export const APP_FULL_NAME = 'Mizan: Safe to Spend';
/** Shown in help, legal pages and error messages. Set with VITE_SUPPORT_EMAIL at build time. */
export const SUPPORT_EMAIL: string = import.meta.env.VITE_SUPPORT_EMAIL || 'support@example.com';
/** The person or company named in the privacy policy and terms. Set with VITE_OPERATOR_NAME. */
export const OPERATOR: string = import.meta.env.VITE_OPERATOR_NAME || 'the Mizan team';
/** package.json version, injected by Vite (see vite.config.ts). */
export const APP_VERSION: string = __APP_VERSION__;
