import { Component, type ErrorInfo, type ReactNode } from 'react';

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
    console.error('Ledger crashed', error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <main className="screen screen--modal" role="alert">
        <h1 className="screen-title">Something went wrong</h1>
        <p className="label">Your data is safe on this device. Reloading usually fixes this.</p>
        <button type="button" className="btn btn--primary" onClick={() => location.reload()}>
          Reload Ledger
        </button>
        <details className="small muted">
          <summary>Technical details</summary>
          <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{error.stack ?? error.message}</pre>
        </details>
      </main>
    );
  }
}
