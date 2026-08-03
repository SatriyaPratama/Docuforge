'use client';

import { useApp } from '@/context/AppContext';

export default function Topbar() {
  const { state, dispatch } = useApp();
  const hasFile = Boolean(state.file);

  return (
    <header className="df-topbar">
      <span className="text-sm font-medium" style={{ color: 'var(--text-muted)' }}>
        Forge Playground
      </span>

      <span className="df-workflow-chip">
        CONVERT
        <button
          type="button"
          onClick={() => dispatch({ type: 'CLEAR_FILE' })}
          disabled={!hasFile}
          className="df-icon-btn"
          aria-label="Reset conversion"
          style={{ width: 20, height: 20, border: 'none', background: 'transparent', opacity: hasFile ? 1 : 0.4 }}
        >
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M3.5 3.5l9 9m0-9-9 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      </span>

      {/* Center: current document name */}
      <div className="flex-1 flex items-center justify-center min-w-0">
        {hasFile && (
          <span className="text-sm truncate max-w-full" style={{ color: 'var(--text-muted)' }}>
            {state.file?.name}
          </span>
        )}
      </div>

      {/* Right: reset action (replaces auth) */}
      <button
        type="button"
        onClick={() => window.dispatchEvent(new Event('docuforge:open-search'))}
        disabled={!state.pages.length}
        className="df-ghost-btn"
        title="Search document (Ctrl/Cmd+F)"
      >
        Search
      </button>
      <button
        type="button"
        onClick={() => dispatch({ type: 'CLEAR_FILE' })}
        disabled={!hasFile}
        className="df-ghost-btn"
      >
        New File
      </button>
    </header>
  );
}
