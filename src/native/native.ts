/**
 * Native features when running inside the iOS or Android app (Capacitor). Each is loaded on
 * demand, so the web app does not download native plugins it cannot use.
 *
 * - Biometric unlock: the data key is kept in the system keychain (iOS Keychain, Android
 *   Keystore-backed storage), only on this device, and read after Face ID / fingerprint.
 * - Reminders: scheduled as local notifications on the device; no push server is needed, so they
 *   can say which bill is due.
 */
import { Capacitor } from '@capacitor/core';
import { currentKey, fromB64, setUnlocked, toB64 } from '../db/crypto';
import { db } from '../db/db';
import type { Alert } from '../lib/alerts';

export const isNative = () => Capacitor.isNativePlatform();

const KEY_NAME = 'ledger-data-key';
const KEYRING_ID = 'native-biometric';

// ------------------------------------------------------------------ biometric unlock

export async function nativeBiometricAvailable(): Promise<boolean> {
  if (!isNative()) return false;
  const { BiometricAuth } = await import('@aparajita/capacitor-biometric-auth');
  const result = await BiometricAuth.checkBiometry();
  return result.isAvailable || result.deviceIsSecure;
}

export const nativeBiometricEnabled = async () => isNative() && !!(await db.keyring.get(KEYRING_ID));

async function authenticate(reason: string): Promise<void> {
  const { BiometricAuth } = await import('@aparajita/capacitor-biometric-auth');
  await BiometricAuth.authenticate({ reason, allowDeviceCredential: true, androidTitle: reason });
}

/** Stores the data key in the keychain, after confirming it is really the owner. Needs the app unlocked. */
export async function enableNativeBiometric(reason: string): Promise<void> {
  const key = currentKey();
  if (!key) throw new Error('locked');
  await authenticate(reason);
  const { SecureStorage, KeychainAccess } = await import('@aparajita/capacitor-secure-storage');
  // This device only, never in iCloud Keychain backups, and only while a passcode is set.
  await SecureStorage.set(KEY_NAME, toB64(key), false, false, KeychainAccess.whenPasscodeSetThisDeviceOnly);
  await db.keyring.put({ id: KEYRING_ID, kind: 'native', salt: '', wrapped: '', createdAt: Date.now() });
}

export async function unlockWithNativeBiometric(reason: string): Promise<boolean> {
  await authenticate(reason);
  const { SecureStorage } = await import('@aparajita/capacitor-secure-storage');
  const stored = await SecureStorage.get(KEY_NAME, false, false);
  if (typeof stored !== 'string') return false;
  setUnlocked(fromB64(stored));
  return true;
}

export async function disableNativeBiometric(): Promise<void> {
  await db.keyring.delete(KEYRING_ID);
  if (!isNative()) return;
  const { SecureStorage } = await import('@aparajita/capacitor-secure-storage');
  await SecureStorage.remove(KEY_NAME, false);
}

// ------------------------------------------------------------------ local notifications

/** Notification ids must be 32-bit integers; derive a stable one from the alert id. */
const numericId = (id: string) => {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (Math.imul(31, h) + id.charCodeAt(i)) | 0;
  return Math.abs(h) || 1;
};

export async function requestNativeNotifications(): Promise<boolean> {
  const { LocalNotifications } = await import('@capacitor/local-notifications');
  const { display } = await LocalNotifications.requestPermissions();
  return display === 'granted';
}

/** Replaces the device's scheduled reminders with these (future) alerts. */
export async function scheduleNative(alerts: Alert[]): Promise<void> {
  const { LocalNotifications } = await import('@capacitor/local-notifications');
  const pending = await LocalNotifications.getPending();
  if (pending.notifications.length) await LocalNotifications.cancel({ notifications: pending.notifications.map((n) => ({ id: n.id })) });
  const now = Date.now();
  const upcoming = alerts.filter((a) => a.at > now).slice(0, 60); // iOS keeps at most 64 pending
  if (!upcoming.length) return;
  await LocalNotifications.schedule({
    notifications: upcoming.map((a) => ({
      id: numericId(a.id),
      title: a.title,
      body: a.body,
      schedule: { at: new Date(a.at), allowWhileIdle: true },
      extra: { url: a.link },
    })),
  });
}

export async function showNativeNow(title: string, body: string, tag: string, url = '/notifications'): Promise<void> {
  const { LocalNotifications } = await import('@capacitor/local-notifications');
  await LocalNotifications.schedule({ notifications: [{ id: numericId(tag), title, body, extra: { url } }] });
}

/** Opens the right screen when a notification is tapped. */
export async function onNativeNotificationTap(open: (url: string) => void): Promise<() => void> {
  if (!isNative()) return () => {};
  const { LocalNotifications } = await import('@capacitor/local-notifications');
  const handle = await LocalNotifications.addListener('localNotificationActionPerformed', (e) => {
    const url = (e.notification.extra as { url?: string } | undefined)?.url;
    if (url) open(url);
  });
  return () => void handle.remove();
}
