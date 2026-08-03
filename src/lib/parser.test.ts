import { describe, expect, it } from 'vitest';
import { parseOcrResponse } from '@/lib/parser';

describe('parseOcrResponse', () => {
  it('preserves source page ids and expands table spans', () => {
    const pages = parseOcrResponse({ pages: [{ page_id: 7, blocks: [{ block_type: 'Table', html: '<table><tr><th colspan="2">A</th></tr><tr><td>B</td><td>C</td></tr></table>' }] }] });
    expect(pages[0].pageIndex).toBe(7);
    expect(pages[0].blocks[0].tableData).toEqual([['A', 'A'], ['B', 'C']]);
  });
});
