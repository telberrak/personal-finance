import './i18n'; // initialise translations before any module renders text
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { refreshContact } from './brand';
import { ErrorBoundary } from './components/ErrorBoundary';
import { UpdatePrompt } from './components/UpdatePrompt';
import { initSecurity } from './db/security';
import '@fontsource-variable/geist'; // bundled, so no request leaves the app (see security-headers.ts)
import './styles/tokens.css';
import './styles/app.css';

// The support address and operator name shown in help and legal pages (server settings).
void refreshContact();

// Ask the browser not to evict our data under storage pressure (best effort; installed apps usually get it).
void navigator.storage?.persist?.();

// Find out whether the data is encrypted (and so starts locked) before showing anything.
void initSecurity()
  .catch((err) => console.error(err))
  .finally(() =>
    createRoot(document.getElementById('root')!).render(
      <StrictMode>
        <ErrorBoundary>
          <App />
          <UpdatePrompt />
        </ErrorBoundary>
      </StrictMode>,
    ),
  );
