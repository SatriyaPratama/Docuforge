'use client';

interface PdfDocumentLike {
  numPages: number;
  destroy?: () => Promise<void> | void;
}
interface PdfModuleLike {
  getDocument: (src: Uint8Array) => { promise: Promise<PdfDocumentLike> };
  GlobalWorkerOptions?: { workerSrc: string };
}

/**
 * Count pages in a document.
 *  • non-PDF (single image) → 1
 *  • PDF parsed successfully → its page count
 *  • PDF that could NOT be read → null (caller must not assume 1, or a
 *    multi-page PDF would silently parse only its first page)
 *
 * Uses the self-hosted pdf.js worker (no CDN) to preserve the privacy-focused,
 * offline-capable stance.
 */
export async function countPdfPages(file: File): Promise<number | null> {
  const isPdf =
    (file.type || '').includes('pdf') || file.name.toLowerCase().endsWith('.pdf');
  if (!isPdf) return 1;

  try {
    const buffer = await file.arrayBuffer();
    const pdfjs = (await import('pdfjs-dist')) as unknown as PdfModuleLike;
    if (pdfjs.GlobalWorkerOptions) {
      pdfjs.GlobalWorkerOptions.workerSrc = new URL(
        'pdfjs-dist/build/pdf.worker.min.mjs',
        import.meta.url,
      ).toString();
    }
    const doc = await pdfjs.getDocument(new Uint8Array(buffer)).promise;
    const pages = doc.numPages;
    await doc.destroy?.();
    return pages > 0 ? pages : null;
  } catch {
    return null;
  }
}
