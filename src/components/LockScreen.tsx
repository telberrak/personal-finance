import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { Settings } from '../db/types';
import { verifyPin } from '../lib/pin';

/**
 * Locked when a PIN is set: on start, and after the app has been in the background longer than
 * the chosen time.
 */
export function useAppLock(settings: Settings | undefined) {
  const hasPin = !!settings?.pinHash;
  // Decided once, when settings first load: setting a PIN mid-session must not lock you out there and then.
  const [locked, setLocked] = useState<boolean>();
  if (settings && locked === undefined) setLocked(hasPin);
  const hiddenAt = useRef<number | undefined>(undefined);
  const minutes = settings?.lockAfterMinutes ?? 5;

  useEffect(() => {
    if (!hasPin) return;
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') hiddenAt.current = Date.now();
      else if (hiddenAt.current !== undefined && Date.now() - hiddenAt.current >= minutes * 60_000) setLocked(true);
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [hasPin, minutes]);

  return { locked: hasPin && locked !== false, unlock: () => setLocked(false) };
}

export function LockScreen({ settings, onUnlock }: { settings: Settings; onUnlock: () => void }) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!settings.pinHash || !settings.pinSalt) return onUnlock();
    setChecking(true);
    const ok = await verifyPin(pin, settings.pinHash, settings.pinSalt);
    setChecking(false);
    if (ok) onUnlock();
    else {
      setError('That PIN is not right. Try again.');
      setPin('');
    }
  }

  return (
    <main className="welcome">
      <form className="welcome-card stack" style={{ gap: 20, maxWidth: 360 }} onSubmit={submit}>
        <img src="/icon.svg" alt="" width={56} height={56} style={{ borderRadius: 14 }} />
        <div className="stack" style={{ gap: 6 }}>
          <h1 className="screen-title">Ledger is locked</h1>
          <p className="label">Enter your PIN to open the app.</p>
        </div>
        <label className="stack" style={{ gap: 6 }}>
          <span className="visually-hidden">PIN</span>
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
          Unlock
        </button>
        <p className="small muted">
          Forgot your PIN? Clear this site’s data in your browser settings to start again (restore a backup afterwards).
        </p>
      </form>
    </main>
  );
}
