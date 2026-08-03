/**
 * Proxies the OCR service's /info so the browser can size chunks and show the
 * active backend without talking to the internal OCR service directly.
 */

const FALLBACK = {
  backend: 'unknown',
  device: 'cpu',
  maxPages: 50,
  chunkSize: 25,
  concurrency: 1,
  maxUploadBytes: 20 * 1024 * 1024,
};

function getOcrBase(): string {
  const raw = (process.env.OCR_ENDPOINT ?? 'http://localhost:8080').trim();
  return raw.replace(/\/+$/, '').replace(/\/api\/v1\/marker$/, '');
}

export async function GET() {
  try {
    const res = await fetch(`${getOcrBase()}/info`, {
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return Response.json(FALLBACK);
    const d = (await res.json()) as Record<string, unknown>;
    return Response.json({
      backend: typeof d.backend === 'string' ? d.backend : FALLBACK.backend,
      device: typeof d.device === 'string' ? d.device : FALLBACK.device,
      maxPages: Number(d.max_pages) || FALLBACK.maxPages,
      chunkSize: Number(d.chunk_size) || FALLBACK.chunkSize,
      concurrency: Number(d.concurrency) || FALLBACK.concurrency,
      maxUploadBytes: Number(d.max_upload_bytes) || FALLBACK.maxUploadBytes,
    });
  } catch {
    return Response.json(FALLBACK);
  }
}
