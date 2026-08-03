'use client';

import { useMemo, useState } from 'react';
import { useApp } from '@/context/AppContext';
import { makeBlockRef } from '@/lib/blockRefs';
import { applyCorrections } from '@/lib/corrections';
import { blockPreview, filterReviewCandidates, reviewCandidates, type ReviewFilter } from '@/lib/reviewQueue';

const FILTERS: { id: ReviewFilter; label: string }[] = [
  { id: 'pending', label: 'Pending' },
  { id: 'approved', label: 'Approved' },
  { id: 'corrected', label: 'Corrected' },
  { id: 'unscored', label: 'Unscored' },
];

export default function ReviewPanel() {
  const { state, dispatch } = useApp();
  const [filter, setFilter] = useState<ReviewFilter>('pending');
  const correctedPages = useMemo(
    () => applyCorrections(state.pages, state.corrections, state.blockMerges),
    [state.pages, state.corrections, state.blockMerges],
  );
  const correctedRefs = useMemo(() => new Set(state.corrections.map((patch) => makeBlockRef(patch.pageIndex, patch.blockId))), [state.corrections]);
  const candidates = useMemo(
    () => filterReviewCandidates(reviewCandidates(correctedPages, state.reviewDecisions, correctedRefs), filter),
    [correctedPages, state.reviewDecisions, correctedRefs, filter],
  );

  const open = (pageIndex: number, blockRef: string) => {
    const position = state.pages.findIndex((page) => page.pageIndex === pageIndex);
    if (position >= 0) dispatch({ type: 'SET_CURRENT_PAGE', payload: position });
    dispatch({ type: 'SET_SELECTED_BLOCK', payload: blockRef });
  };

  return (
    <section className="flex h-full min-h-0 flex-col" aria-label="OCR review queue">
      <div className="space-y-3 border-b px-5 py-4" style={{ borderColor: 'var(--border)' }}>
        <div>
          <p className="df-group-label">Quality review</p>
          <p className="mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>Review OCR blocks below 80% confidence, or record approvals for reliable content.</p>
        </div>
        <div className="flex gap-1 overflow-x-auto" role="tablist" aria-label="Review filter">
          {FILTERS.map(({ id, label }) => (
            <button key={id} type="button" role="tab" aria-selected={filter === id} className="df-subtab whitespace-nowrap" data-active={filter === id} onClick={() => setFilter(id)}>{label}</button>
          ))}
        </div>
      </div>
      <div className="flex-1 space-y-3 overflow-y-auto p-5">
        {!candidates.length && <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Nothing in this review group.</p>}
        {candidates.map((candidate) => (
          <article key={candidate.blockRef} className="rounded-xl border p-3" style={{ borderColor: 'var(--border)' }}>
            <div className="flex items-center gap-2 text-xs">
              <span className="font-medium" style={{ color: 'var(--text)' }}>Page {candidate.pageIndex + 1}</span>
              <span style={{ color: 'var(--text-muted)' }}>{candidate.block.type}</span>
              <span className="ml-auto" style={{ color: 'var(--text-muted)' }}>{candidate.confidence == null ? 'No confidence' : `${Math.round(candidate.confidence * 100)}%`}</span>
            </div>
            <p className="mt-2 text-sm" style={{ color: 'var(--text)' }}>{blockPreview(candidate.block) || 'No extracted text'}</p>
            <div className="mt-3 flex justify-end gap-2">
              <button type="button" className="df-ghost-btn" style={{ padding: '5px 9px' }} onClick={() => open(candidate.pageIndex, candidate.blockRef)}>Open</button>
              {!candidate.approved && <button type="button" className="df-primary-btn" style={{ padding: '5px 9px' }} onClick={() => dispatch({ type: 'SET_REVIEW_DECISION', payload: { blockRef: candidate.blockRef, status: 'approved', updatedAt: Date.now() } })}>Approve</button>}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
