import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { seedIfEmpty } from './db/seed';
import './styles/tokens.css';
import './styles/app.css';

// Seed before the first render so screens never flash an empty state on first launch.
seedIfEmpty()
  .catch((err) => console.error('Could not create demo data', err))
  .finally(() => {
    createRoot(document.getElementById('root')!).render(
      <StrictMode>
        <ErrorBoundary>
          <App />
        </ErrorBoundary>
      </StrictMode>,
    );
  });
