'use client';

import { useEffect, useMemo, useState } from 'react';
import DOMPurify from 'dompurify';
import { useApp } from '@/context/AppContext';
import { blockTypeColor } from '@/lib/blockColors';
import { makeBlockRef } from '@/lib/blockRefs';
import { applyMerges } from '@/lib/corrections';
import type { BlockMerge, CorrectionPatch, ParsedBlock } from '@/lib/types';

const SANITIZE_CONFIG = {
  ALLOWED_TAGS: [
    'p', 'br', 'b', 'i', 'u', 'em', 'strong', 'small', 'big', 'del', 'sup', 'sub',
    'table', 'thead', 'tbody', 'tr', 'td', 'th', 'caption',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'ul', 'ol', 'li', 'pre', 'code', 'span', 'div', 'hr', 'a', 'img', 'figure', 'figcaption',
  ],
  ALLOWED_ATTR: ['colspan', 'rowspan', 'href', 'alt', 'data-bbox', 'data-label', 'data-confidence'],
  ALLOW_DATA_ATTR: false,
};

function sanitize(html: string): string {
  if (typeof window === 'undefined') return '';
  return DOMPurify.sanitize(html, SANITIZE_CONFIG);
}

function readablePreview(block: ParsedBlock): string {
  return (block.markdown || block.html).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 140);
}

interface Props {
  blocks: ParsedBlock[];
  pageIndex?: number;
  pagePosition?: number;
  renderHtml?: boolean;
  corrections?: CorrectionPatch[];
  blockMerges?: BlockMerge[];
  onCellChange?: (patch: CorrectionPatch) => void;
  onCellsPaste?: (pageIndex: number, block: ParsedBlock, rowIndex: number, columnIndex: number, values: string[][]) => void;
  onBlockChange?: (patch: CorrectionPatch) => void;
  onResetBlock?: (pageIndex: number, blockId: string) => void;
  onMergePrevious?: (pageIndex: number, blockId: string, previousBlockId: string) => void;
  onMergeNext?: (pageIndex: number, blockId: string, nextBlockId: string) => void;
}

export default function BlockList({ blocks, pageIndex = 0, pagePosition, renderHtml = true, corrections = [], blockMerges = [], onCellChange, onCellsPaste, onBlockChange, onResetBlock, onMergePrevious, onMergeNext }: Props) {
  const { state, dispatch } = useApp();
  const basePages = useMemo(() => applyMerges(state.pages, blockMerges), [state.pages, blockMerges]);

  if (!blocks.length) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm" style={{ color: 'var(--text-muted)' }}>
        No blocks on this page.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {blocks.map((block, index) => {
        const blockRef = makeBlockRef(pageIndex, block.id);
        const originalPage = basePages.find((candidate) => candidate.pageIndex === pageIndex);
        const originalBlock = originalPage?.blocks.find((candidate) => candidate.id === block.id) ?? block;
        const blockIsCorrected = corrections.some((patch) => patch.pageIndex === pageIndex && patch.blockId === block.id);
        const blockIsMerged = blockMerges.some((merge) => merge.pageIndex === pageIndex && merge.blockIds.includes(block.id));
        return (
          <BlockCard
            key={block.id}
            block={block}
            blockRef={blockRef}
            renderHtml={renderHtml}
            isHovered={state.hoveredBlockRef === blockRef}
            isSelected={state.selectedBlockRef === blockRef}
            isCorrected={blockIsCorrected}
            isMerged={blockIsMerged}
            originalBlock={originalBlock}
            pageIndex={pageIndex}
            onCellChange={onCellChange}
            onCellsPaste={onCellsPaste}
            onBlockChange={onBlockChange}
            onResetBlock={onResetBlock}
            onMergePrevious={index > 0 ? () => onMergePrevious?.(pageIndex, block.id, blocks[index - 1].id) : undefined}
            onMergeNext={index < blocks.length - 1 ? () => onMergeNext?.(pageIndex, block.id, blocks[index + 1].id) : undefined}
            onHover={(ref) => dispatch({ type: 'SET_HOVERED_BLOCK', payload: ref })}
            onSelect={() => {
              if (pagePosition != null && pagePosition !== state.currentPage) {
                dispatch({ type: 'SET_CURRENT_PAGE', payload: pagePosition });
              }
              dispatch({ type: 'SET_SELECTED_BLOCK', payload: blockRef });
            }}
          />
        );
      })}
    </div>
  );
}

