'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '@/context/AppContext';
import { applyCorrections } from '@/lib/corrections';
import { searchDocument, searchSnippet } from '@/lib/documentSearch';

export default function SearchDialog() {
  const { state, dispatch } = useApp();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const pages = useMemo(() => applyCorrections(state.pages, state.corrections, state.blockMerges), [state.pages, state.corrections, state.blockMerges]);
  const results = useMemo(() => searchDocument(pages, query), [pages, query]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f' && state.pages.length) {
        event.preventDefault();
        setOpen(true);
      }
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    const onOpen = () => state.pages.length && setOpen(true);
    window.addEventListener('docuforge:open-search', onOpen);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('docuforge:open-search', onOpen);
    };
  }, [state.pages.length]);

  useEffect(() => { if (open) window.setTimeout(() => inputRef.current?.focus(), 0); }, [open]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 flex items-start justify-center p-4" style={{ zIndex: 80, background: 'rgba(15, 23, 42, 0.35)' }} role="dialog" aria-modal="true" aria-label="Search document" onMouseDown={() => setOpen(false)}>
      <div className="mt-16 w-full max-w-xl rounded-xl border bg-white shadow-xl" style={{ borderColor: 'var(--border)' }} onMouseDown={(event) => event.stopPropagation()}>
        <div className="border-b p-3" style={{ borderColor: 'var(--border)' }}>
          <input ref={inputRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search extracted text…" className="df-field" aria-label="Search extracted text" />
        </div>
        <div className="max-h-96 overflow-y-auto p-2">
          {query && !results.length && <p className="p-3 text-sm" style={{ color: 'var(--text-muted)' }}>No matching OCR content.</p>}
          {results.map((result) => (
            <button key={result.blockRef} type="button" className="block w-full rounded-lg p-3 text-left hover:bg-slate-50" onClick={() => {
              const position = state.pages.findIndex((page) => page.pageIndex === result.pageIndex);
              if (position >= 0) dispatch({ type: 'SET_CURRENT_PAGE', payload: position });
              dispatch({ type: 'SET_SELECTED_BLOCK', payload: result.blockRef });
              setOpen(false);
            }}>
              <span className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>Page {result.pageIndex + 1} · {result.blockType}</span>
              <span className="mt-1 block text-sm" style={{ color: 'var(--text)' }}>{searchSnippet(result, query.trim().length)}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
