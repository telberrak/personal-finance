import { useRegisterSW } from 'virtual:pwa-register/react';

/** Tells the user when a new version has been downloaded, instead of swapping it in mid-use. */
export function UpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      // Check for a new version every hour while the app stays open.
      if (registration) setInterval(() => void registration.update(), 60 * 60 * 1000);
    },
  });

  if (!needRefresh) return null;
  return (
    <div className="update-banner" role="status">
      <span className="grow">A new version of Ledger is ready.</span>
      <button type="button" className="toast-action" onClick={() => setNeedRefresh(false)}>
        Later
      </button>
      <button type="button" className="toast-action toast-action--primary" onClick={() => void updateServiceWorker(true)}>
        Update
      </button>
    </div>
  );
}
