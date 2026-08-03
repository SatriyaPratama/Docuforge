import { makeBlockRef } from '@/lib/blockRefs';
import type { ParsedBlock, ParsedPage, ReviewDecision } from '@/lib/types';

export type ReviewFilter = 'pending' | 'approved' | 'corrected' | 'unscored';
export const DEFAULT_REVIEW_THRESHOLD = 0.8;

export interface ReviewCandidate {
  blockRef: string;
  pageIndex: number;
  block: ParsedBlock;
  confidence: number | null;
  corrected: boolean;
  approved: boolean;
}

export function reviewCandidates(
  pages: ParsedPage[],
  decisions: ReviewDecision[],
  correctedRefs: Set<string>,
  threshold = DEFAULT_REVIEW_THRESHOLD,
): ReviewCandidate[] {
  const approved = new Set(decisions.filter((decision) => decision.status === 'approved').map((decision) => decision.blockRef));
  return pages.flatMap((page) => page.blocks.map((block) => {
    const blockRef = makeBlockRef(page.pageIndex, block.id);
    return {
      blockRef,
      pageIndex: page.pageIndex,
      block,
      confidence: block.confidence ?? null,
      corrected: correctedRefs.has(blockRef),
      approved: approved.has(blockRef),
    };
  }));
}

export function filterReviewCandidates(candidates: ReviewCandidate[], filter: ReviewFilter, threshold = DEFAULT_REVIEW_THRESHOLD) {
  return candidates.filter((candidate) => {
    if (filter === 'approved') return candidate.approved;
    if (filter === 'corrected') return candidate.corrected;
    if (filter === 'unscored') return candidate.confidence == null;
    return candidate.confidence != null && candidate.confidence < threshold && !candidate.approved && !candidate.corrected;
  }).sort((left, right) => (left.confidence ?? 1.1) - (right.confidence ?? 1.1));
}

export function blockPreview(block: ParsedBlock) {
  return (block.markdown || block.html).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160);
}
