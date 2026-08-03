import { describe, expect, it } from 'vitest';
import { searchDocument } from '@/lib/documentSearch';

describe('searchDocument', () => {
  it('finds normalized OCR text without rendering HTML', () => {
    const results = searchDocument([{ pageIndex: 2, tableCount: 0, blocks: [{ id: 't', type: 'Text', html: '<p>Hello <b>world</b></p>', markdown: '' }] }], 'WORLD');
    expect(results).toMatchObject([{ pageIndex: 2, blockRef: '2::t' }]);
  });
});
