export interface UploadedDocument {
  documentId: string;
  contentSha256: string;
  pageCount: number;
}

function errorMessage(payload: unknown): string {
  if (payload && typeof payload === 'object') {
    const value = payload as { error?: unknown; detail?: unknown; requestId?: unknown };
    const message = typeof value.error === 'string'
      ? value.error
      : typeof value.detail === 'string'
        ? value.detail
        : 'Document upload failed.';
    const suffix = value.requestId ? ` (ref ${String(value.requestId).slice(0, 8)})` : '';
    return `${message}${suffix}`;
  }
  return 'Document upload failed.';
}

export async function uploadDocument(file: File, signal: AbortSignal): Promise<UploadedDocument> {
  const form = new FormData();
  form.append('file', file);
  const response = await fetch('/api/documents', { method: 'POST', body: form, signal });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(errorMessage(payload));

  const data = payload as {
    document_id?: unknown;
    content_sha256?: unknown;
    page_count?: unknown;
  } | null;
  if (!data || typeof data.document_id !== 'string' || typeof data.content_sha256 !== 'string' || typeof data.page_count !== 'number') {
    throw new Error('OCR service returned an invalid document handle.');
  }
  return {
    documentId: data.document_id,
    contentSha256: data.content_sha256,
    pageCount: data.page_count,
  };
}

/** Best-effort cleanup; the OCR service also expires abandoned documents. */
export async function releaseDocument(documentId: string): Promise<void> {
  await fetch(`/api/documents/${encodeURIComponent(documentId)}`, { method: 'DELETE' }).catch(() => undefined);
}
