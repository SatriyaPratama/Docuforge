import type { NextRequest } from 'next/server';
import { randomUUID } from 'node:crypto';
import { getOcrDocumentsUrl } from '@/lib/ocrEndpoint';
import { FILE_TOO_LARGE_MESSAGE, MAX_FILE_BYTES, sniffFileKind, UNSUPPORTED_TYPE_MESSAGE } from '@/lib/fileConstraints';

const DOCUMENT_REQUEST_TIMEOUT_MS = 600_000;

function errorJson(message: string, status: number, requestId: string) {
  return Response.json({ error: message, requestId }, { status });
}

export async function POST(req: NextRequest) {
  const requestId = randomUUID();
  let payload: FormData;
  try {
    payload = await req.formData();
  } catch {
    return errorJson('Invalid form data', 400, requestId);
  }

  const file = payload.get('file');
  if (!(file instanceof File)) return errorJson('No file provided', 400, requestId);
  if (file.size > MAX_FILE_BYTES) return errorJson(FILE_TOO_LARGE_MESSAGE, 400, requestId);

  const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  if (!sniffFileKind(head)) return errorJson(UNSUPPORTED_TYPE_MESSAGE, 400, requestId);

  const upstreamForm = new FormData();
  upstreamForm.append('file', file);

  let upstream: Response;
  try {
    upstream = await fetch(getOcrDocumentsUrl(), {
      method: 'POST',
      body: upstreamForm,
      headers: { 'X-Request-ID': requestId },
      signal: AbortSignal.any([req.signal, AbortSignal.timeout(DOCUMENT_REQUEST_TIMEOUT_MS)]),
    });
  } catch {
    return errorJson('OCR service is unavailable. Try again shortly.', 503, requestId);
  }

  if (!upstream.ok) {
    let detail = 'Document upload failed upstream.';
    try {
      const data = (await upstream.json()) as { detail?: unknown; error?: unknown };
      if (typeof data.detail === 'string') detail = data.detail;
      else if (typeof data.error === 'string') detail = data.error;
    } catch {
      // Keep the generic message.
    }
    return errorJson(detail, upstream.status >= 500 ? 502 : upstream.status, requestId);
  }

  return new Response(await upstream.arrayBuffer(), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'X-Request-ID': requestId },
  });
}
