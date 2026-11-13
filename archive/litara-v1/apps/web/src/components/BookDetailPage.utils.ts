/** Strips hyphens then checks for exactly 13 digits. */
export function isValidIsbn13(isbn: string | null | undefined): isbn is string {
  return !!isbn && /^\d{13}$/.test(isbn.replace(/-/g, ''));
}

/** Strips hyphens then checks for 9 digits followed by a digit or X. */
export function isValidIsbn10(isbn: string | null | undefined): isbn is string {
  return !!isbn && /^\d{9}[\dX]$/i.test(isbn.replace(/-/g, ''));
}

export function formatBytes(sizeBytes: string): string {
  const n = Number(BigInt(sizeBytes));
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / 1024).toFixed(1)} KB`;
}

export function formatBytesNum(bytes: number): string {
  if (bytes === 0) return '—';
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`;
  return `${(bytes / 1e3).toFixed(0)} KB`;
}
