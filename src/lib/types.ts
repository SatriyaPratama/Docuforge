// Block types
export type BlockType =
  | 'PageHeader'
  | 'SectionHeader'
  | 'Text'
  | 'Table'
  | 'Figure'
  | 'FigureGroup'
  | 'FigureCaption'
  | 'PageFooter'
  | 'Page'
  | 'Unknown';

// Raw OCR response shapes
/** A single block element returned by the OCR engine */
export interface RawBlockItem {
  kind: string;
  bbox: [number, number, number, number];
  confidence?: number | null;
  row_id?: number;
  col_id?: number;
  cell_id?: number;
}

export interface RawBlock {
  block_type: string;
  html: string;
  markdown?: string;
  bbox?: [number, number, number, number];
  confidence?: number | null;
  id?: string;
  page_id?: number;
  section_hierarchy?: Record<string, string>;
  images?: unknown[];
  table_of_contents?: unknown[];
  items?: RawBlockItem[];
}

/** Raw page object returned by the OCR engine */
export interface RawPage {
  id?: number;
  page_id?: number;
  width?: number | null;
  height?: number | null;
  children?: RawBlock[];
  blocks?: RawBlock[];
  html?: string;
  markdown?: string;
}

/** Top-level OCR API response (all three recognized shapes) */
export interface OcrApiResponse {
  pages?: RawPage[];        // shape 1: {pages:[]}
  children?: RawBlock[];    // shape 2: {children:[]}
  blocks?: RawBlock[];      // shape 3: {blocks:[]}
  html?: string;
  markdown?: string;
}

// Parsed and normalized types
export interface ParsedBlock {
  id: string;
  type: BlockType;
  html: string;
  markdown: string;
  /** Extracted table rows, if type === 'Table' */
  tableData?: string[][];
  bbox?: [number, number, number, number];
  /** Mean OCR confidence for the block (0-1), when the engine reports it */
  confidence?: number | null;
  /** Table/list item boxes supplied by the OCR engine, when available. */
  items?: RawBlockItem[];
}

export interface ParsedPage {
  /** Zero-based index of the page in the ORIGINAL document (from page_id), not the array position. */
  pageIndex: number;
  blocks: ParsedBlock[];
  /** Number of Table blocks on this page */
  tableCount: number;
  /** Pixel width/height of the OCR-rendered page image (for scaling bbox overlays) */
  width?: number | null;
  height?: number | null;
}

export type CorrectionTarget = 'block' | 'table-cell';

export interface CorrectionPatch {
  pageIndex: number;
  blockId: string;
  target: CorrectionTarget;
  rowIndex?: number;
  columnIndex?: number;
  originalValue: string;
  correctedValue: string;
}

export interface BlockMerge {
  pageIndex: number;
  blockIds: string[];
}

export interface EditSnapshot {
  corrections: CorrectionPatch[];
  blockMerges: BlockMerge[];
}

export interface DocumentSession {
  documentHash: string;
  filename: string;
  originalPages: ParsedPage[];
  corrections: CorrectionPatch[];
  blockMerges?: BlockMerge[];
  createdAt: number;
  updatedAt: number;
  /** Explicit review acknowledgements; corrections are derived separately. */
  reviewDecisions?: ReviewDecision[];
}

export interface ReviewDecision {
  blockRef: string;
  status: 'approved';
  updatedAt: number;
}

export type ParseStage = 'idle' | 'uploading' | 'planning' | 'parsing' | 'preparing-results' | 'cancelling';

export interface AppError {
  message: string;
  requestId?: string;
  status?: number;
  retryAfterSeconds?: number;
  retryable?: boolean;
}

// Configuration
// Only options the backend actually implements are exposed here.
export interface AdditionalConfig {
  /** Bypass the backend's content-hash result cache */
  skipCache: boolean;
  /** Retain page header blocks in output */
  keepHeader: boolean;
  /** Retain page footer blocks in output */
  keepFooter: boolean;
}

export interface AppConfig {
  /** Page range string: '' | 'N' | 'N-M' (zero-indexed) */
  pageRange: string;
  additional: AdditionalConfig;
}

