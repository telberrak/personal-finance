import { useSyncExternalStore } from 'react';

/** Keep in step with the desktop @media block in app.css. */
export const DESKTOP_QUERY = '(min-width: 1024px)';

/** Whether a CSS media query matches, updated as it changes. */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      if (typeof window.matchMedia !== 'function') return () => {};
      const mql = window.matchMedia(query);
      mql.addEventListener('change', onChange);
      return () => mql.removeEventListener('change', onChange);
    },
    () => (typeof window.matchMedia === 'function' ? window.matchMedia(query).matches : false),
    () => false,
  );
}

/** True for the desktop web layout (sidebar, tables, multi-column pages). */
export const useIsDesktop = () => useMediaQuery(DESKTOP_QUERY);
