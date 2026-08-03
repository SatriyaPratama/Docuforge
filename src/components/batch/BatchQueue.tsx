'use client';

import { useBatch } from '@/context/BatchContext';

export default function BatchQueue() {
  const { jobs, paused, pause, resume, remove } = useBatch();
  if (!jobs.length) return null;
  return (
    <aside className="fixed bottom-4 left-4 w-80 rounded-xl border bg-white p-3 shadow-lg" style={{ borderColor: 'var(--border)', zIndex: 60 }} aria-label="Batch queue">
      <div className="flex items-center gap-2">
        <p className="df-group-label flex-1">Batch queue · {jobs.filter((job) => job.status === 'completed').length}/{jobs.length}</p>
        <button type="button" className="df-ghost-btn" style={{ padding: '4px 7px' }} onClick={paused ? resume : pause}>{paused ? 'Resume' : 'Pause'}</button>
      </div>
      <div className="mt-2 max-h-48 space-y-1 overflow-y-auto">
        {jobs.map((job) => <div key={job.id} className="flex items-center gap-2 rounded px-2 py-1 text-xs" style={{ background: 'var(--surface-elevated)', color: 'var(--text)' }}>
          <span className="min-w-0 flex-1 truncate">{job.file.name}</span>
          <span style={{ color: 'var(--text-muted)' }}>{job.status}</span>
          {job.status !== 'parsing' && <button type="button" aria-label={`Remove ${job.file.name}`} onClick={() => remove(job.id)}>×</button>}
        </div>)}
      </div>
    </aside>
  );
}
