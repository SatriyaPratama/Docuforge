'use client';

import { useEffect, useState } from 'react';
import { useAppState } from '@/context/AppContext';
import ErrorBoundary from '@/components/ErrorBoundary';
import Sidebar from '@/components/Sidebar';
import Topbar from '@/components/Topbar';
import WorkspaceCenter from '@/components/workspace/WorkspaceCenter';
import ConfigurationPanel from '@/components/panels/ConfigurationPanel';
import ResultsPanel from '@/components/panels/ResultsPanel';
import ReviewPanel from '@/components/panels/ReviewPanel';
import SearchDialog from '@/components/SearchDialog';
import AppNotice from '@/components/AppNotice';
import BatchQueue from '@/components/batch/BatchQueue';

type RightTab = 'config' | 'results' | 'review';

export default function Home() {
  const { screen, pages } = useAppState();
  const [rightTab, setRightTab] = useState<RightTab>('config');

  const hasResults = pages.length > 0;

  // Surface results automatically once a parse completes; fall back to config
  // whenever results are cleared (e.g. New File).
  useEffect(() => {
    if (screen === 'results' && hasResults) setRightTab('results');
    else if (!hasResults) setRightTab('config');
  }, [screen, hasResults]);

  return (
    <ErrorBoundary>
      <div className="df-shell">
        <SearchDialog />
        <AppNotice />
        <BatchQueue />
        <Sidebar />
        <div className="df-workspace">
          <Topbar />
          <div className="df-split">
            <div className="df-center">
              <WorkspaceCenter />
            </div>
            <div className="df-rightpanel">
              <div className="df-panel-tabs" role="tablist" aria-label="Panel">
                <button
                  type="button"
                  role="tab"
                  aria-selected={rightTab === 'config'}
                  className="df-panel-tab"
                  data-active={rightTab === 'config'}
                  onClick={() => setRightTab('config')}
                >
                  Configuration
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={rightTab === 'results'}
                  className="df-panel-tab"
                  data-active={rightTab === 'results'}
                  disabled={!hasResults}
                  onClick={() => hasResults && setRightTab('results')}
                >
                  Results
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={rightTab === 'review'}
                  className="df-panel-tab"
                  data-active={rightTab === 'review'}
                  disabled={!hasResults}
                  onClick={() => hasResults && setRightTab('review')}
                >
                  Review
                </button>
              </div>
              <div className="flex-1 min-h-0">
                {rightTab === 'results' && hasResults ? <ResultsPanel /> : rightTab === 'review' && hasResults ? <ReviewPanel /> : <ConfigurationPanel />}
              </div>
            </div>
          </div>
        </div>
      </div>
    </ErrorBoundary>
  );
}
