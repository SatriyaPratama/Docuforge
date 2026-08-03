'use client';

import { useCallback, useSyncExternalStore } from 'react';
import { useApp } from '@/context/AppContext';
import { parseOcrResponse } from '@/lib/parser';
import { beginParse, cancelActiveParse, endParse, isParseActive, subscribeToParseActivity } from '@/lib/parseClient';
import { getOcrInfo } from '@/lib/ocrInfo';
import { countPdfPages } from '@/lib/pdfPages';
import { releaseDocument, uploadDocument } from '@/lib/documentClient';
import type { AppConfig, OcrApiResponse, ParsedPage, RawBlock } from '@/lib/types';

interface Bounds {
  start: number; // inclusive, 0-based
  end: number; // inclusive, 0-based
}

/** Resolve the requested page window against the true page count. */
function resolveBounds(pageRange: string, total: number): Bounds | null {
  const text = pageRange.trim();
  if (!text) return { start: 0, end: total - 1 };
  const m = /^(\d+)(?:-(\d+))?$/.exec(text);
  if (!m) return null;
  const start = Number(m[1]);
  const end = m[2] !== undefined ? Number(m[2]) : start;
  if (start > end) return null;
  if (start > total - 1) return null; // window starts past the document
  return { start, end: Math.min(end, total - 1) };
}

/** Split a page window into contiguous "a-b"/"n" chunk range strings. */
function buildRanges(bounds: Bounds, chunkSize: number): string[] {
  const ranges: string[] = [];
  for (let s = bounds.start; s <= bounds.end; s += chunkSize) {
    const e = Math.min(s + chunkSize - 1, bounds.end);
    ranges.push(s === e ? String(s) : `${s}-${e}`);
  }
  return ranges;
}

