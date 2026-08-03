'use client';

import { useApp } from '@/context/AppContext';
import { useParse } from '@/lib/useParse';

export default function AppNotice() {
  const { state, dispatch } = useApp();
  const { parse, isParsing } = useParse();
  if (!state.error) return null;
  return (
    <div className="absolute left-3 right-3 top-3 z-50 mx-auto flex max-w-3xl items-center gap-3 rounded-xl border px-4 py-3 text-sm shadow-lg" role="alert" style={{ background: '#fff7f7', borderColor: '#f9c8c8', color: 'var(--danger)' }}>
      <span className="flex-1">{state.error}</span>
      {state.errorDetail?.retryable && state.file && <button type="button" className="df-ghost-btn" disabled={isParsing} onClick={() => { dispatch({ type: 'SET_ERROR', payload: null }); void parse(); }}>Retry</button>}
      <button type="button" className="df-ghost-btn" onClick={() => dispatch({ type: 'SET_ERROR', payload: null })}>Dismiss</button>
    </div>
  );
}
