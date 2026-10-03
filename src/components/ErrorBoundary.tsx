import { Component, type ErrorInfo, type ReactNode } from 'react';
import { t } from '../i18n';

interface State {
  error?: Error;
}

/** Catches render errors anywhere below it and shows a recovery screen instead of a blank page. */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = {};

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Mizan crashed', error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <main className="screen screen--modal" role="alert">
        <h1 className="screen-title">{t('error.title')}</h1>
        <p className="label">{t('error.body')}</p>
        <button type="button" className="btn btn--primary" onClick={() => location.reload()}>
          {t('error.reload')}
        </button>
        <details className="small muted">
          <summary>{t('error.details')}</summary>
          <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{error.stack ?? error.message}</pre>
        </details>
      </main>
    );
  }
}
