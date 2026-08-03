import { getOcrDocumentsUrl } from '@/lib/ocrEndpoint';

export async function DELETE(_req: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    return Response.json({ error: 'Invalid document_id' }, { status: 400 });
  }

  try {
    const response = await fetch(`${getOcrDocumentsUrl()}/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      signal: AbortSignal.timeout(30_000),
    });
    if (response.status === 404) return new Response(null, { status: 204 });
    return new Response(null, { status: response.ok ? 204 : 502 });
  } catch {
    return Response.json({ error: 'OCR service is unavailable.' }, { status: 503 });
  }
}