function BlockCard({
  block,
  blockRef,
  renderHtml,
  isHovered,
  isSelected,
  isCorrected,
  isMerged,
  originalBlock,
  pageIndex,
  onCellChange,
  onCellsPaste,
  onBlockChange,
  onResetBlock,
  onMergePrevious,
  onMergeNext,
  onHover,
  onSelect,
}: {
  block: ParsedBlock;
  blockRef: string;
  renderHtml: boolean;
  isHovered: boolean;
  isSelected: boolean;
  isCorrected: boolean;
  isMerged: boolean;
  originalBlock: ParsedBlock;
  pageIndex: number;
  onCellChange?: (patch: CorrectionPatch) => void;
  onCellsPaste?: (pageIndex: number, block: ParsedBlock, rowIndex: number, columnIndex: number, values: string[][]) => void;
  onBlockChange?: (patch: CorrectionPatch) => void;
  onResetBlock?: (pageIndex: number, blockId: string) => void;
  onMergePrevious?: () => void;
  onMergeNext?: () => void;
  onHover: (ref: string | null) => void;
  onSelect: () => void;
}) {
  const borderColor = blockTypeColor(block.type);
  const labelColor = borderColor;

  const softTint = `color-mix(in srgb, ${borderColor} 5%, #fff 95%)`;
  const hoverTint = `color-mix(in srgb, ${borderColor} 9%, #fff 91%)`;
  const selectedTint = `color-mix(in srgb, ${borderColor} 14%, #fff 86%)`;
  const label = `${block.type} result block${readablePreview(block) ? `: ${readablePreview(block)}` : ''}`;
  const [editingText, setEditingText] = useState(false);
  const [draftText, setDraftText] = useState(block.markdown);

  useEffect(() => {
    if (!editingText) setDraftText(block.markdown);
  }, [block.markdown, editingText]);

  const commitText = () => {
    setEditingText(false);
    if (draftText === originalBlock.markdown || !onBlockChange) return;
    onBlockChange({
      pageIndex,
      blockId: block.id,
      target: 'block',
      originalValue: originalBlock.markdown,
      correctedValue: draftText,
    });
  };

  return (
    <div
      className="rounded-xl border px-4 py-3"
      role="button"
      tabIndex={0}
      aria-label={label}
      aria-pressed={isSelected}
      data-block-ref={blockRef}
      data-hovered={isHovered || undefined}
      data-selected={isSelected || undefined}
      style={{
        borderColor: 'var(--border)',
        borderLeft: `3px solid ${borderColor}`,
        background: isSelected ? selectedTint : isHovered ? hoverTint : softTint,
        boxShadow: isSelected ? `0 0 0 2px color-mix(in srgb, ${borderColor} 35%, transparent)` : 'none',
        transition: 'background-color 180ms ease, box-shadow 180ms ease',
        cursor: 'pointer',
      }}
      onMouseEnter={() => onHover(blockRef)}
      onMouseLeave={() => onHover(null)}
      onFocus={() => onHover(blockRef)}
      onBlur={() => onHover(null)}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect();
        }
      }}
    >
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <span
            className="inline-flex items-center rounded-full px-2.5 py-1 text-[10px] uppercase tracking-wide"
            style={{
              background: `color-mix(in srgb, ${labelColor} 18%, #fff 82%)`,
              color: labelColor,
              fontFamily: 'var(--font-heading)',
            }}
          >
            {block.type}
          </span>
          {typeof block.confidence === 'number' && (
            <span className="text-[10px]" style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }} title="Mean OCR confidence for this block">
              {Math.round(block.confidence * 100)}% conf
            </span>
          )}
          {isCorrected && <span className="text-[10px] font-medium" style={{ color: 'var(--accent)' }}>Corrected</span>}
          {isMerged && <span className="text-[10px] font-medium" style={{ color: 'var(--text-muted)' }}>Merged</span>}
          <span className="flex-1" />
          {block.type !== 'Table' && onBlockChange && (
            <button
              type="button"
              className="df-icon-btn"
              style={{ width: 26, height: 26 }}
              aria-label={editingText ? 'Cancel text edit' : 'Edit text block'}
              title={editingText ? 'Cancel' : 'Edit text'}
              onClick={(event) => { event.stopPropagation(); setEditingText((value) => !value); }}
            >
              {editingText ? '×' : '✎'}
            </button>
          )}
          {onMergePrevious && (
            <button type="button" className="df-ghost-btn" style={{ padding: '4px 7px', fontSize: 10 }} aria-label="Merge with previous block" title="Merge with previous block" onClick={(event) => { event.stopPropagation(); onMergePrevious(); }}>Merge prev</button>
          )}
          {onMergeNext && (
            <button type="button" className="df-ghost-btn" style={{ padding: '4px 7px', fontSize: 10 }} aria-label="Merge with next block" title="Merge with next block" onClick={(event) => { event.stopPropagation(); onMergeNext(); }}>Merge next</button>
          )}
          {(isCorrected || isMerged) && onResetBlock && (
            <button
              type="button"
              className="df-icon-btn"
              style={{ width: 26, height: 26 }}
              aria-label="Reset corrections for block"
              title="Reset block"
              onClick={(event) => { event.stopPropagation(); onResetBlock(pageIndex, block.id); }}
            >↶</button>
          )}
        </div>

        {editingText ? (
          <div className="space-y-2" onClick={(event) => event.stopPropagation()}>
            <textarea
              value={draftText}
              onChange={(event) => setDraftText(event.target.value)}
              className="w-full rounded-lg px-3 py-2 text-sm"
              rows={Math.min(8, Math.max(3, draftText.split('\n').length))}
              aria-label={`Edit ${block.type} text`}
              style={{ border: '1px solid var(--border-strong)', background: 'var(--white)', color: 'var(--text)', resize: 'vertical' }}
            />
            <div className="flex justify-end gap-2">
              <button type="button" className="df-ghost-btn" style={{ padding: '5px 10px' }} onClick={() => { setDraftText(block.markdown); setEditingText(false); }}>Cancel</button>
              <button type="button" className="df-primary-btn" style={{ padding: '5px 10px' }} onClick={commitText}>Save text</button>
            </div>
          </div>
        ) : block.type === 'Table' && block.tableData?.length && onCellChange && onCellsPaste ? (
          <EditableTable
            block={block}
            originalBlock={originalBlock}
            pageIndex={pageIndex}
            onCellChange={onCellChange}
            onCellsPaste={onCellsPaste}
          />
        ) : renderHtml ? (
          <SanitizedHtml html={block.html} />
        ) : (
          <pre className="text-xs whitespace-pre-wrap" style={{ color: 'var(--text)', fontFamily: 'var(--font-mono)', overflowX: 'auto' }}>
            {block.html || block.markdown}
          </pre>
        )}
      </div>
    </div>
  );
}

