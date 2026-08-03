'use client';

import { useEffect, useState } from 'react';
import { useApp } from '@/context/AppContext';
import { useParse } from '@/lib/useParse';
import { backendLabel, getOcrInfo, type OcrInfo } from '@/lib/ocrInfo';
import { countPdfPages } from '@/lib/pdfPages';

function Toggle({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className="df-toggle"
        data-checked={checked}
        style={{ marginTop: 2 }}
      />
      <div className="space-y-0.5 min-w-0">
        <p className="text-sm font-medium" style={{ color: 'var(--text)' }}>{label}</p>
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{hint}</p>
      </div>
    </div>
  );
}

export default function ConfigurationPanel() {
  const { state, dispatch } = useApp();
  const { config, file, error, docPageCount } = state;
  const { parse, isParsing } = useParse();

  const [ocrInfo, setOcrInfo] = useState<OcrInfo | null>(null);

  // Backend capabilities (mode + chunk sizing) — fetched once, cached.
  useEffect(() => {
    let alive = true;
    getOcrInfo().then((i) => {
      if (alive) setOcrInfo(i);
    });
    return () => {
      alive = false;
    };
  }, []);

  // Count pages of the selected document so we can preview chunk handling.
  useEffect(() => {
    if (!file) return;
    let alive = true;
    countPdfPages(file).then((n) => {
      if (alive) dispatch({ type: 'SET_DOC_PAGE_COUNT', payload: n });
    });
    return () => {
      alive = false;
    };
  }, [file, dispatch]);

  const chunkSize = ocrInfo?.chunkSize ?? 25;
  const willChunk = docPageCount != null && docPageCount > chunkSize;
  const chunkCount = docPageCount != null ? Math.ceil(docPageCount / chunkSize) : 0;

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
        {error && (
          <div
            className="rounded-xl px-4 py-3 text-sm df-fade-in"
            style={{ background: '#fef1f1', color: 'var(--danger)', border: '1px solid #f9c8c8' }}
            role="alert"
          >
            <div className="flex items-start gap-2">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true" style={{ flexShrink: 0, marginTop: 1 }}>
                <path d="M12 8v4m0 4h.01M10.56 3.86l-7.1 12.2A2 2 0 0 0 5.2 19h13.6a2 2 0 0 0 1.74-2.94l-7.1-12.2a2 2 0 0 0-3.46 0Z" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
              </svg>
              <span>{error}</span>
            </div>
          </div>
        )}

        {/* Page selection */}
        <section className="space-y-2">
          <label htmlFor="page-range" className="df-group-label">Page range</label>
          <input
            id="page-range"
            type="text"
            inputMode="numeric"
            placeholder="e.g. 0-9  (leave blank for all pages)"
            value={config.pageRange}
            onChange={(e) => dispatch({ type: 'SET_CONFIG', payload: { pageRange: e.target.value } })}
            disabled={isParsing}
            className="df-field"
          />
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            Zero-indexed. A single page (<code>3</code>) or a range (<code>0-9</code>).
            Leave blank for the whole document — large files are split into chunks automatically.
          </p>
          {docPageCount != null && (
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              Document has <strong>{docPageCount}</strong> page{docPageCount === 1 ? '' : 's'}.
            </p>
          )}
        </section>

        {willChunk && (
          <div
            className="rounded-xl px-4 py-3 text-xs df-fade-in"
            style={{
              background: 'color-mix(in srgb, var(--accent) 7%, #fff 93%)',
              border: '1px solid color-mix(in srgb, var(--accent) 25%, var(--border))',
              color: 'var(--text)',
            }}
          >
            <p className="font-medium mb-0.5">Large document</p>
            <p style={{ color: 'var(--text-muted)' }}>
              This {docPageCount}-page document will be processed in {chunkCount} chunks of up to{' '}
              {chunkSize} pages{ocrInfo && ocrInfo.concurrency > 1 ? ` (${ocrInfo.concurrency} in parallel)` : ''}, then
              merged in order. Progress is shown while it runs.
            </p>
          </div>
        )}

        {/* Output setup */}
        <section className="df-group space-y-4">
          <div className="flex items-center justify-between">
            <span className="df-group-label">Output setup</span>
            <span className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Structure</span>
          </div>
          <Toggle
            checked={config.additional.keepHeader}
            onChange={(v) => !isParsing && dispatch({ type: 'SET_ADDITIONAL_CONFIG', payload: { keepHeader: v } })}
            label="Keep page headers"
            hint="Retain detected page-header blocks in the output."
          />
          <Toggle
            checked={config.additional.keepFooter}
            onChange={(v) => !isParsing && dispatch({ type: 'SET_ADDITIONAL_CONFIG', payload: { keepFooter: v } })}
            label="Keep page footers"
            hint="Retain detected page-footer blocks in the output."
          />
        </section>

        {/* Cache */}
        <section className="df-group">
          <Toggle
            checked={config.additional.skipCache}
            onChange={(v) => !isParsing && dispatch({ type: 'SET_ADDITIONAL_CONFIG', payload: { skipCache: v } })}
            label="Skip cache"
            hint="Re-run OCR even if an identical document was parsed before."
          />
        </section>
      </div>

      {/* Sticky footer: summary + parse */}
      <div className="flex-shrink-0 px-6 py-4 flex items-center justify-between gap-4" style={{ borderTop: '1px solid var(--border)', background: 'var(--surface-elevated)' }}>
        <div className="min-w-0">
          <p className="text-xs font-medium" style={{ color: 'var(--text)' }}>
            Surya OCR 2{ocrInfo ? ` · ${backendLabel(ocrInfo)}` : ''}
          </p>
          <p className="text-[11px] truncate" style={{ color: 'var(--text-muted)' }}>
            {file ? `${file.name} · ${(file.size / 1024 / 1024).toFixed(2)} MB` : 'No document selected'}
          </p>
        </div>
        <button
          type="button"
          id="parse-btn"
          onClick={() => parse()}
          disabled={!file || isParsing}
          className="df-primary-btn"
          style={{ flexShrink: 0 }}
        >
          {isParsing ? (
            <>
              <span className="df-mini-spinner" aria-hidden="true" />
              Parsing…
            </>
          ) : (
            'Parse Document'
          )}
        </button>
      </div>
    </div>
  );
}
