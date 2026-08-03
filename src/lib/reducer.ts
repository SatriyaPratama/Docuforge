import { DEFAULT_CONFIG } from '@/lib/defaults';
import { mergeBlockGroups, mergeCorrectionPatches, resetBlockMerges } from '@/lib/corrections';
import type { AppAction, AppConfig, AppState, CorrectionPatch } from '@/lib/types';

const MAX_CORRECTION_HISTORY = 100;

function withEditChange(state: AppState, corrections: CorrectionPatch[], blockMerges: AppState['blockMerges']): AppState {
  if (corrections === state.corrections && blockMerges === state.blockMerges) return state;
  return {
    ...state,
    corrections,
    blockMerges,
    correctionHistory: [...state.correctionHistory, { corrections: state.corrections, blockMerges: state.blockMerges }].slice(-MAX_CORRECTION_HISTORY),
    correctionFuture: [],
    correctionPersistence: 'idle',
    correctionStorageError: null,
    correctionSaveEnabled: true,
  };
}

export function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'SET_FILE':
      return {
        ...state,
        file: action.payload,
        documentFilename: action.payload.name,
        error: null,
        errorDetail: null,
        parsingStage: 'idle',
        docPageCount: null,
        parsingDetail: '',
        hoveredBlockRef: null,
        selectedBlockRef: null,
        documentHash: null,
        corrections: [],
        blockMerges: [],
        correctionHistory: [],
        correctionFuture: [],
        correctionPersistence: 'idle',
        correctionLastSavedAt: null,
        correctionStorageError: null,
        correctionSaveEnabled: false,
        reviewDecisions: [],
        correctionSessionVersion: state.correctionSessionVersion + 1,
      };

    case 'CLEAR_FILE':
      return {
        ...state,
        file: null,
        documentFilename: null,
        pages: [],
        screen: 'upload',
        error: null,
        errorDetail: null,
        parsingProgress: 0,
        parsingDetail: '',
        parsingStage: 'idle',
        docPageCount: null,
        hoveredBlockRef: null,
        selectedBlockRef: null,
        documentHash: null,
        corrections: [],
        blockMerges: [],
        correctionHistory: [],
        correctionFuture: [],
        correctionPersistence: 'idle',
        correctionLastSavedAt: null,
        correctionStorageError: null,
        correctionSaveEnabled: false,
        reviewDecisions: [],
        correctionSessionVersion: state.correctionSessionVersion + 1,
      };

    case 'SET_SCREEN':
      return { ...state, screen: action.payload };

    case 'SET_PAGES':
      return {
        ...state,
        pages: action.payload.pages,
        documentHash: action.payload.documentHash,
        documentFilename: action.payload.filename,
        currentPage: 0,
        screen: 'results',
        hoveredBlockRef: null,
        selectedBlockRef: null,
        corrections: [],
        blockMerges: [],
        correctionHistory: [],
        correctionFuture: [],
        correctionPersistence: 'idle',
        correctionLastSavedAt: null,
        correctionStorageError: null,
        correctionSaveEnabled: false,
        reviewDecisions: [],
        correctionSessionVersion: state.correctionSessionVersion + 1,
      };

    case 'SET_CURRENT_PAGE':
      return { ...state, currentPage: action.payload };

    case 'SET_CONFIG':
      return { ...state, config: { ...state.config, ...action.payload } };

    case 'SET_ADDITIONAL_CONFIG':
      return {
        ...state,
        config: {
          ...state.config,
          additional: { ...state.config.additional, ...action.payload },
        },
      };

    case 'SET_ERROR':
      return {
        ...state,
        error: action.payload,
        errorDetail: action.payload ? { message: action.payload } : null,
        screen: action.payload ? 'upload' : state.screen,
        parsingStage: action.payload ? 'idle' : state.parsingStage,
      };

    case 'SET_ERROR_DETAIL':
      return {
        ...state,
        error: action.payload?.message ?? null,
        errorDetail: action.payload,
        screen: action.payload ? 'upload' : state.screen,
        parsingStage: action.payload ? 'idle' : state.parsingStage,
      };

    case 'SET_PROGRESS':
      return { ...state, parsingProgress: action.payload };

    case 'SET_PARSE_DETAIL':
      return { ...state, parsingDetail: action.payload };

    case 'SET_PARSE_STAGE':
      return { ...state, parsingStage: action.payload };

    case 'SET_DOC_PAGE_COUNT':
      return { ...state, docPageCount: action.payload };

    case 'SET_HOVERED_BLOCK':
      return { ...state, hoveredBlockRef: action.payload };

    case 'SET_SELECTED_BLOCK':
      return { ...state, selectedBlockRef: action.payload };

    case 'HYDRATE_CORRECTIONS':
      if (state.documentHash !== action.payload.documentHash) return state;
      return {
        ...state,
        corrections: action.payload.corrections,
        blockMerges: action.payload.blockMerges ?? [],
        correctionHistory: [],
        correctionFuture: [],
        correctionPersistence: action.payload.corrections.length ? 'saved' : 'idle',
        correctionLastSavedAt: action.payload.corrections.length ? Date.now() : null,
        correctionStorageError: null,
        correctionSaveEnabled: true,
        reviewDecisions: action.payload.reviewDecisions ?? [],
      };

    case 'RESTORE_DOCUMENT_SESSION':
      return {
        ...state,
        file: null,
        documentFilename: action.payload.filename,
        pages: action.payload.originalPages,
        documentHash: action.payload.documentHash,
        corrections: action.payload.corrections,
        blockMerges: action.payload.blockMerges ?? [],
        correctionHistory: [],
        correctionFuture: [],
        correctionPersistence: action.payload.corrections.length ? 'saved' : 'idle',
        correctionLastSavedAt: action.payload.updatedAt,
        correctionStorageError: null,
        correctionSaveEnabled: true,
        reviewDecisions: action.payload.reviewDecisions ?? [],
        correctionSessionVersion: state.correctionSessionVersion + 1,
        screen: 'results',
        currentPage: 0,
      };

    case 'UPSERT_CORRECTIONS':
      return withEditChange(state, mergeCorrectionPatches(state.corrections, action.payload), state.blockMerges);

    case 'MERGE_BLOCKS':
      return withEditChange(
        state,
        state.corrections,
        mergeBlockGroups(state.blockMerges, action.payload.pageIndex, action.payload.firstBlockId, action.payload.secondBlockId),
      );

    case 'RESET_BLOCK_CORRECTIONS':
      {
        const mergedGroup = state.blockMerges.find((merge) => merge.pageIndex === action.payload.pageIndex && merge.blockIds.includes(action.payload.blockId));
        const resetIds = new Set(mergedGroup?.blockIds ?? [action.payload.blockId]);
        return withEditChange(
          state,
          state.corrections.filter((patch) => patch.pageIndex !== action.payload.pageIndex || !resetIds.has(patch.blockId)),
          resetBlockMerges(state.blockMerges, action.payload.pageIndex, action.payload.blockId),
        );
      }

    case 'RESET_ALL_CORRECTIONS':
      return withEditChange(state, [], []);

    case 'UNDO_CORRECTION': {
      const previous = state.correctionHistory[state.correctionHistory.length - 1];
      if (!previous) return state;
      return {
        ...state,
        corrections: previous.corrections,
        blockMerges: previous.blockMerges,
        correctionHistory: state.correctionHistory.slice(0, -1),
        correctionFuture: [{ corrections: state.corrections, blockMerges: state.blockMerges }, ...state.correctionFuture].slice(0, MAX_CORRECTION_HISTORY),
        correctionPersistence: 'idle',
        correctionSaveEnabled: true,
      };
    }

    case 'REDO_CORRECTION': {
      const next = state.correctionFuture[0];
      if (!next) return state;
      return {
        ...state,
        corrections: next.corrections,
        blockMerges: next.blockMerges,
        correctionHistory: [...state.correctionHistory, { corrections: state.corrections, blockMerges: state.blockMerges }].slice(-MAX_CORRECTION_HISTORY),
        correctionFuture: state.correctionFuture.slice(1),
        correctionPersistence: 'idle',
        correctionSaveEnabled: true,
      };
    }

    case 'DELETE_LOCAL_CORRECTION_DATA':
      return {
        ...state,
        corrections: [],
        blockMerges: [],
        correctionHistory: [],
        correctionFuture: [],
        correctionPersistence: 'idle',
        correctionLastSavedAt: null,
        correctionStorageError: null,
        correctionSaveEnabled: false,
        reviewDecisions: [],
      };

    case 'SET_REVIEW_DECISION': {
      const decisions = state.reviewDecisions.filter((decision) => decision.blockRef !== action.payload.blockRef);
      return { ...state, reviewDecisions: [...decisions, action.payload], correctionSaveEnabled: true, correctionPersistence: 'idle' };
    }

    case 'SET_CORRECTION_PERSISTENCE':
      return { ...state, ...action.payload };

    default:
      return state;
  }
}

export function makeInitialState(): AppState {
  return {
    screen: 'upload',
    file: null,
    documentFilename: null,
    config: DEFAULT_CONFIG as AppConfig,
    pages: [],
    currentPage: 0,
    error: null,
    errorDetail: null,
    parsingProgress: 0,
    parsingDetail: '',
    parsingStage: 'idle',
    docPageCount: null,
    hoveredBlockRef: null,
    selectedBlockRef: null,
    documentHash: null,
    corrections: [],
    blockMerges: [],
    correctionHistory: [],
    correctionFuture: [],
    correctionPersistence: 'idle',
    correctionLastSavedAt: null,
    correctionStorageError: null,
    correctionSaveEnabled: false,
    reviewDecisions: [],
    correctionSessionVersion: 0,
  };
}