// App state
export type AppScreen = 'upload' | 'parsing' | 'results';

export interface AppState {
  screen: AppScreen;
  file: File | null;
  documentFilename: string | null;
  config: AppConfig;
  pages: ParsedPage[];
  /** Index of the currently visible page (0-based) */
  currentPage: number;
  error: string | null;
  errorDetail: AppError | null;
  parsingProgress: number; // 0–100
  /** Human-readable progress detail during parsing (e.g. chunk N of M) */
  parsingDetail: string;
  /** Current stage of the parsing pipeline. */
  parsingStage: ParseStage;
  /** Page count of the selected document (null until computed) */
  docPageCount: number | null;
  /** Stable reference for the result block currently under the pointer. */
  hoveredBlockRef: string | null;
  /** Stable reference for the result block currently selected. */
  selectedBlockRef: string | null;
  /** SHA-256 identity used to keep local corrections document-specific. */
  documentHash: string | null;
  /** Immutable-page overlay patches; raw OCR remains in `pages`. */
  corrections: CorrectionPatch[];
  /** Reversible structural groups that combine adjacent OCR blocks. */
  blockMerges: BlockMerge[];
  /** Past/future correction snapshots for local undo/redo. */
  correctionHistory: EditSnapshot[];
  correctionFuture: EditSnapshot[];
  correctionPersistence: 'idle' | 'loading' | 'saving' | 'saved' | 'error';
  correctionLastSavedAt: number | null;
  correctionStorageError: string | null;
  correctionSaveEnabled: boolean;
  reviewDecisions: ReviewDecision[];
  /** Incremented whenever a fresh OCR result replaces the current document session. */
  correctionSessionVersion: number;
}

// App actions
export type BaseAppAction =
  | { type: 'SET_FILE'; payload: File }
  | { type: 'CLEAR_FILE' }
  | { type: 'SET_SCREEN'; payload: AppScreen }
  | { type: 'SET_PAGES'; payload: { pages: ParsedPage[]; documentHash: string; filename: string } }
  | { type: 'SET_CURRENT_PAGE'; payload: number }
  | { type: 'SET_CONFIG'; payload: Partial<AppConfig> }
  | { type: 'SET_ADDITIONAL_CONFIG'; payload: Partial<AdditionalConfig> }
  | { type: 'SET_ERROR'; payload: string | null }
  | { type: 'SET_ERROR_DETAIL'; payload: AppError | null }
  | { type: 'SET_PROGRESS'; payload: number }
  | { type: 'SET_PARSE_DETAIL'; payload: string }
  | { type: 'SET_PARSE_STAGE'; payload: ParseStage }
  | { type: 'SET_DOC_PAGE_COUNT'; payload: number | null }
  | { type: 'SET_HOVERED_BLOCK'; payload: string | null }
  | { type: 'SET_SELECTED_BLOCK'; payload: string | null };

export type CorrectionAction =
  | { type: 'HYDRATE_CORRECTIONS'; payload: { documentHash: string; corrections: CorrectionPatch[]; blockMerges?: BlockMerge[]; reviewDecisions?: ReviewDecision[] } }
  | { type: 'RESTORE_DOCUMENT_SESSION'; payload: DocumentSession }
  | { type: 'UPSERT_CORRECTIONS'; payload: CorrectionPatch[] }
  | { type: 'MERGE_BLOCKS'; payload: { pageIndex: number; firstBlockId: string; secondBlockId: string } }
  | { type: 'RESET_BLOCK_CORRECTIONS'; payload: { pageIndex: number; blockId: string } }
  | { type: 'RESET_ALL_CORRECTIONS' }
  | { type: 'UNDO_CORRECTION' }
  | { type: 'REDO_CORRECTION' }
  | { type: 'DELETE_LOCAL_CORRECTION_DATA' }
  | { type: 'SET_REVIEW_DECISION'; payload: ReviewDecision }
  | { type: 'SET_CORRECTION_PERSISTENCE'; payload: Partial<Pick<AppState, 'correctionPersistence' | 'correctionLastSavedAt' | 'correctionStorageError'>> };

export type AppAction = BaseAppAction | CorrectionAction;
