/** Resolve internal OCR service URLs from the deployment setting. */
export function getOcrBaseUrl(): string {
  const raw = (process.env.OCR_ENDPOINT ?? 'http://localhost:8080').trim();
  return raw.replace(/\/+$/, '').replace(/\/api\/v1\/marker\/?$/, '');
}

export function getOcrMarkerUrl(): string {
  return `${getOcrBaseUrl()}/api/v1/marker`;
}

export function getOcrDocumentsUrl(): string {
  return `${getOcrBaseUrl()}/api/v1/documents`;
}
