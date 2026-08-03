import type { BlockMerge, CorrectionPatch, DocumentSession, ParsedPage, ReviewDecision } from '@/lib/types';

const DB_NAME = 'docuforge-corrections';
const LEGACY_STORE = 'sessions';
const DOCUMENT_STORE = 'documents';
const EDIT_STORE = 'edits';
const DB_VERSION = 2;
const LAST_DOCUMENT_KEY = 'docuforge:last-document-hash';

interface StoredDocument {
  documentHash: string;
  filename: string;
  originalPages: ParsedPage[];
  createdAt: number;
}

interface StoredEdits {
  documentHash: string;
  corrections: CorrectionPatch[];
  blockMerges: BlockMerge[];
  reviewDecisions: ReviewDecision[];
  updatedAt: number;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') return Promise.reject(new Error('IndexedDB is unavailable in this browser.'));
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error ?? new Error('Could not open local correction storage.'));
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(LEGACY_STORE)) db.createObjectStore(LEGACY_STORE, { keyPath: 'documentHash' });
      if (!db.objectStoreNames.contains(DOCUMENT_STORE)) db.createObjectStore(DOCUMENT_STORE, { keyPath: 'documentHash' });
      if (!db.objectStoreNames.contains(EDIT_STORE)) db.createObjectStore(EDIT_STORE, { keyPath: 'documentHash' });
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => { db.close(); dbPromise = null; };
      resolve(db);
    };
  });
  return dbPromise;
}

function requestValue<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onerror = () => reject(request.error ?? new Error('Local storage operation failed.'));
    request.onsuccess = () => resolve(request.result);
  });
}

export async function loadCorrectionSession(documentHash: string): Promise<DocumentSession | null> {
  const db = await openDb();
  const tx = db.transaction([DOCUMENT_STORE, EDIT_STORE, LEGACY_STORE], 'readonly');
  const [document, edits, legacy] = await Promise.all([
    requestValue(tx.objectStore(DOCUMENT_STORE).get(documentHash) as IDBRequest<StoredDocument | undefined>),
    requestValue(tx.objectStore(EDIT_STORE).get(documentHash) as IDBRequest<StoredEdits | undefined>),
    requestValue(tx.objectStore(LEGACY_STORE).get(documentHash) as IDBRequest<DocumentSession | undefined>),
  ]);
  if (document) {
    return {
      documentHash,
      filename: document.filename,
      originalPages: document.originalPages,
      corrections: edits?.corrections ?? [],
      blockMerges: edits?.blockMerges ?? [],
      reviewDecisions: edits?.reviewDecisions ?? [],
      createdAt: document.createdAt,
      updatedAt: edits?.updatedAt ?? document.createdAt,
    };
  }
  if (!legacy) return null;
  // Read compatibility first; the next save writes the split representation.
  return { ...legacy, reviewDecisions: legacy.reviewDecisions ?? [] };
}

export async function saveCorrectionSession(session: DocumentSession): Promise<void> {
  const db = await openDb();
  const readTx = db.transaction(DOCUMENT_STORE, 'readonly');
  const existing = await requestValue(readTx.objectStore(DOCUMENT_STORE).get(session.documentHash) as IDBRequest<StoredDocument | undefined>);
  const tx = db.transaction([DOCUMENT_STORE, EDIT_STORE], 'readwrite');
  const documentStore = tx.objectStore(DOCUMENT_STORE);
  if (!existing) {
    await requestValue(documentStore.put({
      documentHash: session.documentHash,
      filename: session.filename,
      originalPages: session.originalPages,
      createdAt: session.createdAt,
    } satisfies StoredDocument));
  }
  await requestValue(tx.objectStore(EDIT_STORE).put({
    documentHash: session.documentHash,
    corrections: session.corrections,
    blockMerges: session.blockMerges ?? [],
    reviewDecisions: session.reviewDecisions ?? [],
    updatedAt: session.updatedAt,
  } satisfies StoredEdits));
  try { localStorage.setItem(LAST_DOCUMENT_KEY, session.documentHash); } catch { /* storage may be disabled */ }
}

export function getLastDocumentHash(): string | null {
  try { return localStorage.getItem(LAST_DOCUMENT_KEY); } catch { return null; }
}

export async function deleteCorrectionSession(documentHash: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction([DOCUMENT_STORE, EDIT_STORE, LEGACY_STORE], 'readwrite');
  await Promise.all([
    requestValue(tx.objectStore(DOCUMENT_STORE).delete(documentHash)),
    requestValue(tx.objectStore(EDIT_STORE).delete(documentHash)),
    requestValue(tx.objectStore(LEGACY_STORE).delete(documentHash)),
  ]);
  try {
    if (localStorage.getItem(LAST_DOCUMENT_KEY) === documentHash) localStorage.removeItem(LAST_DOCUMENT_KEY);
  } catch { /* storage may be disabled */ }
}
