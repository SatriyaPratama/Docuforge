import { describe, expect, it } from 'vitest';
import { filterReviewCandidates, reviewCandidates } from '@/lib/reviewQueue';

describe('review queue', () => {
  it('keeps unscored blocks separate from pending low confidence work', () => {
    const candidates = reviewCandidates([{ pageIndex: 0, tableCount: 0, blocks: [
      { id: 'low', type: 'Text', html: '', markdown: 'low', confidence: 0.4 },
      { id: 'none', type: 'Text', html: '', markdown: 'none', confidence: null },
    ] }], [], new Set());
    expect(filterReviewCandidates(candidates, 'pending')).toHaveLength(1);
    expect(filterReviewCandidates(candidates, 'unscored')).toHaveLength(1);
  });
});
