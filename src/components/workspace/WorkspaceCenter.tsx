'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent, type KeyboardEvent } from 'react';
import { useApp } from '@/context/AppContext';
import { useParse } from '@/lib/useParse';
import { ACCEPT_ATTRIBUTE, MAX_FILE_LABEL, preValidateFile } from '@/lib/fileConstraints';
import BboxOverlay, { type BboxDetail, type BboxSelection } from '@/components/workspace/BboxOverlay';
import { selectCorrectedPage } from '@/lib/corrections';
import { useBatch } from '@/context/BatchContext';

interface PdfPage {
  getViewport: (params: { scale: number }) => { width: number; height: number };
  render: (ctx: { canvasContext: CanvasRenderingContext2D; viewport: { width: number; height: number } }) => { promise: Promise<void> };
}
interface PdfDocument {
  numPages: number;
  getPage: (pageNumber: number) => Promise<PdfPage>;
}
interface PdfModule {
  getDocument: (src: Uint8Array) => { promise: Promise<PdfDocument> };
  GlobalWorkerOptions?: { workerSrc: string };
}

function UploadView() {
  const { dispatch } = useApp();
  const { parse } = useParse();
  const { enqueue } = useBatch();
  const [dragging, setDragging] = useState(false);
  const [fileInput, setFileInput] = useState<HTMLInputElement | null>(null);
  const [loadingSample, setLoadingSample] = useState(false);

  const validateAndSet = useCallback(
    (f: File) => {
      const err = preValidateFile(f);
      if (err) {
        dispatch({ type: 'SET_ERROR', payload: err });
        return;
      }
      dispatch({ type: 'SET_ERROR', payload: null });
      dispatch({ type: 'SET_FILE', payload: f });
    },
    [dispatch],
  );

  const openExample = async () => {
    if (loadingSample) return;
    setLoadingSample(true);
    try {
      const res = await fetch('/samples/sample.pdf');
      if (!res.ok) throw new Error('Sample unavailable');
      const blob = await res.blob();
      const sample = new File([blob], 'sample-stock-table.pdf', { type: 'application/pdf' });
      dispatch({ type: 'SET_FILE', payload: sample });
      void parse(sample);
    } catch {
      dispatch({ type: 'SET_ERROR', payload: 'Could not load the example document.' });
    } finally {
      setLoadingSample(false);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto p-6 md:p-10 df-fade-in">
      <div className="max-w-2xl mx-auto space-y-8">
        <div className="space-y-1">
          <h1 className="text-xl font-bold" style={{ fontFamily: 'var(--font-heading)', color: 'var(--text)' }}>
            Convert a document
          </h1>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            Upload a PDF or image. DocuForge extracts text, tables and figures — export them as CSV, Excel, Markdown or HTML.
          </p>
        </div>

        <div
          role="button"
          tabIndex={0}
          aria-label="Upload a document"
          className="df-dropzone px-6 py-14 flex flex-col items-center text-center gap-3"
          data-drag={dragging}
          onClick={() => fileInput?.click()}
          onKeyDown={(e: KeyboardEvent) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              fileInput?.click();
            }
          }}
          onDragOver={(e: DragEvent) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e: DragEvent) => {
            e.preventDefault();
            setDragging(false);
            const files = Array.from(e.dataTransfer.files);
            if (files.length === 1) validateAndSet(files[0]);
            else if (files.length > 1) enqueue(files);
          }}
        >
          <div className="w-14 h-14 rounded-2xl flex items-center justify-center" style={{ background: 'color-mix(in srgb, var(--accent) 10%, #fff 90%)', color: 'var(--accent)' }}>
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M12 15V6m0 0-3 3m3-3 3 3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M6 14.5A3.5 3.5 0 0 0 6.5 21h11a3.5 3.5 0 0 0 .5-6.96A5.5 5.5 0 0 0 7.9 12.3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </div>
          <p className="text-base font-medium" style={{ color: 'var(--text)' }}>Drag a file here</p>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>or</p>
          <span className="df-primary-btn" style={{ background: 'var(--white)', color: 'var(--text)', border: '1px solid var(--border)' }}>
            Browse files
          </span>
          <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
            PDF, PNG, JPEG, WebP, TIFF · max {MAX_FILE_LABEL}
          </p>
        </div>

        <input
          ref={setFileInput}
          type="file"
          multiple
          accept={ACCEPT_ATTRIBUTE}
          className="hidden"
          onChange={(e: ChangeEvent<HTMLInputElement>) => {
            const files = Array.from(e.target.files ?? []);
            if (files.length === 1) validateAndSet(files[0]);
            else if (files.length > 1) enqueue(files);
            e.target.value = '';
          }}
        />

        <div className="space-y-3">
          <p className="df-side-label">Or open an example</p>
          <button type="button" className="df-example w-full flex items-center justify-between gap-4" onClick={openExample} disabled={loadingSample}>
            <div className="min-w-0">
              <p className="text-[10px] uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>Tables</p>
              <p className="text-sm font-semibold truncate" style={{ color: 'var(--text)' }}>Stock inventory table (PDF)</p>
              <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>Multi-column table extraction → CSV / Excel</p>
            </div>
            <span className="df-ghost-btn" style={{ flexShrink: 0, pointerEvents: 'none' }}>
              {loadingSample ? 'Loading…' : 'Convert →'}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}

