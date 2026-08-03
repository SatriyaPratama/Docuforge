import { makeBlockRef } from '@/lib/blockRefs';
import type { ParsedPage } from '@/lib/types';

export interface SearchResult {
  blockRef: string;
  pageIndex: number;
  blockType: string;
  text: string;
  matchIndex: number;
}

function searchableText(value: string) {
  return value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

export function searchDocument(pages: ParsedPage[], query: string, limit = 100): SearchResult[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return [];
  const results: SearchResult[] = [];
  for (const page of pages) {
    for (const block of page.blocks) {
      const text = searchableText(block.markdown || block.html || (block.tableData ?? []).flat().join(' '));
      const matchIndex = text.toLocaleLowerCase().indexOf(needle);
      if (matchIndex < 0) continue;
      results.push({ blockRef: makeBlockRef(page.pageIndex, block.id), pageIndex: page.pageIndex, blockType: block.type, text, matchIndex });
      if (results.length >= limit) return results;
    }
  }
  return results;
}

export function searchSnippet(result: SearchResult, queryLength: number) {
  const start = Math.max(0, result.matchIndex - 48);
  const end = Math.min(result.text.length, result.matchIndex + queryLength + 96);
  return `${start ? '…' : ''}${result.text.slice(start, end)}${end < result.text.length ? '…' : ''}`;
}
