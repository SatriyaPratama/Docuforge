'use client';

import { useEffect, useMemo, useState } from 'react';
import { saveAs } from 'file-saver';
import { useApp } from '@/context/AppContext';
import BlockList from '@/components/ui/BlockList';
import { deleteCorrectionSession } from '@/lib/correctionStore';
import { applyCorrections, applyMerges } from '@/lib/corrections';
import {
  exportCsv,
  exportExcel,
  exportHtml,
  exportMarkdown,
  buildExcelSheets,
  hasTableBlocks,
  type ExportScope,
  type ExcelPreviewSheet,
} from '@/lib/exportUtils';
import type { CorrectionPatch, ParsedBlock, ParsedPage } from '@/lib/types';

type OutputFormat = 'blocks' | 'excel' | 'json' | 'html' | 'markdown';
const FORMATS: OutputFormat[] = ['blocks', 'excel', 'json', 'html', 'markdown'];

function ExcelPreview({ sheets }: { sheets: ExcelPreviewSheet[] }) {
  const [sheetIndex, setSheetIndex] = useState(0);
  const activeIndex = Math.min(sheetIndex, Math.max(0, sheets.length - 1));
  const active = sheets[activeIndex];

  useEffect(() => setSheetIndex(0), [sheets]);

  if (!active) {
    return <p className="text-sm" style={{ color: 'var(--text-muted)' }}>No parsed pages to preview.</p>;
  }

  const previewRows = active.rows.slice(0, 250);
  const columnCount = Math.max(1, ...previewRows.map((row) => row.length));

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <p className="df-group-label">Excel preview</p>
          <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
            One worksheet is created for every parsed page. Tables stay as grids; other blocks use Type and Content columns.
          </p>
        </div>
        <span className="text-xs" style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
          {active.name} · {active.rows.length} rows
        </span>
      </div>

      <div className="flex gap-1 overflow-x-auto pb-1" role="tablist" aria-label="Excel worksheet preview">
        {sheets.map((sheet, index) => (
          <button
            key={sheet.name}
            type="button"
            role="tab"
            aria-selected={index === activeIndex}
            onClick={() => setSheetIndex(index)}
            className="df-subtab whitespace-nowrap"
            data-active={index === activeIndex}
            style={{ minHeight: 34 }}
          >
            {sheet.name}
          </button>
        ))}
      </div>

      {active.rows.length ? (
        <div className="overflow-auto rounded-lg" style={{ border: '1px solid var(--border)' }}>
          <table className="w-full text-xs" style={{ borderCollapse: 'collapse' }}>
            <tbody>
              {previewRows.map((row, rowIndex) => row.length ? (
                <tr key={`row-${rowIndex}`}>
                  {Array.from({ length: columnCount }, (_, columnIndex) => (
                    <td
                      key={`cell-${rowIndex}-${columnIndex}`}
                      className="px-3 py-2 align-top"
                      style={{
                        borderBottom: '1px solid var(--border)',
                        borderRight: columnIndex < columnCount - 1 ? '1px solid var(--border)' : undefined,
                        color: 'var(--text)',
                        fontWeight: rowIndex === 0 ? 600 : 400,
                        whiteSpace: 'pre-wrap',
                        minWidth: 120,
                      }}
                    >
                      {row[columnIndex] ?? ''}
                    </td>
                  ))}
                </tr>
              ) : (
                <tr key={`separator-${rowIndex}`} aria-hidden="true">
                  <td colSpan={columnCount} style={{ height: 8, background: 'var(--surface-elevated)' }} />
                </tr>
              ))}
            </tbody>
          </table>
          {active.rows.length > previewRows.length && (
            <p className="px-3 py-2 text-[11px]" style={{ color: 'var(--text-muted)', background: 'var(--surface-elevated)' }}>
              Preview shows the first 250 rows. The downloaded workbook contains all rows.
            </p>
          )}
        </div>
      ) : (
        <div className="rounded-lg px-4 py-5 text-sm" style={{ border: '1px dashed var(--border)', color: 'var(--text-muted)' }}>
          No extracted content on this page. The empty worksheet is still included in the workbook.
        </div>
      )}
    </div>
  );
}