function FileView() {
  const { state, dispatch } = useApp();
  const { file } = state;
  return (
    <div className="flex-1 flex items-center justify-center p-6 df-fade-in">
      <div className="text-center space-y-4">
        <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto" style={{ background: 'var(--white)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}>
          <svg width="30" height="30" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M7 3.75h7.75L20.25 9v11.25A1.75 1.75 0 0 1 18.5 22h-11A1.75 1.75 0 0 1 5.75 20.25V5.5A1.75 1.75 0 0 1 7.5 3.75Z" stroke="currentColor" strokeWidth="1.5" />
            <path d="M14.5 3.75V8a1 1 0 0 0 1 1h4.75" stroke="currentColor" strokeWidth="1.5" />
          </svg>
        </div>
        <div className="space-y-1">
          <p className="text-sm font-medium" style={{ color: 'var(--text)' }}>{file?.name}</p>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Parse this document to see results →</p>
        </div>
        <button type="button" className="df-ghost-btn" onClick={() => dispatch({ type: 'CLEAR_FILE' })}>
          Change Document
        </button>
      </div>
    </div>
  );
}

const PARSE_STEPS = [
  { stage: 'uploading', label: 'Uploading document' },
  { stage: 'planning', label: 'Preparing OCR plan' },
  { stage: 'parsing', label: 'Parsing document' },
  { stage: 'preparing-results', label: 'Preparing results' },
] as const;

function StepIcon({ done, active }: { done: boolean; active: boolean }) {
  if (done) {
    return (
      <span className="flex items-center justify-center rounded-full flex-shrink-0" style={{ width: 22, height: 22, background: 'var(--accent)', color: '#fff' }}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    );
  }
  if (active) {
    return <span className="df-spinner flex-shrink-0" style={{ width: 22, height: 22, borderWidth: 2.5 }} aria-hidden="true" />;
  }
  return <span className="rounded-full flex-shrink-0" style={{ width: 22, height: 22, border: '2px solid var(--border)' }} />;
}

function ParsingView() {
  const { state } = useApp();
  const { cancel } = useParse();
  const { parsingProgress, parsingDetail, parsingStage, file } = state;
  const activeIndex = Math.max(0, PARSE_STEPS.findIndex((step) => step.stage === parsingStage));
  const cancelling = parsingStage === 'cancelling';

  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-6 p-6 df-fade-in">
      <div className="w-full max-w-sm">
        {file && (
          <p className="text-sm text-center mb-6 truncate" style={{ color: 'var(--text-muted)' }}>{file.name}</p>
        )}
        <ol className="space-y-4">
          {PARSE_STEPS.map(({ stage, label }, i) => {
            const done = i < activeIndex;
            const active = i === activeIndex && !cancelling;
            return (
              <li key={label} className="flex items-center gap-3">
                <StepIcon done={done} active={active} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium" style={{ color: done || active ? 'var(--text)' : 'var(--text-muted)' }}>
                    {label}
                  </p>
                  {active && parsingDetail && (
                    <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{parsingDetail}</p>
                  )}
                </div>
                {active && (
                  <span className="text-xs tabular-nums" style={{ color: 'var(--text-muted)' }}>{parsingProgress}%</span>
                )}
              </li>
            );
          })}
        </ol>

        {activeIndex <= 2 && (
          <div className="w-full rounded-full overflow-hidden mt-6" style={{ height: 6, background: 'var(--border)' }}>
            <div
              className="h-full rounded-full"
              style={{
                width: `${parsingProgress}%`,
                background: 'var(--accent)',
                transition: 'width 300ms cubic-bezier(0.2, 0.85, 0.32, 1)',
              }}
            />
          </div>
        )}
      </div>

      <button type="button" className="df-ghost-btn" onClick={cancel} disabled={cancelling}>
        {cancelling ? 'Stopping after the current page…' : 'Cancel parsing'}
      </button>
    </div>
  );
}

