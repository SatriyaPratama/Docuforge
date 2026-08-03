/**
 * Single source of truth for upload constraints, shared by the client-side
 * drop zone (WorkspaceCenter) and the server-side /api/parse route.
 */

export const MAX_FILE_BYTES = 20 * 1024 * 1024; // 20 MB
export const MAX_FILE_LABEL = '20 MB';

export type FileKind = 'pdf' | 'png' | 'jpeg' | 'webp' | 'tiff';

export const ACCEPTED_MIME_TYPES: readonly string[] = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/tiff',
  'image/x-tiff',
];

export const ACCEPTED_EXTENSIONS: readonly string[] = [
  'pdf',
  'png',
  'jpg',
  'jpeg',
  'webp',
  'tiff',
  'tif',
];

/** Value for <input accept="..."> */
export const ACCEPT_ATTRIBUTE = '.pdf,.png,.jpg,.jpeg,.webp,.tiff,.tif';

export const UNSUPPORTED_TYPE_MESSAGE =
  'Unsupported file type. Use PDF, PNG, JPEG, WebP, or TIFF.';
export const FILE_TOO_LARGE_MESSAGE = `File is too large. Maximum size is ${MAX_FILE_LABEL}.`;

/**
 * Detect the real file type from its leading bytes (magic numbers).
 * MIME type and extension are attacker-controlled; the content is not.
 * Returns null when the signature matches none of the supported formats.
 */
export function sniffFileKind(bytes: Uint8Array): FileKind | null {
  if (bytes.length < 12) return null;

  // %PDF-
  if (
    bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 &&
    bytes[3] === 0x46 && bytes[4] === 0x2d
  ) {
    return 'pdf';
  }

  // \x89PNG\r\n\x1a\n
  if (
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e &&
    bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a &&
    bytes[6] === 0x1a && bytes[7] === 0x0a
  ) {
    return 'png';
  }

  // \xFF\xD8\xFF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'jpeg';
  }

  // RIFF....WEBP
  if (
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) {
    return 'webp';
  }

  // II*\0 (little-endian) or MM\0* (big-endian)
  if (
    (bytes[0] === 0x49 && bytes[1] === 0x49 && bytes[2] === 0x2a && bytes[3] === 0x00) ||
    (bytes[0] === 0x4d && bytes[1] === 0x4d && bytes[2] === 0x00 && bytes[3] === 0x2a)
  ) {
    return 'tiff';
  }

  return null;
}

/** Cheap client-side pre-check (UX only — the route re-validates content). */
export function preValidateFile(file: File): string | null {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  const typeOk = ACCEPTED_MIME_TYPES.includes(file.type) || ACCEPTED_EXTENSIONS.includes(ext);
  if (!typeOk) return UNSUPPORTED_TYPE_MESSAGE;
  if (file.size > MAX_FILE_BYTES) return FILE_TOO_LARGE_MESSAGE;
  return null;
}
