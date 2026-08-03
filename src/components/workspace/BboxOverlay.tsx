'use client';

import { useMemo } from 'react';
import { makeBlockRef } from '@/lib/blockRefs';
import { blockTypeColor } from '@/lib/blockColors';
import type { ParsedBlock, ParsedPage } from '@/lib/types';

export type BboxDetail = 'blocks' | 'items';

export interface BboxSelection {
  key: string;
  blockRef: string;
  detail: BboxDetail;
  label: string;
  text: string;
  bbox: [number, number, number, number];
  confidence: number | null;
  color: string;
}

interface OverlayRect extends BboxSelection {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface ElementBox {
  bbox: [number, number, number, number];
  text: string;
  confidence: number | null;
}

function parseBbox(value: string | null): [number, number, number, number] | null {
  if (!value) return null;
  const parts = value.trim().split(/\s+/).map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return null;
  return parts as [number, number, number, number];
}

function parseConfidence(value: string | null): number | null {
  if (value == null || value.trim() === '') return null;
  const confidence = Number(value);
  return Number.isFinite(confidence) ? confidence : null;
}

function cleanText(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

function unionBboxes(boxes: [number, number, number, number][]): [number, number, number, number] | null {
  if (!boxes.length) return null;
  return [
    Math.min(...boxes.map((box) => box[0])),
    Math.min(...boxes.map((box) => box[1])),
    Math.max(...boxes.map((box) => box[2])),
    Math.max(...boxes.map((box) => box[3])),
  ];
}

function elementBox(element: Element): ElementBox | null {
  const direct = parseBbox(element.getAttribute('data-bbox'));
  const descendants = Array.from(element.querySelectorAll('[data-bbox]'))
    .map((child) => parseBbox(child.getAttribute('data-bbox')))
    .filter((box): box is [number, number, number, number] => Boolean(box));
  const bbox = direct ?? unionBboxes(descendants);
  if (!bbox) return null;
  return {
    bbox,
    text: cleanText(element.textContent),
    confidence: parseConfidence(element.getAttribute('data-confidence')),
  };
}

function parseHtml(html: string): Document | null {
  if (typeof DOMParser === 'undefined' || !html) return null;
  return new DOMParser().parseFromString(html, 'text/html');
}

/**
 * Read table cells/list items when Surya supplies nested coordinates. The
 * fallback to row boxes keeps item mode useful for engines that annotate rows
 * but not individual cells, without inventing pixel positions.
 */
function extractItemBoxes(block: ParsedBlock, blockIndex: number, color: string, blockRef: string): BboxSelection[] {
  const doc = parseHtml(block.html);
  if (!doc) return [];

  const tableCells = Array.from(doc.querySelectorAll('td, th'));
  const cellBoxes = tableCells.flatMap((node, itemIndex) => {
    const item = elementBox(node);
    if (!item) return [];
    return [{
      key: `item-${block.id}-${blockIndex}-cell-${itemIndex}`,
      blockRef,
      detail: 'items' as const,
      label: node.tagName.toLowerCase() === 'th' ? 'Column header' : 'Table item',
      text: item.text,
      bbox: item.bbox,
      confidence: item.confidence,
      color,
    }];
  });
  if (cellBoxes.length) return cellBoxes;

  const rowBoxes = Array.from(doc.querySelectorAll('tr')).flatMap((node, itemIndex) => {
    const item = elementBox(node);
    if (!item) return [];
    return [{
      key: `item-${block.id}-${blockIndex}-row-${itemIndex}`,
      blockRef,
      detail: 'items' as const,
      label: 'Table row',
      text: item.text,
      bbox: item.bbox,
      confidence: item.confidence,
      color,
    }];
  });
  if (rowBoxes.length) return rowBoxes;

  const listBoxes = Array.from(doc.querySelectorAll('li')).flatMap((node, itemIndex) => {
    const item = elementBox(node);
    if (!item) return [];
    return [{
      key: `item-${block.id}-${blockIndex}-list-${itemIndex}`,
      blockRef,
      detail: 'items' as const,
      label: 'List item',
      text: item.text,
      bbox: item.bbox,
      confidence: item.confidence,
      color,
    }];
  });
  if (listBoxes.length) return listBoxes;

  return Array.from(doc.querySelectorAll('[data-bbox]')).flatMap((node, itemIndex) => {
    const item = elementBox(node);
    if (!item) return [];
    return [{
      key: `item-${block.id}-${blockIndex}-element-${itemIndex}`,
      blockRef,
      detail: 'items' as const,
      label: node.getAttribute('data-label') || 'Item',
      text: item.text,
      bbox: item.bbox,
      confidence: item.confidence,
      color,
    }];
  });
}

function blockText(block: ParsedBlock): string {
  const doc = parseHtml(block.html);
  return cleanText(doc?.body.textContent || block.markdown);
}

function tableItemLabel(item: NonNullable<ParsedBlock['items']>[number]): string {
  if (item.kind === 'row') return `Table row ${typeof item.row_id === 'number' ? item.row_id + 1 : ''}`.trim();
  if (item.kind === 'column') return `Table column ${typeof item.col_id === 'number' ? item.col_id + 1 : ''}`.trim();
  if (item.kind === 'cell') {
    const position = typeof item.row_id === 'number' && typeof item.col_id === 'number'
      ? ` ${item.row_id + 1},${item.col_id + 1}`
      : '';
    return `Table cell${position}`;
  }
  return 'Item';
}

function tableItemBoxes(block: ParsedBlock, blockIndex: number, color: string, blockRef: string): BboxSelection[] {
  return (block.items ?? []).map((item, itemIndex) => ({
    key: `item-${block.id}-${blockIndex}-ocr-${itemIndex}`,
    blockRef,
    detail: 'items' as const,
    label: tableItemLabel(item),
    text: tableItemLabel(item),
    bbox: item.bbox,
    confidence: item.confidence ?? null,
    color,
  }));
}

function confColor(confidence: number | null): string {
  if (confidence == null) return '#2563eb';
  const hue = Math.max(0, Math.min(1, confidence)) * 120;
  return `hsl(${hue} 85% 42%)`;
}

function toRect(selection: BboxSelection): OverlayRect {
  const [x0, y0, x1, y1] = selection.bbox;
  return { ...selection, x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Interactive OCR overlays for block, table/list item, and word detail. */
export default function BboxOverlay({
  page,
  detail,
  showConfidence,
  selectedKey,
  hoveredBlockRef,
  selectedBlockRef,
  onSelect,
  onHover,
}: {
  page: ParsedPage;
  detail: BboxDetail;
  showConfidence: boolean;
  selectedKey: string | null;
  hoveredBlockRef: string | null;
  selectedBlockRef: string | null;
  onSelect: (selection: BboxSelection) => void;
  onHover: (blockRef: string | null) => void;
}) {
  const w = page.width ?? 0;
  const h = page.height ?? 0;

  const rects = useMemo<OverlayRect[]>(() => {
    if (!w || !h) return [];
    const selections = page.blocks.flatMap((block, blockIndex) => {
      const blockRef = makeBlockRef(page.pageIndex, block.id);
      const baseColor = showConfidence
        ? confColor(block.confidence ?? null)
        : blockTypeColor(block.type);
      if (detail === 'items') {
        const ocrItems = tableItemBoxes(block, blockIndex, baseColor, blockRef);
        return ocrItems.length ? ocrItems : extractItemBoxes(block, blockIndex, baseColor, blockRef);
      }
      if (!block.bbox) return [];
      return [{
        key: `block-${block.id}-${blockIndex}`,
        blockRef,
        detail: 'blocks' as const,
        label: block.type,
        text: blockText(block),
        bbox: block.bbox,
        confidence: block.confidence ?? null,
        color: baseColor,
      }];
    });
    return selections.map(toRect);
  }, [page, detail, showConfidence, w, h]);

  if (!w || !h) return null;

  return (
    <>
      <svg
        viewBox={`0 0 ${w} ${h}`}
        preserveAspectRatio="none"
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'auto' }}
        aria-label={`${detail} bounding boxes`}
        data-testid="bbox-overlay"
      >
        {rects.map((rect) => {
          const selected = rect.key === selectedKey || rect.blockRef === selectedBlockRef;
          const hovered = rect.blockRef === hoveredBlockRef;
          const active = selected || hovered;
          return (
            <rect
              key={rect.key}
              x={rect.x}
              y={rect.y}
              width={Math.max(0, rect.w)}
              height={Math.max(0, rect.h)}
              fill={active || showConfidence ? rect.color : 'transparent'}
              fillOpacity={selected ? 0.28 : hovered ? 0.2 : showConfidence ? 0.16 : 0}
              stroke={selected ? '#111827' : rect.color}
              strokeWidth={selected ? 3 : hovered ? 2.5 : 1.5}
              strokeOpacity={active ? 1 : 0.9}
              vectorEffect="non-scaling-stroke"
              rx={1.5}
              role="button"
              tabIndex={0}
              aria-label={`${rect.label}: ${rect.text || 'no text'}`}
              style={{ cursor: 'pointer' }}
              onMouseEnter={() => onHover(rect.blockRef)}
              onMouseLeave={() => onHover(null)}
              onClick={(event) => {
                event.stopPropagation();
                onSelect(rect);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  onSelect(rect);
                }
              }}
            >
              <title>{`${rect.label}: ${rect.text || 'no text'}`}</title>
            </rect>
          );
        })}
      </svg>
      {rects.length === 0 && detail !== 'blocks' && (
        <div
          data-testid="bbox-empty"
          className="absolute top-3 left-3 rounded-md px-2 py-1 text-[10px]"
          style={{ background: 'rgba(255,255,255,0.9)', color: 'var(--text-muted)', border: '1px solid var(--border)', pointerEvents: 'none' }}
        >
          No {detail} coordinates in this OCR result
        </div>
      )}
    </>
  );
}