/** Compact human ETA, e.g. "45s" or "3 min". */
function formatEta(ms: number): string {
  const s = Math.max(1, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  return `${Math.round(s / 60)} min`;
}

/**
 * Parse one chunk. Prefers the NDJSON stream (one line per page → `onPage()`
 * fires per page for live progress); transparently falls back to a single
 * JSON body if the response isn't a stream.
 */
async function parseChunkStreaming(
  documentId: string,
  config: AppConfig,
  range: string,
  contentHash: string,
  signal: AbortSignal,
  onPage: () => void,
): Promise<ParsedPage[]> {
  const form = new FormData();
  form.append('document_id', documentId);
  form.append('content_sha256', contentHash);
  form.append('config', JSON.stringify({ ...config, pageRange: range }));
  form.append('stream', 'true');

  const res = await fetch('/api/parse', { method: 'POST', body: form, signal });
  if (!res.ok) {
    const payload = await res
      .json()
      .catch(() => ({}) as { error?: string; requestId?: string });
    const suffix = payload.requestId ? ` (ref ${String(payload.requestId).slice(0, 8)})` : '';
    throw new Error((payload.error ?? 'Parsing request failed.') + suffix);
  }

  const contentType = res.headers.get('content-type') ?? '';
  if (!res.body || !contentType.includes('ndjson')) {
    // Non-stream fallback: whole JSON at once.
    const pages = parseOcrResponse(await res.json());
    pages.forEach(onPage);
    return pages;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const rawPages: { id?: number; page_id?: number; width?: number | null; height?: number | null; blocks?: RawBlock[] }[] = [];
  let buf = '';

  const handleLine = (raw: string) => {
    const s = raw.trim();
    if (!s) return;
    const evt = JSON.parse(s) as {
      type: string;
      id?: number;
      page_id?: number;
      width?: number | null;
      height?: number | null;
      blocks?: RawBlock[];
      detail?: string;
    };
    if (evt.type === 'page') {
      rawPages.push({ id: evt.id, page_id: evt.page_id, width: evt.width, height: evt.height, blocks: evt.blocks ?? [] });
      onPage();
    } else if (evt.type === 'error') {
      throw new Error(evt.detail || 'OCR inference failed.');
    }
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      handleLine(line);
    }
  }
  if (buf.trim()) handleLine(buf); // trailing line without newline

  const resp: OcrApiResponse = { pages: rawPages };
  return parseOcrResponse(resp);
}

/** Parse a document in backend-sized chunks and merge pages in source order. */
export function useParse() {
  const { state, dispatch } = useApp();
  const isParsing = useSyncExternalStore(subscribeToParseActivity, isParseActive, () => false);

  const parse = useCallback(
    async (fileOverride?: File) => {
      const file = fileOverride ?? state.file;
      if (!file || isParsing) return false;

      const config = state.config;
      const pr = config.pageRange.trim();
      if (pr && !/^(\d+)(-\d+)?$/.test(pr)) {
        dispatch({ type: 'SET_ERROR', payload: 'Page range must be zero-indexed, like 0-9 or 3.' });
        return false;
      }

      const controller = beginParse();
      if (!controller) return false;
      dispatch({ type: 'SET_SCREEN', payload: 'parsing' });
      dispatch({ type: 'SET_PARSE_STAGE', payload: 'uploading' });
      dispatch({ type: 'SET_PROGRESS', payload: 4 });
      dispatch({ type: 'SET_PARSE_DETAIL', payload: 'Uploading document once…' });

      const aborted = () => controller.signal.aborted;
      let uploaded: Awaited<ReturnType<typeof uploadDocument>> | null = null;
      let succeeded = false;

      try {
        // Read capabilities while the upload is in flight.
        const infoPromise = getOcrInfo();
        const uploadPromise = uploadDocument(file, controller.signal);
        uploaded = await uploadPromise;
        if (aborted()) throw new DOMException('Aborted', 'AbortError');

        dispatch({ type: 'SET_PARSE_STAGE', payload: 'planning' });
        dispatch({ type: 'SET_PARSE_DETAIL', payload: 'Preparing the OCR page plan…' });
        const info = await infoPromise;
        const counted = uploaded.pageCount > 0
          ? uploaded.pageCount
          : await countPdfPages(file);
        if (aborted()) throw new DOMException('Aborted', 'AbortError');

        // Build chunk ranges and determine the progress total.
        let ranges: string[];
        let knownTotal: number | null;
        if (counted == null) {
          ranges = [config.pageRange.trim()]; // '' = all pages; backend authoritative
          knownTotal = null;
        } else {
          dispatch({ type: 'SET_DOC_PAGE_COUNT', payload: counted });
          const bounds = resolveBounds(config.pageRange, counted);
          if (!bounds) throw new Error('Page range is outside the document.');
          const chunkSize = Math.max(1, Math.min(info.chunkSize || 25, info.maxPages || 50));
          ranges = buildRanges(bounds, chunkSize);
          knownTotal = bounds.end - bounds.start + 1;
        }
        const concurrency = Math.max(1, Math.min(info.concurrency || 1, ranges.length));

        // Set the parsing state before waiting on the first OCR request.
        dispatch({ type: 'SET_PARSE_STAGE', payload: 'parsing' });
        dispatch({ type: 'SET_PROGRESS', payload: 6 });
        dispatch({
          type: 'SET_PARSE_DETAIL',
          payload: knownTotal
            ? `Running OCR on ${knownTotal} page${knownTotal === 1 ? '' : 's'}…`
            : 'Running OCR…',
        });

        const results: ParsedPage[][] = new Array(ranges.length);
        const ocrStart = Date.now();
        let pagesDone = 0;
        const onPage = () => {
          pagesDone += 1;
          if (knownTotal) {
            dispatch({ type: 'SET_PROGRESS', payload: Math.min(99, 6 + Math.round((pagesDone / knownTotal) * 93)) });
            const remaining = knownTotal - pagesDone;
            let detail = `Parsed ${pagesDone} of ${knownTotal} pages`;
            if (remaining > 0) {
              const perPage = (Date.now() - ocrStart) / pagesDone;
              detail += ` · ~${formatEta(perPage * remaining)} left`;
            }
            dispatch({ type: 'SET_PARSE_DETAIL', payload: `${detail}…` });
          } else {
            dispatch({ type: 'SET_PARSE_DETAIL', payload: `Parsed ${pagesDone} page${pagesDone === 1 ? '' : 's'}…` });
          }
        };

        // Bounded-concurrency worker pool.
        let next = 0;
        const workers = Array.from({ length: concurrency }, async () => {
          for (let i = next++; i < ranges.length; i = next++) {
            results[i] = await parseChunkStreaming(uploaded!.documentId, config, ranges[i], uploaded!.contentSha256, controller.signal, onPage);
          }
        });
        await Promise.all(workers);

        const merged = results.flat().sort((a, b) => a.pageIndex - b.pageIndex);
        if (!merged.length) {
          throw new Error('No parseable content was returned. Try different settings or another file.');
        }

        dispatch({ type: 'SET_PARSE_STAGE', payload: 'preparing-results' });
        dispatch({ type: 'SET_PROGRESS', payload: 100 });
        dispatch({ type: 'SET_PARSE_DETAIL', payload: '' });
        dispatch({
          type: 'SET_PAGES',
          payload: {
            pages: merged,
            documentHash: uploaded.contentSha256,
            filename: file.name,
          },
        });
        succeeded = true;
      } catch (err) {
        dispatch({ type: 'SET_PARSE_DETAIL', payload: '' });
        if (err instanceof DOMException && err.name === 'AbortError') {
          dispatch({ type: 'SET_ERROR', payload: null });
          dispatch({ type: 'SET_SCREEN', payload: 'upload' });
          dispatch({ type: 'SET_PARSE_STAGE', payload: 'idle' });
        } else {
          const message = err instanceof Error ? err.message : 'Parsing failed';
          const requestId = /\(ref ([^)]+)\)/.exec(message)?.[1];
          dispatch({ type: 'SET_ERROR_DETAIL', payload: { message, requestId, retryable: /busy|unavailable|timed out/i.test(message) } });
        }
      } finally {
        if (uploaded) await releaseDocument(uploaded.documentId);
        endParse(controller);
      }
      return succeeded;
    },
    [state.file, state.config, state.docPageCount, isParsing, dispatch],
  );

  const cancel = useCallback(() => {
    if (!isParseActive()) return;
    dispatch({ type: 'SET_PARSE_STAGE', payload: 'cancelling' });
    cancelActiveParse();
  }, [dispatch]);

  return { parse, cancel, isParsing };
}
