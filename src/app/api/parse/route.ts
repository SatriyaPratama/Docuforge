import type { NextRequest } from 'next/server';
import { createHash, randomUUID } from 'node:crypto';
import { buildFormData } from '@/lib/buildFormData';
import { DEFAULT_CONFIG } from '@/lib/defaults';
import { getOcrMarkerUrl } from '@/lib/ocrEndpoint';
import {
  FILE_TOO_LARGE_MESSAGE,
  MAX_FILE_BYTES,
  sniffFileKind,
  UNSUPPORTED_TYPE_MESSAGE,
} from '@/lib/fileConstraints';
import type { AdditionalConfig, AppConfig } from '@/lib/types';

// Upper bound per upstream request. Chunks are small (CPU default 4 pages) so
// normal requests finish far sooner; this mainly caps the unknown-page-count
// single-request fallback. Streaming relies on client cancel for liveness.
const OCR_REQUEST_TIMEOUT_MS = 1_800_000;

function parseConfig(rawValue: FormDataEntryValue | null): AppConfig {
  if (!rawValue || typeof rawValue !== 'string') {
    return DEFAULT_CONFIG;
  }

  try {
    const parsedConfig = JSON.parse(rawValue) as Partial<AppConfig>;
    const parsedAdditional = (parsedConfig.additional ?? {}) as Partial<AdditionalConfig>;

    const normalisedAdditional: AdditionalConfig = {
      skipCache: parsedAdditional.skipCache === true,
      keepHeader: parsedAdditional.keepHeader !== false,
      keepFooter: parsedAdditional.keepFooter !== false,
    };

    return {
      pageRange:
        typeof parsedConfig.pageRange === 'string' && /^(\d+)(-\d+)?$/.test(parsedConfig.pageRange.trim())
          ? parsedConfig.pageRange.trim()
          : '',
      additional: normalisedAdditional,
    };
  } catch {
    return DEFAULT_CONFIG;
  }
}

interface LogEntry {
  timestamp: string;
  requestId: string;
  event: string;
  [key: string]: unknown;
}

function log(entry: Omit<LogEntry, 'timestamp'>) {
  console.log(JSON.stringify({ timestamp: new Date().toISOString(), ...entry }));
}

function errorJson(message: string, status: number, requestId: string) {
  return Response.json({ error: message, requestId }, { status });
}

export async function POST(req: NextRequest) {
  const startedAt = Date.now();
  const requestId = randomUUID();
  const OCR_URL = getOcrMarkerUrl();

  let formPayload: FormData;
  try {
    formPayload = await req.formData();
  } catch {
    return errorJson('Invalid form data', 400, requestId);
  }

  const fileEntry = formPayload.get('file');
  const documentEntry = formPayload.get('document_id');
  const documentId = typeof documentEntry === 'string' ? documentEntry.trim() : '';
  const hasFile = fileEntry instanceof File;
  if (hasFile && documentId) {
    return errorJson('Send either file or document_id, not both', 400, requestId);
  }
  if (!hasFile && !documentId) {
    return errorJson('No file provided', 400, requestId);
  }

  if (hasFile && fileEntry.size > MAX_FILE_BYTES) {
    return errorJson(FILE_TOO_LARGE_MESSAGE, 400, requestId);
  }

  // Validate by content (magic bytes), not client-supplied MIME/extension.
  // Only the leading bytes are needed — avoid buffering the whole file here.
  let contentHash: string | undefined;
  if (hasFile) {
    const headBytes = new Uint8Array(await fileEntry.slice(0, 16).arrayBuffer());
    const kind = sniffFileKind(headBytes);
    if (!kind) {
      return errorJson(UNSUPPORTED_TYPE_MESSAGE, 400, requestId);
    }
  } else if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(documentId)) {
    return errorJson('Invalid document_id', 400, requestId);
  }

  // Cache-key material: trust a valid client-supplied hash (computed once for
  // the whole file) instead of re-hashing all bytes on every chunk request.
  const clientHash = formPayload.get('content_sha256');
  if (typeof clientHash === 'string' && /^[a-f0-9]{64}$/i.test(clientHash)) {
    contentHash = clientHash.toLowerCase();
  } else if (hasFile) {
    contentHash = createHash('sha256').update(new Uint8Array(await fileEntry.arrayBuffer())).digest('hex');
  }

  const wantStream = formPayload.get('stream') === 'true';
  const config = parseConfig(formPayload.get('config'));
  const upstreamForm = buildFormData(hasFile ? fileEntry : null, config, documentId || undefined);
  if (contentHash) upstreamForm.set('content_sha256', contentHash);
  const logContentHash = contentHash?.slice(0, 16) ?? 'document';
  if (wantStream) upstreamForm.set('stream', 'true');

  let upstream: globalThis.Response;
  try {
    upstream = await fetch(OCR_URL, {
      method: 'POST',
      body: upstreamForm,
      headers: { 'X-Request-ID': requestId },
      // Abort if the browser disconnects (user Cancel) or the hard cap elapses.
      signal: AbortSignal.any([req.signal, AbortSignal.timeout(OCR_REQUEST_TIMEOUT_MS)]),
    });
  } catch (err) {
    const isTimeout = err instanceof Error && err.name === 'TimeoutError';
    log({
      requestId,
      event: 'ocr_fetch_failed',
      contentHash: logContentHash,
      durationMs: Date.now() - startedAt,
      reason: isTimeout ? 'timeout' : 'unreachable',
    });
    if (isTimeout) {
      return errorJson(
        'Parsing timed out. The document may be too large — try a narrower page range.',
        504,
        requestId,
      );
    }
    return errorJson(
      'OCR service is unavailable. It may still be loading the model — try again shortly.',
      503,
      requestId,
    );
  }

  const durationMs = Date.now() - startedAt;

  if (!upstream.ok) {
    let detail = 'Parsing failed upstream.';
    try {
      const payload = (await upstream.json()) as { detail?: unknown; error?: unknown };
      if (typeof payload.detail === 'string') detail = payload.detail;
      else if (typeof payload.error === 'string') detail = payload.error;
    } catch {
      // keep generic message; never forward raw upstream bodies
    }
    log({
      requestId,
      event: 'ocr_parse_failed',
      contentHash: logContentHash,
      durationMs,
      status: upstream.status,
    });
    const status = upstream.status === 429 ? 429 : upstream.status >= 500 ? 502 : upstream.status;
    return errorJson(detail, status, requestId);
  }

  // Streaming passthrough: pipe the OCR NDJSON stream straight to the client.
  if (wantStream) {
    log({ requestId, event: 'ocr_stream_ok', contentHash: logContentHash, durationMs });
    return new Response(upstream.body, {
      headers: {
        'Content-Type': 'application/x-ndjson; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Request-ID': requestId,
      },
    });
  }

  let data: unknown;
  try {
    data = await upstream.json();
  } catch {
    log({ requestId, event: 'ocr_bad_json', contentHash: logContentHash, durationMs });
    return errorJson('OCR service returned an unreadable response.', 502, requestId);
  }

  const pageCount = Array.isArray((data as { pages?: unknown[] }).pages)
    ? (data as { pages: unknown[] }).pages.length
    : 1;

  log({
    requestId,
    event: 'ocr_parse_ok',
    contentHash: logContentHash,
    pageCount,
    durationMs,
    status: 200,
  });

  return Response.json(data, { headers: { 'X-Request-ID': requestId } });
}
