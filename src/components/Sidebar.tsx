'use client';

import { useState } from 'react';
import { ACCEPTED_EXTENSIONS } from '@/lib/fileConstraints';

const FORMAT_CHIPS = ['PDF', 'PNG', 'JPEG', 'WebP', 'TIFF'];

export default function Sidebar() {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <aside className="df-sidebar" data-collapsed={collapsed}>
      {/* Brand + collapse */}
      <div className="flex items-center justify-between px-4" style={{ height: 'var(--topbar-h)', borderBottom: '1px solid var(--border)' }}>
        {!collapsed && (
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-lg leading-none" aria-hidden="true">🔶</span>
            <span
              className="text-base font-semibold tracking-tight truncate"
              style={{ fontFamily: 'var(--font-heading)', color: 'var(--text)' }}
            >
              DocuForge
            </span>
          </div>
        )}
        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          className="df-icon-btn"
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          style={{ marginLeft: collapsed ? 'auto' : 0, marginRight: collapsed ? 'auto' : 0 }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d={collapsed ? 'M9 6l6 6-6 6' : 'M15 6l-6 6 6 6'}
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>

      {/* Workflow */}
      <div className="flex-1 overflow-y-auto px-3 py-4 space-y-6">
        <div className="space-y-2">
          {!collapsed && <p className="df-side-label px-2">Workspace</p>}
          <div className="df-side-item" data-active="true" title="Convert">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true" style={{ flexShrink: 0 }}>
              <path d="M7 3.75h7.75L20.25 9v11.25A1.75 1.75 0 0 1 18.5 22h-11A1.75 1.75 0 0 1 5.75 20.25V5.5A1.75 1.75 0 0 1 7.5 3.75Z" stroke="currentColor" strokeWidth="1.5" />
              <path d="M14.5 3.75V8a1 1 0 0 0 1 1h4.75" stroke="currentColor" strokeWidth="1.5" />
            </svg>
            {!collapsed && <span>Convert</span>}
          </div>
        </div>

        {!collapsed && (
          <>
            <div className="space-y-2">
              <p className="df-side-label px-2">Supported formats</p>
              <div className="flex flex-wrap gap-1.5 px-2">
                {FORMAT_CHIPS.map((f) => (
                  <span key={f} className="df-chip-pill">{f}</span>
                ))}
              </div>
              <p className="text-[11px] px-2" style={{ color: 'var(--text-muted)' }}>
                Up to 20&nbsp;MB · {ACCEPTED_EXTENSIONS.length} file types
              </p>
            </div>

            <div className="space-y-2">
              <p className="df-side-label px-2">Engine</p>
              <div className="px-2 space-y-1">
                <p className="text-sm font-medium" style={{ color: 'var(--text)' }}>Surya OCR 2</p>
                <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                  Self-hosted · fully private. Documents never leave your machine.
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <p className="df-side-label px-2">Exports</p>
              <div className="flex flex-wrap gap-1.5 px-2">
                {['CSV', 'Excel', 'Markdown', 'HTML'].map((f) => (
                  <span key={f} className="df-chip-pill">{f}</span>
                ))}
              </div>
            </div>
          </>
        )}
      </div>

      {/* Footer */}
      {!collapsed && (
        <div className="px-4 py-3" style={{ borderTop: '1px solid var(--border)' }}>
          <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
            DocuForge · local document parser
          </p>
        </div>
      )}
    </aside>
  );
}