export default function ResultsPanel() {
  const { state, dispatch } = useApp();
  const { pages, currentPage, file } = state;

  const [outputFormat, setOutputFormat] = useState<OutputFormat>('blocks');
  const [renderHtml, setRenderHtml] = useState(true);
  const [scope, setScope] = useState<ExportScope>('this-page');
  const [toast, setToast] = useState<string | null>(null);

  const page = pages[currentPage];
  const basePages = useMemo(() => applyMerges(pages, state.blockMerges), [pages, state.blockMerges]);
  const correctedPages = useMemo(() => applyCorrections(pages, state.corrections, state.blockMerges), [pages, state.corrections, state.blockMerges]);
  const correctedPage = correctedPages[currentPage];
  const fileStem = (file?.name || state.documentFilename || 'parsed-output').replace(/\.[^.]+$/, '');
  const canExportTables = hasTableBlocks(correctedPages, scope, currentPage);

  // Scope drives BOTH what is shown and what is exported.
  const scopedPages: ParsedPage[] = useMemo(
    () => (scope === 'all-pages' ? correctedPages : correctedPage ? [correctedPage] : []),
    [scope, correctedPages, correctedPage],
  );
  const excelSheets = useMemo(
    () => buildExcelSheets(correctedPages, scope, currentPage),
    [correctedPages, scope, currentPage],
  );
  const outputExcel = useMemo(
    () => excelSheets
      .map((sheet) => [`# ${sheet.name}`, ...sheet.rows.map((row) => row.join('\t'))].join('\n'))
      .join('\n\n'),
    [excelSheets],
  );

  const outputJson = useMemo(
    () => JSON.stringify(scope === 'all-pages' ? correctedPages : (correctedPage ?? {}), null, 2),
    [scope, correctedPages, correctedPage],
  );
  const outputHtml = useMemo(
    () => scopedPages.map((p) => p.blocks.map((b) => b.html).join('\n\n')).join('\n\n'),
    [scopedPages],
  );
  const outputMarkdown = useMemo(
    () => scopedPages.map((p) => p.blocks.map((b) => b.markdown).join('\n\n')).join('\n\n'),
    [scopedPages],
  );

  const flash = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 2000);
  };

  const currentText = () => {
    if (outputFormat === 'json') return outputJson;
    if (outputFormat === 'html') return outputHtml;
    if (outputFormat === 'excel') return outputExcel;
    return outputMarkdown; // "blocks" copies readable text
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(currentText());
      flash('Copied to clipboard');
    } catch {
      flash('Copy failed');
    }
  };

  const handleDownload = async () => {
    if (outputFormat === 'excel') {
      await exportExcel(correctedPages, fileStem, scope, currentPage);
      flash('Excel downloaded');
      return;
    }
    const ext = outputFormat === 'blocks' ? 'md' : outputFormat === 'json' ? 'json' : outputFormat;
    const mime =
      outputFormat === 'json'
        ? 'application/json'
        : outputFormat === 'html'
          ? 'text/html'
          : 'text/markdown';
    const suffix = scope === 'all-pages' ? 'all' : `p${currentPage + 1}`;
    saveAs(new Blob([currentText()], { type: `${mime};charset=utf-8` }), `${fileStem}-${suffix}.${ext}`);
    flash('Downloaded');
  };

  const handleExportCsv = () => {
    if (!canExportTables) return;
    exportCsv(correctedPages, fileStem, scope, currentPage);
    flash('CSV downloaded');
  };

  const handleExportXlsx = async () => {
    await exportExcel(correctedPages, fileStem, scope, currentPage);
    flash('Excel downloaded');
  };

  if (!pages.length) {
    return (
      <div className="flex-1 flex items-center justify-center px-6 text-center">
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
          No results yet. Configure options and parse a document to see extracted content here.
        </p>
      </div>
    );
  }

  const correctedCount = state.corrections.length + state.blockMerges.length;
  const isSaving = state.correctionPersistence === 'saving' || state.correctionPersistence === 'loading';
  const persistenceLabel = state.correctionPersistence === 'error'
    ? 'Local save unavailable'
    : isSaving
      ? state.correctionPersistence === 'loading' ? 'Loading local corrections…' : 'Saving locally…'
      : state.correctionPersistence === 'saved' && state.correctionLastSavedAt
        ? `Saved locally · ${new Date(state.correctionLastSavedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
        : 'No corrections yet';

  const submitPatches = (patches: CorrectionPatch[]) => dispatch({ type: 'UPSERT_CORRECTIONS', payload: patches });
  const handleCellsPaste = (pageIndex: number, block: ParsedBlock, rowIndex: number, columnIndex: number, values: string[][]) => {
    const rawPage = basePages.find((candidate) => candidate.pageIndex === pageIndex);
    const rawBlock = rawPage?.blocks.find((candidate) => candidate.id === block.id) ?? block;
    const patches: CorrectionPatch[] = [];
    for (let r = 0; r < values.length; r += 1) {
      for (let c = 0; c < values[r].length; c += 1) {
        const targetRow = rowIndex + r;
        const targetColumn = columnIndex + c;
        const originalValue = rawBlock.tableData?.[targetRow]?.[targetColumn] ?? '';
        patches.push({ pageIndex, blockId: block.id, target: 'table-cell', rowIndex: targetRow, columnIndex: targetColumn, originalValue, correctedValue: values[r][c] });
      }
    }
    submitPatches(patches);
  };

  const handleResetAll = () => {
    if ((state.corrections.length || state.blockMerges.length) && window.confirm('Reset all corrections and block merges for this document?')) dispatch({ type: 'RESET_ALL_CORRECTIONS' });
  };

  const handleDeleteLocalData = async () => {
    if (!state.documentHash || !window.confirm('Delete local correction data for this document?')) return;
    try {
      await deleteCorrectionSession(state.documentHash);
      dispatch({ type: 'DELETE_LOCAL_CORRECTION_DATA' });
      flash('Local correction data deleted');
    } catch {
      flash('Could not delete local correction data');
    }
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Output format sub-tabs + copy/download */}
      <div className="flex items-center gap-2 px-4 py-2.5 flex-shrink-0" style={{ borderBottom: '1px solid var(--border)' }}>
        <div className="flex items-center gap-1">
          {FORMATS.map((f) => (
            <button
              key={f}
              type="button"
              className="df-subtab"
              data-active={outputFormat === f}
              aria-selected={outputFormat === f}
              onClick={() => setOutputFormat(f)}
            >
              {f === 'blocks' ? 'Blocks' : f === 'excel' ? 'Excel' : f === 'json' ? 'JSON' : f === 'html' ? 'HTML' : 'Markdown'}
            </button>
          ))}
        </div>
        <div className="flex-1" />
        {outputFormat === 'blocks' && (
          <label
            className="flex items-center gap-1.5 text-xs mr-1"
            style={{ color: 'var(--text-muted)' }}
            title="Show formatted HTML (tables as grids, lists, headings). Uncheck to see the raw text."
          >
            <input type="checkbox" checked={renderHtml} onChange={(e) => setRenderHtml(e.target.checked)} className="h-3.5 w-3.5" />
            Render HTML
          </label>
        )}
        <button type="button" className="df-icon-btn" onClick={handleCopy} aria-label="Copy output" title="Copy">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <rect x="9" y="9" width="11" height="11" rx="2" stroke="currentColor" strokeWidth="1.6" />
            <path d="M5 15V5a2 2 0 0 1 2-2h10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </button>
        <button type="button" className="df-icon-btn" onClick={handleDownload} aria-label="Download output" title="Download">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M12 3v12m0 0 4-4m-4 4-4-4M5 21h14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>

      <div className="flex items-center gap-3 px-4 py-2 flex-shrink-0" style={{ borderBottom: '1px solid var(--border)', background: 'var(--white)' }}>
        <span className="text-xs font-medium" style={{ color: correctedCount ? 'var(--accent)' : 'var(--text-muted)' }}>
          {correctedCount ? `Corrected · ${correctedCount} edit${correctedCount === 1 ? '' : 's'}` : 'Original OCR'}
        </span>
        <span className="text-[11px]" style={{ color: state.correctionPersistence === 'error' ? 'var(--danger, #b42318)' : 'var(--text-muted)' }}>
          {persistenceLabel}{state.correctionStorageError ? ` · ${state.correctionStorageError}` : ''}
        </span>
        <div className="flex-1" />
        <button type="button" className="df-ghost-btn" style={{ padding: '5px 9px' }} onClick={() => dispatch({ type: 'UNDO_CORRECTION' })} disabled={!state.correctionHistory.length} title="Undo correction">Undo</button>
        <button type="button" className="df-ghost-btn" style={{ padding: '5px 9px' }} onClick={() => dispatch({ type: 'REDO_CORRECTION' })} disabled={!state.correctionFuture.length} title="Redo correction">Redo</button>
        <button type="button" className="df-ghost-btn" style={{ padding: '5px 9px' }} onClick={handleResetAll} disabled={!state.corrections.length && !state.blockMerges.length}>Reset all</button>
        <button type="button" className="df-ghost-btn" style={{ padding: '5px 9px' }} onClick={handleDeleteLocalData} disabled={!state.documentHash}>Delete local data</button>
      </div>

      {/* Scope + table exports */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 flex-shrink-0" style={{ borderBottom: '1px solid var(--border)', background: 'var(--surface-elevated)' }}>
        <div className="df-segmented" title="Choose whether the view and exports below cover the current page or the whole document">
          {(['this-page', 'all-pages'] as ExportScope[]).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setScope(s)}
              className="text-xs font-medium rounded-full px-3 py-1"
              style={{
                color: scope === s ? 'var(--text)' : 'var(--text-muted)',
                background: scope === s ? 'var(--white)' : 'transparent',
              }}
            >
              {s === 'this-page' ? 'This Page' : 'All Pages'}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleExportCsv}
            disabled={!canExportTables}
            className="df-ghost-btn"
            style={{ padding: '6px 12px' }}
            title={canExportTables ? 'Export detected tables as CSV' : 'Enabled once a table is detected in the selected pages'}
          >
            CSV
          </button>
          <button
            type="button"
            onClick={handleExportXlsx}
            disabled={!scopedPages.length}
            className="df-ghost-btn"
            style={{ padding: '6px 12px' }}
            title={scopedPages.length ? 'Export one Excel worksheet per parsed page' : 'Parse a page before exporting Excel'}
          >
            Excel
          </button>
          <button type="button" onClick={() => exportMarkdown(correctedPages, fileStem)} className="df-ghost-btn" style={{ padding: '6px 12px' }} title="Download the whole document as Markdown">MD</button>
          <button type="button" onClick={() => exportHtml(correctedPages, fileStem)} className="df-ghost-btn" style={{ padding: '6px 12px' }} title="Download the whole document as HTML">HTML</button>
        </div>
      </div>

      {!canExportTables && (
        <div className="px-4 py-2 text-xs flex-shrink-0" style={{ color: 'var(--text-muted)', borderBottom: '1px solid var(--border)' }}>
          CSV only exports detected tables. No table was detected in the
          {scope === 'all-pages' ? ' document' : ' current page'} — use Markdown or HTML for text content.
        </div>
      )}

      {/* Content — respects the This Page / All Pages scope */}
      <div className="flex-1 overflow-y-auto p-5">
        {scope === 'this-page' && !page ? (
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>This page was not parsed.</p>
        ) : outputFormat === 'blocks' ? (
          <div className="space-y-6">
            {scopedPages.map((p) => (
              <div key={p.pageIndex} className="space-y-3">
                {scope === 'all-pages' && (
                  <p className="df-group-label" style={{ position: 'sticky', top: 0 }}>Page {p.pageIndex + 1}</p>
                )}
                <BlockList
                  blocks={p.blocks}
                  pageIndex={p.pageIndex}
                  pagePosition={pages.findIndex((rawPage) => rawPage.pageIndex === p.pageIndex)}
                  renderHtml={renderHtml}
                  corrections={state.corrections}
                  blockMerges={state.blockMerges}
                  onCellChange={(patch) => submitPatches([patch])}
                  onCellsPaste={handleCellsPaste}
                  onBlockChange={(patch) => submitPatches([patch])}
                  onResetBlock={(blockPageIndex, blockId) => dispatch({ type: 'RESET_BLOCK_CORRECTIONS', payload: { pageIndex: blockPageIndex, blockId } })}
                  onMergePrevious={(blockPageIndex, blockId, previousBlockId) => dispatch({ type: 'MERGE_BLOCKS', payload: { pageIndex: blockPageIndex, firstBlockId: previousBlockId, secondBlockId: blockId } })}
                  onMergeNext={(blockPageIndex, blockId, nextBlockId) => dispatch({ type: 'MERGE_BLOCKS', payload: { pageIndex: blockPageIndex, firstBlockId: blockId, secondBlockId: nextBlockId } })}
                />
              </div>
            ))}
          </div>
        ) : outputFormat === 'excel' ? (
          <ExcelPreview sheets={excelSheets} />
        ) : (
          <pre className="text-xs whitespace-pre-wrap" style={{ fontFamily: 'var(--font-mono)', color: 'var(--text)' }}>
            {outputFormat === 'json' ? outputJson : outputFormat === 'html' ? outputHtml : outputMarkdown}
          </pre>
        )}
      </div>

      {toast && (
        <div role="status" aria-live="polite" className="fixed bottom-4 right-4 rounded-lg px-3 py-2 text-xs font-medium df-fade-in" style={{ background: 'var(--text)', color: '#fff', zIndex: 50 }}>
          {toast}
        </div>
      )}
    </div>
  );
}
