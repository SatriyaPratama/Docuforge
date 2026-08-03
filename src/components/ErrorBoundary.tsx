'use client';

import { Component, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

/**
 * Top-level error boundary so a render failure (e.g. from unexpected OCR
 * output) shows a recoverable message instead of a blank screen.
 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: unknown) {
    console.error('Unhandled render error:', error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex-1 flex items-center justify-center p-8" style={{ background: 'var(--bg)' }}>
          <div className="df-card max-w-md px-6 py-8 text-center space-y-4">
            <h2 className="text-xl font-bold" style={{ fontFamily: 'var(--font-heading)', color: 'var(--text)' }}>
              Something went wrong
            </h2>
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
              The view failed to render. Your parsed data may still be intact.
            </p>
            <button
              type="button"
              onClick={() => this.setState({ hasError: false })}
              className="rounded-xl px-4 py-2.5 text-sm font-semibold"
              style={{ background: 'var(--cta-bg)', color: '#fff' }}
            >
              Try again
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
