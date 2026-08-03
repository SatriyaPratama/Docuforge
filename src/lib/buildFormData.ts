import type { AppConfig } from '@/lib/types';

/** Build the form-data payload for the surya-ocr /api/v1/marker endpoint */
export function buildFormData(file: File | null, config: AppConfig, documentId?: string): FormData {
  const form = new FormData();
  if (file) form.append('file', file);
  if (documentId) form.append('document_id', documentId);
  form.append('output_format', 'json');

  if (config.pageRange) form.append('page_range', config.pageRange);

  const { additional } = config;
  if (additional.skipCache === true) form.append('skip_cache', 'true');
  form.append('keep_header', additional.keepHeader ? 'true' : 'false');
  form.append('keep_footer', additional.keepFooter ? 'true' : 'false');

  return form;
}
