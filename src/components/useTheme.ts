import { useEffect } from 'react';
import type { ThemePreference } from '../db/types';

/** Applies the saved theme preference to <html>; "system" defers to prefers-color-scheme in tokens.css. */
export function useTheme(pref: ThemePreference | undefined) {
  useEffect(() => {
    const root = document.documentElement;
    if (!pref || pref === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', pref);

    // Keep the browser/OS chrome colour in step with the chosen theme.
    const bg = getComputedStyle(root).getPropertyValue('--bg').trim();
    document.querySelectorAll('meta[name="theme-color"]').forEach((m) => {
      if (pref && pref !== 'system') m.setAttribute('content', bg);
      else m.setAttribute('content', m.getAttribute('media')?.includes('dark') ? '#0D0F12' : '#F4F5F2');
    });
  }, [pref]);
}