function EditableTable({
  block,
  originalBlock,
  pageIndex,
  onCellChange,
  onCellsPaste,
}: {
  block: ParsedBlock;
  originalBlock: ParsedBlock;
  pageIndex: number;
  onCellChange: (patch: CorrectionPatch) => void;
  onCellsPaste: (pageIndex: number, block: ParsedBlock, rowIndex: number, columnIndex: number, values: string[][]) => void;
}) {
  const rows = block.tableData ?? [];
  const originalRows = originalBlock.tableData ?? [];
  const columnCount = Math.max(1, ...rows.map((row) => row.length));
  return (
    <div className="overflow-auto rounded-lg" style={{ border: '1px solid var(--border)', background: 'var(--white)' }}>
      <table className="w-full text-xs" style={{ borderCollapse: 'collapse' }}>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={`edit-row-${rowIndex}`}>
              {Array.from({ length: columnCount }, (_, columnIndex) => {
                const value = row[columnIndex] ?? '';
                const originalValue = originalRows[rowIndex]?.[columnIndex] ?? '';
                return (
                  <td key={`edit-cell-${rowIndex}-${columnIndex}`} className="p-1 align-top" style={{ borderBottom: '1px solid var(--border)', borderRight: columnIndex < columnCount - 1 ? '1px solid var(--border)' : undefined, minWidth: 130 }}>
                    <div className="flex items-center gap-1">
                      <CellEditor
                        value={value}
                        originalValue={originalValue}
                        label={`Table row ${rowIndex + 1}, column ${columnIndex + 1}`}
                        onCommit={(correctedValue) => onCellChange({ pageIndex, blockId: block.id, target: 'table-cell', rowIndex, columnIndex, originalValue, correctedValue })}
                        onPaste={(values) => onCellsPaste(pageIndex, block, rowIndex, columnIndex, values)}
                      />
                      {value !== originalValue && (
                        <button
                          type="button"
                          className="df-icon-btn flex-shrink-0"
                          style={{ width: 22, height: 22 }}
                          aria-label={`Reset table row ${rowIndex + 1}, column ${columnIndex + 1}`}
                          title="Reset cell"
                          onClick={(event) => {
                            event.stopPropagation();
                            onCellChange({ pageIndex, blockId: block.id, target: 'table-cell', rowIndex, columnIndex, originalValue, correctedValue: originalValue });
                          }}
                        >↶</button>
                      )}
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CellEditor({
  value,
  originalValue,
  label,
  onCommit,
  onPaste,
}: {
  value: string;
  originalValue: string;
  label: string;
  onCommit: (value: string) => void;
  onPaste: (values: string[][]) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => { if (draft !== value) onCommit(draft); };
  return (
    <input
      value={draft}
      aria-label={label}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') { event.preventDefault(); commit(); event.currentTarget.blur(); }
        if (event.key === 'Escape') { setDraft(value); event.currentTarget.blur(); }
      }}
      onPaste={(event) => {
        const text = event.clipboardData.getData('text/plain');
        if (!text.includes('\t') && !text.includes('\n')) return;
        event.preventDefault();
        onPaste(text.split(/\r?\n/).filter((row) => row.length).map((row) => row.split('\t')));
      }}
      className="w-full rounded px-2 py-1"
      style={{ border: draft !== originalValue ? '1px solid color-mix(in srgb, var(--accent) 55%, var(--border))' : '1px solid transparent', background: 'transparent', color: 'var(--text)', outline: 'none' }}
    />
  );
}

function SanitizedHtml({ html }: { html: string }) {
  const clean = useMemo(() => sanitize(html || ''), [html]);
  return <div className="prose prose-sm max-w-none" style={{ color: 'var(--text)' }} dangerouslySetInnerHTML={{ __html: clean }} />;
}
