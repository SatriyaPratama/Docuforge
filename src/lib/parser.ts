import type {
  BlockType,
  OcrApiResponse,
  ParsedBlock,
  ParsedPage,
  RawBlock,
  RawPage,
} from '@/lib/types';

/** Normalize the block_type string from the OCR engine to our BlockType enum */
function normaliseType(raw: string): BlockType {
  const map: Record<string, BlockType> = {
    pageheader:    'PageHeader',
    sectionheader: 'SectionHeader',
    text:          'Text',
    table:         'Table',
    figure:        'Figure',
    figuregroup:   'FigureGroup',
    figurecaption: 'FigureCaption',
    pagefooter:    'PageFooter',
    page:          'Page',
  };
  const key = raw.toLowerCase().replace(/[^a-z]/g, '');
  return map[key] ?? 'Unknown';
}

/**
 * HTML table → 2-D string array.
 * Uses DOMParser (browser) so nested markup is handled correctly, and expands
 * colspan/rowspan into a rectangular grid so exported CSV columns stay aligned.
 * Falls back to a regex parse outside DOM environments (e.g. unit tests).
 */
function extractTableData(html: string): string[][] {
  if (typeof DOMParser === 'undefined') {
    return extractTableDataRegex(html);
  }

  const doc = new DOMParser().parseFromString(html, 'text/html');
  const grid: string[][] = [];
  // rowspan carry-over: pending[columnIndex] = { text, remainingRows }
  const pending = new Map<number, { text: string; rows: number }>();

  doc.querySelectorAll('tr').forEach((tr) => {
    const row: string[] = [];
    let col = 0;

    const fillCarryOver = () => {
      while (pending.has(col)) {
        const carry = pending.get(col)!;
        row[col] = carry.text;
        carry.rows -= 1;
        if (carry.rows <= 0) pending.delete(col);
        col += 1;
      }
    };

    tr.querySelectorAll(':scope > td, :scope > th').forEach((cell) => {
      fillCarryOver();
      const text = cell.textContent?.replace(/\s+/g, ' ').trim() ?? '';
      const colSpan = Math.max(1, Number(cell.getAttribute('colspan')) || 1);
      const rowSpan = Math.max(1, Number(cell.getAttribute('rowspan')) || 1);
      for (let c = 0; c < colSpan; c += 1) {
        row[col] = text;
        if (rowSpan > 1) pending.set(col, { text, rows: rowSpan - 1 });
        col += 1;
      }
    });
    fillCarryOver();

    if (row.length) grid.push(row);
  });

  return grid;
}

/** Regex fallback for environments without DOMParser */
function extractTableDataRegex(html: string): string[][] {
  const rows: string[][] = [];
  const rowMatches = html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi);
  for (const rowMatch of rowMatches) {
    const cells: string[] = [];
    const cellMatches = rowMatch[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi);
    for (const c of cellMatches) {
      cells.push(c[1].replace(/<[^>]+>/g, '').trim());
    }
    if (cells.length) rows.push(cells);
  }
  return rows;
}

function parseBlock(raw: RawBlock, fallbackId: string): ParsedBlock {
  const type = normaliseType(raw.block_type ?? '');
  const html = raw.html ?? '';
  const markdown = raw.markdown ?? html.replace(/<[^>]+>/g, '');
  const block: ParsedBlock = {
    id: raw.id ?? fallbackId,
    type,
    html,
    markdown,
    bbox: raw.bbox,
    confidence: raw.confidence ?? null,
    items: raw.items,
  };
  if (type === 'Table') {
    block.tableData = extractTableData(html);
  }
  return block;
}

function toParsedPage(
  rawBlocks: RawBlock[],
  pageIndex: number,
  width?: number | null,
  height?: number | null,
): ParsedPage {
  const blocks = rawBlocks.map((raw, i) => parseBlock(raw, `p${pageIndex}-blk-${i + 1}`));
  return {
    pageIndex,
    blocks,
    tableCount: blocks.filter((b) => b.type === 'Table').length,
    width: width ?? null,
    height: height ?? null,
  };
}

/** Resolve a page's index in the ORIGINAL document (page_id) with sane fallbacks. */
function resolvePageIndex(page: RawPage, arrayIdx: number): number {
  if (typeof page.page_id === 'number' && page.page_id >= 0) return page.page_id;
  if (typeof page.id === 'number' && page.id >= 0) return page.id;
  return arrayIdx;
}

/**
 * Normalise the varied shapes of the OCR API response into a list of ParsedPages.
 *
 * Three observed response shapes:
 *   1. { pages: [ { id, page_id, children|blocks: [block, …] }, … ] }
 *   2. { children: [block, …] }                         ← single-page response
 *   3. { blocks: [block, …] }                           ← alternative key name
 *
 * ParsedPage.pageIndex preserves page_id so results line up with the source
 * document even when a partial page_range was parsed.
 */
export function parseOcrResponse(raw: OcrApiResponse): ParsedPage[] {
  // Shape 1: multi-page
  if (Array.isArray(raw.pages) && raw.pages.length > 0) {
    return raw.pages.map((page, idx) => {
      const rawBlocks: RawBlock[] = (page.children ?? page.blocks ?? []) as RawBlock[];
      return toParsedPage(rawBlocks, resolvePageIndex(page, idx), page.width, page.height);
    });
  }

  // Shape 2 / 3: single-page
  const rawBlocks: RawBlock[] = ((raw.children ?? raw.blocks ?? []) as RawBlock[]);
  if (rawBlocks.length > 0) {
    return [toParsedPage(rawBlocks, 0)];
  }

  return [];
}

/** Build the block-type badge CSS class name */
export function blockTypeBadgeClass(type: BlockType): string {
  const cls: Record<BlockType, string> = {
    PageHeader:    'badge-page-header',
    SectionHeader: 'badge-section-header',
    Text:          'badge-text',
    Table:         'badge-table',
    Figure:        'badge-figure',
    FigureGroup:   'badge-figure',
    FigureCaption: 'badge-figure-caption',
    PageFooter:    'badge-page-footer',
    Page:          'badge-page',
    Unknown:       'badge-unknown',
  };
  return cls[type] ?? 'badge-unknown';
}
