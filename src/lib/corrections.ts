import type { BlockMerge, CorrectionPatch, ParsedBlock, ParsedPage } from '@/lib/types';

export function correctionKey(patch: Pick<CorrectionPatch, 'pageIndex' | 'blockId' | 'target' | 'rowIndex' | 'columnIndex'>): string {
  return [patch.pageIndex, patch.blockId, patch.target, patch.rowIndex ?? '', patch.columnIndex ?? ''].join('::');
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function serializeTableHtml(rows: string[][]): string {
  return `<table><tbody>${rows
    .map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`)
    .join('')}</tbody></table>`;
}

function serializeTableMarkdown(rows: string[][]): string {
  if (!rows.length) return '';
  const width = Math.max(1, ...rows.map((row) => row.length));
  const normalized = rows.map((row) => Array.from({ length: width }, (_, i) => String(row[i] ?? '').replace(/\|/g, '\\|')));
  const header = `| ${normalized[0].join(' | ')} |`;
  const divider = `| ${normalized[0].map(() => '---').join(' | ')} |`;
  const body = normalized.slice(1).map((row) => `| ${row.join(' | ')} |`);
  return [header, divider, ...body].join('\n');
}

function unionBbox(blocks: ParsedBlock[]): [number, number, number, number] | undefined {
  const boxes = blocks.map((block) => block.bbox).filter((bbox): bbox is [number, number, number, number] => Boolean(bbox));
  if (!boxes.length) return undefined;
  return [
    Math.min(...boxes.map((box) => box[0])),
    Math.min(...boxes.map((box) => box[1])),
    Math.max(...boxes.map((box) => box[2])),
    Math.max(...boxes.map((box) => box[3])),
  ];
}

function mergeRows(parts: ParsedBlock[]): string[][] {
  const rows: string[][] = [];
  for (const part of parts) {
    if (part.tableData?.length) {
      const incoming = part.tableData.map((row) => [...row]);
      const first = incoming[0]?.map((value) => value.trim()).join('|');
      const existingHeader = rows[0]?.map((value) => value.trim()).join('|');
      if (rows.length && first && first === existingHeader) incoming.shift();
      rows.push(...incoming);
      continue;
    }
    const text = part.markdown.replace(/\s+/g, ' ').trim();
    if (text) rows.push([text]);
  }
  return rows;
}

function mergeParsedBlocks(parts: ParsedBlock[]): ParsedBlock {
  const first = parts[0];
  const isTable = parts.some((part) => part.type === 'Table' || part.tableData?.length);
  const confidenceValues = parts.map((part) => part.confidence).filter((value): value is number => typeof value === 'number');
  const tableData = isTable ? mergeRows(parts) : undefined;
  const markdown = isTable
    ? serializeTableMarkdown(tableData ?? [])
    : parts.map((part) => part.markdown.trim()).filter(Boolean).join('\n\n');
  const html = isTable
    ? serializeTableHtml(tableData ?? [])
    : parts.map((part) => part.html).filter(Boolean).join('\n');
  return {
    ...first,
    type: isTable ? 'Table' : first.type,
    html,
    markdown,
    tableData,
    bbox: unionBbox(parts),
    confidence: confidenceValues.length ? confidenceValues.reduce((sum, value) => sum + value, 0) / confidenceValues.length : first.confidence,
    items: parts.flatMap((part) => part.items ?? []),
  };
}

/** Merge structural groups while preserving page and block identity for selection. */
export function applyMerges(pages: ParsedPage[], merges: BlockMerge[]): ParsedPage[] {
  if (!merges.length) return pages;
  const mergesByPage = new Map<number, BlockMerge[]>();
  for (const merge of merges) {
    if (merge.blockIds.length <= 1) continue;
    const pageMerges = mergesByPage.get(merge.pageIndex) ?? [];
    pageMerges.push(merge);
    mergesByPage.set(merge.pageIndex, pageMerges);
  }
  return pages.map((page) => {
    const pageMerges = mergesByPage.get(page.pageIndex) ?? [];
    if (!pageMerges.length) return page;
    const groups = new Map<string, string[]>();
    for (const merge of pageMerges) {
      const existing = merge.blockIds.flatMap((id) => groups.get(id) ?? [id]);
      const unique = [...new Set(existing)];
      for (const id of unique) groups.set(id, unique);
    }
    const seen = new Set<string>();
    const blocksById = new Map(page.blocks.map((block) => [block.id, block]));
    const blocks: ParsedBlock[] = [];
    for (const block of page.blocks) {
      const group = groups.get(block.id);
      if (!group) {
        blocks.push(block);
        continue;
      }
      if (seen.has(block.id)) continue;
      const groupBlocks = group.map((id) => blocksById.get(id)).filter((candidate): candidate is ParsedBlock => Boolean(candidate));
      blocks.push(mergeParsedBlocks(groupBlocks));
      groupBlocks.forEach((candidate) => seen.add(candidate.id));
    }
    return { ...page, blocks, tableCount: blocks.filter((block) => block.type === 'Table').length };
  });
}

function cloneRows(rows: string[][] | undefined): string[][] | undefined {
  return rows?.map((row) => [...row]);
}

function patchBlock(block: ParsedBlock, blockPatches: CorrectionPatch[]): ParsedBlock {
  if (!blockPatches.length) return block;

  let next: ParsedBlock = block;
  const tablePatches = blockPatches.filter((patch) => patch.target === 'table-cell');
  if (tablePatches.length && block.tableData) {
    const tableData = cloneRows(block.tableData)!;
    for (const patch of tablePatches) {
      if (patch.rowIndex == null || patch.columnIndex == null) continue;
      while (tableData.length <= patch.rowIndex) tableData.push([]);
      while (tableData[patch.rowIndex].length <= patch.columnIndex) tableData[patch.rowIndex].push('');
      tableData[patch.rowIndex][patch.columnIndex] = patch.correctedValue;
    }
    next = {
      ...next,
      tableData,
      html: serializeTableHtml(tableData),
      markdown: serializeTableMarkdown(tableData),
    };
  }

  const blockPatch = blockPatches.find((patch) => patch.target === 'block');
  if (blockPatch) {
    next = {
      ...next,
      markdown: blockPatch.correctedValue,
      html: `<p>${escapeHtml(blockPatch.correctedValue).replace(/\n/g, '<br>')}</p>`,
    };
  }
  return next;
}

/** Apply patches with structural sharing: untouched pages and blocks retain identity. */
function applyPatches(pages: ParsedPage[], patches: CorrectionPatch[]): ParsedPage[] {
  if (!patches.length) return pages;
  const byPage = new Map<number, Map<string, CorrectionPatch[]>>();
  for (const patch of patches) {
    const pagePatches = byPage.get(patch.pageIndex) ?? new Map<string, CorrectionPatch[]>();
    const list = pagePatches.get(patch.blockId) ?? [];
    list.push(patch);
    pagePatches.set(patch.blockId, list);
    byPage.set(patch.pageIndex, pagePatches);
  }

  return pages.map((page) => {
    const pagePatches = byPage.get(page.pageIndex);
    if (!pagePatches) return page;
    let changed = false;
    const blocks = page.blocks.map((block) => {
      const next = patchBlock(block, pagePatches.get(block.id) ?? []);
      changed ||= next !== block;
      return next;
    });
    return changed ? { ...page, blocks } : page;
  });
}

export function applyCorrections(pages: ParsedPage[], patches: CorrectionPatch[], merges: BlockMerge[] = []): ParsedPage[] {
  if (!patches.length) return applyMerges(pages, merges);
  const correctedRaw = applyPatches(pages, patches);
  const merged = applyMerges(correctedRaw, merges);
  const mergedFirstIds = new Set(merges.map((merge) => merge.blockIds[0]).filter(Boolean));
  const mergedBlockPatches = patches.filter((patch) => mergedFirstIds.has(patch.blockId));
  return mergedBlockPatches.length ? applyPatches(merged, mergedBlockPatches) : merged;
}

/** Return a corrected source page without rebuilding unrelated pages. */
export function selectCorrectedPage(
  pages: ParsedPage[],
  pageIndex: number,
  patches: CorrectionPatch[],
  merges: BlockMerge[] = [],
): ParsedPage | undefined {
  const page = pages[pageIndex];
  if (!page) return undefined;
  return applyCorrections([page], patches.filter((patch) => patch.pageIndex === page.pageIndex), merges.filter((merge) => merge.pageIndex === page.pageIndex))[0];
}

export function selectCorrectedPages(
  pages: ParsedPage[],
  patches: CorrectionPatch[],
  merges: BlockMerge[] = [],
): ParsedPage[] {
  return applyCorrections(pages, patches, merges);
}

export function mergeCorrectionPatches(current: CorrectionPatch[], incoming: CorrectionPatch[]): CorrectionPatch[] {
  const next = new Map(current.map((patch) => [correctionKey(patch), patch]));
  for (const patch of incoming) {
    const key = correctionKey(patch);
    const existing = next.get(key);
    if (patch.correctedValue === patch.originalValue) {
      next.delete(key);
    } else {
      next.set(key, existing ? { ...patch, originalValue: existing.originalValue } : patch);
    }
  }
  return [...next.values()];
}

export function resetBlockPatches(current: CorrectionPatch[], pageIndex: number, blockId: string): CorrectionPatch[] {
  return current.filter((patch) => patch.pageIndex !== pageIndex || patch.blockId !== blockId);
}

export function mergeBlockGroups(current: BlockMerge[], pageIndex: number, firstBlockId: string, secondBlockId: string): BlockMerge[] {
  const relevant = current.filter((merge) => merge.pageIndex === pageIndex);
  const unrelated = current.filter((merge) => merge.pageIndex !== pageIndex);
  const matching = relevant.filter((merge) => merge.blockIds.includes(firstBlockId) || merge.blockIds.includes(secondBlockId));
  const ids = [...new Set([firstBlockId, secondBlockId, ...matching.flatMap((merge) => merge.blockIds)])];
  return [...unrelated, ...relevant.filter((merge) => !matching.includes(merge)), { pageIndex, blockIds: ids }];
}

export function resetBlockMerges(current: BlockMerge[], pageIndex: number, blockId: string): BlockMerge[] {
  return current.filter((merge) => merge.pageIndex !== pageIndex || !merge.blockIds.includes(blockId));
}
