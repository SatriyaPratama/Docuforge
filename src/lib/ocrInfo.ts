'use client';

/** OCR service capabilities, fetched once and cached for the session. */
export interface OcrInfo {
  backend: string;
  device: string;
  maxPages: number;
  chunkSize: number;
  concurrency: number;
  maxUploadBytes: number;
}

const FALLBACK: OcrInfo = {
  backend: 'unknown',
  device: 'cpu',
  maxPages: 50,
  chunkSize: 25,
  concurrency: 1,
  maxUploadBytes: 20 * 1024 * 1024,
};

let cached: OcrInfo | null = null;

/**
 * Fetch OCR capabilities. Only a *real* reading (backend !== 'unknown') is
 * cached; if the OCR service wasn't reachable yet we return the fallback
 * without caching, so a later call re-reads the true backend/limits.
 */
export async function getOcrInfo(): Promise<OcrInfo> {
  if (cached) return cached;
  try {
    const res = await fetch('/api/ocr-info');
    if (res.ok) {
      const d = (await res.json()) as Partial<OcrInfo>;
      const info = { ...FALLBACK, ...d };
      if (info.backend && info.backend !== 'unknown') {
        cached = info; // cache only a confirmed reading
      }
      return info;
    }
  } catch {
    // fall through to fallback (not cached)
  }
  return FALLBACK;
}

/** Human-readable label for the active inference device + backend. */
export function backendLabel(info: Pick<OcrInfo, 'backend' | 'device'>): string {
  const engine =
    info.backend === 'vllm'
      ? 'vLLM'
      : info.backend === 'llamacpp'
        ? 'llama.cpp'
        : info.backend === 'unknown'
          ? 'local'
          : info.backend;
  const device = info.device === 'gpu' ? 'GPU' : 'CPU';
  return `${device} · ${engine}`;
}
