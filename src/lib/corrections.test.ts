import { describe, expect, it } from 'vitest';
import { applyCorrections, selectCorrectedPage } from '@/lib/corrections';
import type { ParsedPage } from '@/lib/types';

const pages: ParsedPage[] = [{
  pageIndex: 4,
  tableCount: 1,
  blocks: [
    { id: 'a', type: 'Text', html: '<p>Alpha</p>', markdown: 'Alpha' },
    { id: 'b', type: 'Table', html: '<table><tr><td>Head</td></tr><tr><td>1</td></tr></table>', markdown: 'Head', tableData: [['Head'], ['1']] },
  ],
}];

describe('correction selectors', () => {
  it('keeps raw pages immutable while applying a table-cell patch', () => {
    const corrected = applyCorrections(pages, [{ pageIndex: 4, blockId: 'b', target: 'table-cell', rowIndex: 1, columnIndex: 0, originalValue: '1', correctedValue: '2' }]);
    expect(corrected[0].blocks[1].tableData?.[1][0]).toBe('2');
    expect(pages[0].blocks[1].tableData?.[1][0]).toBe('1');
  });

  it('selects a corrected page without returning unrelated pages', () => {
    const selected = selectCorrectedPage(pages, 0, [{ pageIndex: 4, blockId: 'a', target: 'block', originalValue: 'Alpha', correctedValue: 'Beta' }]);
    expect(selected?.blocks[0].markdown).toBe('Beta');
  });
});
