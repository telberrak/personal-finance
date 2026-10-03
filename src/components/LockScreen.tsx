import { useEffect, useState, type FormEvent } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import { lockNow, unlockWithPasskey, unlockWithPin, useSecurityMode } from '../db/security';
import { DEFAULT_SETTINGS } from '../db/types';
import { applyLocale, t } from '../i18n';
import { Icon } from './Icon';
import { useTheme } from './useTheme';

const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const;

/**
 * Locks again after `minutes` in the background (0: as soon as the app is hidden), or after the
 * same time without any taps or key presses (at least one minute).
 */
export function useAutoLock(minutes: number | undefined) {
  const active = useSecurityMode() === 'unlocked';
  useEffect(() => {
    if (!active || minutes === undefined) return;
    let lastActive = Date.now();
    let hiddenAt: number | undefined;
    const idleLimit = Math.max(minutes, 1) * 60_000;
    const onActivity = () => (lastActive = Date.now());
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        hiddenAt = Date.now();
        if (minutes === 0) lockNow();
      } else if (hiddenAt !== undefined && Date.now() - hiddenAt >= minutes * 60_000) lockNow();
      else lastActive = Date.now();
    };
    const timer = window.setInterval(() => {
      if (Date.now() - lastActive >= idleLimit) lockNow();
    }, 10_000);
    ACTIVITY_EVENTS.forEach((e) => window.addEventListener(e, onActivity, { passive: true, capture: true }));
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.clearInterval(timer);
      ACTIVITY_EVENTS.forEach((e) => window.removeEventListener(e, onActivity, { capture: true }));
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [active, minutes]);
}

export function LockScreen() {
  // Only the settings the lock screen needs (theme, language) are readable while locked.
  const stored = useLiveQuery(async () => (await db.settings.get('app')) ?? null);
  const hasPasskey = useLiveQuery(async () => (await db.keyring.toArray()).some((k) => k.kind === 'passkey'), [], false);
  const settings = { ...DEFAULT_SETTINGS, ...stored };
  if (stored !== undefined) applyLocale(settings.language, settings.currency);
  useTheme(settings.theme);

  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setChecking(true);
    const ok = await unlockWithPin(pin).catch(() => false);
    setChecking(false);
    if (!ok) {
      setError(t('lock.wrongPin'));
      setPin('');
    }
  }

  async function passkey() {
    setError('');
    try {
      await unlockWithPasskey();
    } catch (err) {
      // Cancelling the browser prompt is not an error worth showing.
      if (!(err instanceof DOMException && err.name === 'NotAllowedError')) setError(err instanceof Error ? err.message : String(err));
    }
  }

  if (stored === undefined) return null;

  return (
    <main className="welcome">
      <form className="welcome-card stack" style={{ gap: 20, maxWidth: 360 }} onSubmit={submit}>
        <img src="/icon.svg" alt="" width={56} height={56} style={{ borderRadius: 14 }} />
        <div className="stack" style={{ gap: 6 }}>
          <h1 className="screen-title">{t('lock.title')}</h1>
          <p className="label">{t('lock.intro')}</p>
        </div>
        <label className="stack" style={{ gap: 6 }}>
          <span className="visually-hidden">{t('lock.pin')}</span>
          <input
            className="pin-input"
            type="password"
            inputMode="numeric"
            autoComplete="current-password"
            maxLength={8}
            autoFocus
            value={pin}
            aria-invalid={!!error}
            aria-describedby={error ? 'pin-error' : undefined}
            onChange={(e) => {
              setPin(e.target.value.replace(/\D/g, ''));
              setError('');
            }}
          />
        </label>
        {error && (
          <p id="pin-error" className="text-warn small" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="btn btn--primary" disabled={pin.length < 4 || checking}>
          {t('lock.unlock')}
        </button>
        {hasPasskey && (
          <button type="button" className="btn" onClick={passkey}>
            <Icon name="lock" size={18} />
            {t('lock.usePasskey')}
          </button>
        )}
        <p className="small muted">{t('lock.forgot')}</p>
      </form>
    </main>
  );
}