function PdfThumb({ pdfDoc, pageNumber }: { pdfDoc: PdfDocument; pageNumber: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const pdfPage = await pdfDoc.getPage(pageNumber);
      if (cancelled) return;
      const viewport = pdfPage.getViewport({ scale: 0.22 });
      const canvas = ref.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      await pdfPage.render({ canvasContext: ctx, viewport }).promise;
    })().catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [pdfDoc, pageNumber]);
  return <canvas ref={ref} style={{ width: '100%', height: 'auto', display: 'block' }} />;
}

function PreviewView() {
  const { state, dispatch } = useApp();
  const { currentPage, file } = state;
  const currentCorrectedPage = useMemo(
    () => selectCorrectedPage(state.pages, currentPage, state.corrections, state.blockMerges),
    [state.pages, currentPage, state.corrections, state.blockMerges],
  );
  const isPdf = (file?.type || '').includes('pdf') || Boolean(file?.name.toLowerCase().endsWith('.pdf'));

  const [pdfDoc, setPdfDoc] = useState<PdfDocument | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [rendering, setRendering] = useState(false);
  const [showThumbs, setShowThumbs] = useState(false);
  const [showBbox, setShowBbox] = useState(true);
  const [bboxDetail, setBboxDetail] = useState<BboxDetail>('blocks');
  const [showConfidence, setShowConfidence] = useState(false);
  const [bboxMenu, setBboxMenu] = useState(false);
  const [selectedBbox, setSelectedBbox] = useState<BboxSelection | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const total = state.pages.length;
  const page = currentCorrectedPage;
  const docPageNum = (page?.pageIndex ?? 0) + 1;
  const hasBoxes = Boolean(page && (page.width ?? 0) > 0);

  const handleBboxSelect = useCallback((selection: BboxSelection) => {
    setSelectedBbox(selection);
    dispatch({ type: 'SET_SELECTED_BLOCK', payload: selection.blockRef });
  }, [dispatch]);

  const handleBboxHover = useCallback((blockRef: string | null) => {
    dispatch({ type: 'SET_HOVERED_BLOCK', payload: blockRef });
  }, [dispatch]);

  const clearBboxSelection = useCallback(() => {
    setSelectedBbox(null);
    dispatch({ type: 'SET_SELECTED_BLOCK', payload: null });
  }, [dispatch]);

  useEffect(() => {
    setSelectedBbox(null);
  }, [currentPage, bboxDetail, showBbox]);

  useEffect(() => {
    if (!file) return;
    if (!isPdf) {
      const url = URL.createObjectURL(file);
      setPreviewUrl(url);
      setPdfDoc(null);
      return () => URL.revokeObjectURL(url);
    }
    setPreviewUrl(null);
    let cancelled = false;
    (async () => {
      const buffer = await file.arrayBuffer();
      const pdfjs = (await import('pdfjs-dist')) as unknown as PdfModule;
      if (pdfjs.GlobalWorkerOptions) {
        pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();
      }
      const doc = await pdfjs.getDocument(new Uint8Array(buffer)).promise;
      if (!cancelled) setPdfDoc(doc);
    })().catch(() => {
      if (!cancelled) setPdfDoc(null);
    });
    return () => {
      cancelled = true;
    };
  }, [file, isPdf]);

  useEffect(() => {
    if (!pdfDoc || !isPdf) return;
    let cancelled = false;
    (async () => {
      setRendering(true);
      try {
        const pdfPage = await pdfDoc.getPage(Math.min(docPageNum, pdfDoc.numPages || 1));
        if (cancelled) return;
        const viewport = pdfPage.getViewport({ scale: 1.35 });
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        await pdfPage.render({ canvasContext: ctx, viewport }).promise;
      } finally {
        if (!cancelled) setRendering(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pdfDoc, docPageNum, isPdf]);

  const go = (delta: number) => {
    const next = currentPage + delta;
    if (next >= 0 && next < total) dispatch({ type: 'SET_CURRENT_PAGE', payload: next });
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 df-fade-in">
      {/* Toolbar */}
      <div className="flex items-center gap-3 px-4 flex-shrink-0" style={{ height: 'var(--topbar-h)', borderBottom: '1px solid var(--border)', background: 'var(--white)' }}>
        <button type="button" className="df-ghost-btn" style={{ padding: '6px 12px' }} disabled={currentPage <= 0 || rendering} onClick={() => go(-1)}>Prev</button>
        <span className="text-sm" style={{ color: 'var(--text)' }}>Page {currentPage + 1} / {total}</span>
        <button type="button" className="df-ghost-btn" style={{ padding: '6px 12px' }} disabled={currentPage >= total - 1 || rendering} onClick={() => go(1)}>Next</button>
        <div className="flex-1" />
        <button type="button" className="df-ghost-btn" style={{ padding: '6px 12px' }} onClick={() => setShowThumbs((v) => !v)}>
          {showThumbs ? 'Hide Thumbnails' : 'Show Thumbnails'}
        </button>
      </div>

      <div className="flex flex-1 min-h-0">
        {/* Thumbnails rail */}
        {showThumbs && (
          <div className="flex-shrink-0 overflow-y-auto p-3 space-y-2" style={{ width: 132, borderRight: '1px solid var(--border)', background: 'var(--surface-elevated)' }}>
            {state.pages.map((p, idx) => (
              <button
                key={p.pageIndex}
                type="button"
                className="df-thumb w-full"
                data-active={idx === currentPage}
                onClick={() => dispatch({ type: 'SET_CURRENT_PAGE', payload: idx })}
                aria-label={`Go to page ${idx + 1}`}
              >
                {isPdf && pdfDoc ? (
                  <PdfThumb pdfDoc={pdfDoc} pageNumber={p.pageIndex + 1} />
                ) : previewUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={previewUrl} alt={`Page ${idx + 1}`} style={{ width: '100%', display: 'block' }} />
                ) : (
                  <span className="block py-6 text-xs" style={{ color: 'var(--text-muted)' }}>{idx + 1}</span>
                )}
              </button>
            ))}
          </div>
        )}

        {/* Main preview shell keeps controls fixed while only the document scrolls. */}
        <div className="relative flex-1 min-w-0 min-h-0">
          <div data-testid="preview-scroll" className="h-full overflow-auto p-6 flex items-start justify-center">
            {isPdf ? (
              <div className="relative inline-block max-w-full">
                <canvas ref={canvasRef} style={{ display: 'block', border: '1px solid var(--border)', maxWidth: '100%', boxShadow: '0 8px 30px -18px rgba(0,0,0,0.4)' }} />
              {showBbox && page && (page.width ?? 0) > 0 && (
                <BboxOverlay
                  page={page}
                  detail={bboxDetail}
                  showConfidence={showConfidence}
                  selectedKey={selectedBbox?.key ?? null}
                  hoveredBlockRef={state.hoveredBlockRef}
                  selectedBlockRef={state.selectedBlockRef}
                  onSelect={handleBboxSelect}
                  onHover={handleBboxHover}
                />
              )}
              {rendering && (
                <div className="absolute inset-0 flex items-center justify-center" style={{ background: 'rgba(255,255,255,0.6)' }}>
                  <span className="df-spinner" aria-hidden="true" />
                </div>
              )}
              </div>
            ) : previewUrl ? (
              <div className="relative inline-block max-w-full">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={previewUrl} alt={file?.name || 'Document preview'} style={{ maxWidth: '100%', border: '1px solid var(--border)', boxShadow: '0 8px 30px -18px rgba(0,0,0,0.4)', display: 'block' }} />
              {showBbox && page && (page.width ?? 0) > 0 && (
                <BboxOverlay
                  page={page}
                  detail={bboxDetail}
                  showConfidence={showConfidence}
                  selectedKey={selectedBbox?.key ?? null}
                  hoveredBlockRef={state.hoveredBlockRef}
                  selectedBlockRef={state.selectedBlockRef}
                  onSelect={handleBboxSelect}
                  onHover={handleBboxHover}
                />
              )}
              </div>
            ) : (
              <p className="max-w-xs text-center text-sm" style={{ color: 'var(--text-muted)' }}>
                {file ? 'Loading preview…' : 'Source file is not loaded. Re-select the document to restore the visual preview and bounding boxes.'}
              </p>
            )}
          </div>

          {selectedBbox && showBbox && (
            <div
              className="absolute rounded-xl px-3 py-2 text-xs df-fade-in"
              style={{ right: 24, bottom: 24, maxWidth: 280, zIndex: 5, background: 'var(--white)', border: '1px solid var(--border)', boxShadow: '0 12px 34px -14px rgba(0,0,0,0.35)' }}
              role="status"
              aria-live="polite"
            >
              <div className="flex items-center justify-between gap-3 mb-1">
                <span className="df-side-label" style={{ color: selectedBbox.color }}>{selectedBbox.label}</span>
                <button type="button" className="text-xs" onClick={clearBboxSelection} aria-label="Clear selected bounding box">Clear</button>
              </div>
              <p className="truncate" title={selectedBbox.text || 'No text'} style={{ color: 'var(--text)' }}>{selectedBbox.text || 'No text'}</p>
              <p className="mt-1" style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: 10 }}>
                {selectedBbox.detail} · [{selectedBbox.bbox.map((n) => Math.round(n)).join(', ')}]
                {typeof selectedBbox.confidence === 'number' ? ` · ${Math.round(selectedBbox.confidence * 100)}%` : ''}
              </p>
            </div>
          )}

          {/* Floating bounding-box control */}
          {hasBoxes && (
            <div className="absolute" style={{ left: 24, bottom: 24, zIndex: 5 }}>
              {bboxMenu && (
                <div className="mb-2 rounded-xl p-3 space-y-3 df-fade-in" style={{ background: 'var(--white)', border: '1px solid var(--border)', boxShadow: '0 12px 34px -14px rgba(0,0,0,0.35)', width: 210 }}>
                  <label className="flex items-center justify-between gap-3 text-xs font-medium" style={{ color: 'var(--text)' }}>
                    <span>Show overlay</span>
                    <input type="checkbox" checked={showBbox} onChange={(e) => setShowBbox(e.target.checked)} />
                  </label>
                  <div>
                    <p className="df-side-label mb-1.5">Detail level</p>
                    <div className="df-segmented">
                      {(['blocks', 'items'] as BboxDetail[]).map((d) => (
                        <button
                          key={d}
                          type="button"
                          onClick={() => setBboxDetail(d)}
                          className="text-xs font-medium rounded-full px-3 py-1"
                          style={{ color: bboxDetail === d ? 'var(--text)' : 'var(--text-muted)', background: bboxDetail === d ? 'var(--white)' : 'transparent' }}
                        >
                          {d === 'blocks' ? 'Blocks' : 'Items'}
                        </button>
                      ))}
                    </div>
                  </div>
                  <label className="flex items-center justify-between gap-3 text-xs font-medium" style={{ color: 'var(--text)' }}>
                    <span>Confidence (red→green)</span>
                    <input type="checkbox" checked={showConfidence} onChange={(e) => setShowConfidence(e.target.checked)} />
                  </label>
                </div>
              )}
              <button
                type="button"
                className="df-ghost-btn flex items-center gap-2"
                onClick={() => setBboxMenu((m) => !m)}
                style={{ background: 'var(--white)' }}
                aria-expanded={bboxMenu}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <rect x="3" y="3" width="18" height="18" rx="2" stroke="currentColor" strokeWidth="1.6" strokeDasharray="3 2" />
                </svg>
                Bboxes{showBbox ? '' : ' (off)'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function WorkspaceCenter() {
  const { state } = useApp();
  const { screen, file, pages } = state;

  if (screen === 'parsing') return <ParsingView />;
  if (screen === 'results' && pages.length) return <PreviewView />;
  if (file) return <FileView />;
  return <UploadView />;
}
