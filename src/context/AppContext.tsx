'use client';

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type Dispatch,
  type ReactNode,
} from 'react';
import { appReducer, makeInitialState } from '@/lib/reducer';
import { getLastDocumentHash, loadCorrectionSession, saveCorrectionSession } from '@/lib/correctionStore';
import type { AppAction, AppState } from '@/lib/types';

// State and dispatch live in separate contexts so components that only
// dispatch (buttons, toggles) do not re-render on every state change —
// notably the frequent SET_PROGRESS ticks during parsing.
const StateContext = createContext<AppState | null>(null);
const DispatchContext = createContext<Dispatch<AppAction> | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(appReducer, undefined, makeInitialState);
  const loadedHashRef = useRef<string | null>(null);
  const loadedSessionVersionRef = useRef<number | null>(null);
  const startupRestoreAttemptedRef = useRef(false);
  const loadRequestRef = useRef(0);
  const sessionMetaRef = useRef<{ documentHash: string; createdAt: number } | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (startupRestoreAttemptedRef.current || state.pages.length || state.documentHash) return;
    startupRestoreAttemptedRef.current = true;
    const lastHash = getLastDocumentHash();
    if (!lastHash) return;
    loadCorrectionSession(lastHash)
      .then((session) => {
        if (session?.originalPages?.length) dispatch({ type: 'RESTORE_DOCUMENT_SESSION', payload: session });
      })
      .catch(() => {
        // The session remains absent from the UI if local storage is unavailable.
      });
  }, [state.pages.length, state.documentHash]);

  useEffect(() => {
    const hash = state.documentHash;
    if (!hash || !state.pages.length || loadedSessionVersionRef.current === state.correctionSessionVersion) return;
    loadedHashRef.current = hash;
    loadedSessionVersionRef.current = state.correctionSessionVersion;
    const requestId = ++loadRequestRef.current;
    dispatch({ type: 'SET_CORRECTION_PERSISTENCE', payload: { correctionPersistence: 'loading', correctionStorageError: null } });
    loadCorrectionSession(hash)
      .then((session) => {
        if (requestId !== loadRequestRef.current) return;
        sessionMetaRef.current = session ? { documentHash: hash, createdAt: session.createdAt } : { documentHash: hash, createdAt: Date.now() };
        dispatch({
          type: 'HYDRATE_CORRECTIONS',
          payload: {
            documentHash: hash,
            corrections: session?.corrections ?? [],
            blockMerges: session?.blockMerges ?? [],
            reviewDecisions: session?.reviewDecisions ?? [],
          },
        });
      })
      .catch((error: unknown) => {
        if (requestId !== loadRequestRef.current) return;
        dispatch({
          type: 'SET_CORRECTION_PERSISTENCE',
          payload: { correctionPersistence: 'error', correctionStorageError: error instanceof Error ? error.message : 'Local save unavailable.' },
        });
      });
  }, [state.documentHash, state.pages, state.correctionSessionVersion]);

  useEffect(() => {
    const hash = state.documentHash;
    if (!hash || !state.pages.length || loadedHashRef.current !== hash || !state.correctionSaveEnabled) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      dispatch({ type: 'SET_CORRECTION_PERSISTENCE', payload: { correctionPersistence: 'saving', correctionStorageError: null } });
      const createdAt = sessionMetaRef.current?.documentHash === hash ? sessionMetaRef.current.createdAt : Date.now();
      saveCorrectionSession({
        documentHash: hash,
        filename: state.documentFilename ?? state.file?.name ?? 'parsed-document',
        originalPages: state.pages,
        corrections: state.corrections,
        blockMerges: state.blockMerges,
        reviewDecisions: state.reviewDecisions,
        createdAt,
        updatedAt: Date.now(),
      })
        .then(() => dispatch({ type: 'SET_CORRECTION_PERSISTENCE', payload: { correctionPersistence: 'saved', correctionLastSavedAt: Date.now(), correctionStorageError: null } }))
        .catch((error: unknown) => dispatch({
          type: 'SET_CORRECTION_PERSISTENCE',
          payload: { correctionPersistence: 'error', correctionStorageError: error instanceof Error ? error.message : 'Local save unavailable.' },
        }));
    }, 450);
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [state.documentHash, state.pages, state.corrections, state.blockMerges, state.reviewDecisions, state.correctionSaveEnabled, state.documentFilename, state.file?.name]);

  useEffect(() => () => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
  }, []);

  return (
    <DispatchContext.Provider value={dispatch}>
      <StateContext.Provider value={state}>{children}</StateContext.Provider>
    </DispatchContext.Provider>
  );
}

export function useAppState(): AppState {
  const ctx = useContext(StateContext);
  if (!ctx) throw new Error('useAppState must be used within AppProvider');
  return ctx;
}

export function useAppDispatch(): Dispatch<AppAction> {
  const ctx = useContext(DispatchContext);
  if (!ctx) throw new Error('useAppDispatch must be used within AppProvider');
  return ctx;
}

/** Convenience hook for components that need both state and dispatch. */
export function useApp(): { state: AppState; dispatch: Dispatch<AppAction> } {
  const state = useAppState();
  const dispatch = useAppDispatch();
  return useMemo(() => ({ state, dispatch }), [state, dispatch]);
}
