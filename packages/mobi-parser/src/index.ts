import { initMobiFile, initKf8File } from '@lingo-reader/mobi-parser';
import { extname } from 'node:path';

export interface MobiMetadata {
  title: string;
  authors: string[];
  description?: string;
  publishedDate?: Date;
  publisher?: string;
  isbn?: string;
}

export async function extractMobiMetadata(
  filePath: string,
): Promise<MobiMetadata> {
  const ext = extname(filePath).toLowerCase();

  // AZW3 uses the KF8 format; MOBI and AZW use the older MOBI format
  const book =
    ext === '.azw3'
      ? await initKf8File(filePath)
      : await initMobiFile(filePath);

  const raw = book.getMetadata();

  let publishedDate: Date | undefined;
  if (raw.published) {
    const d = new Date(raw.published);
    if (!isNaN(d.getTime())) publishedDate = d;
  }

  // isbn is in raw.identifier — strip common prefixes
  const rawId = raw.identifier ?? '';
  const isbn = rawId.replace(/^urn:isbn:/i, '').trim() || undefined;
  return {
    title: raw.title ?? '',
    authors: Array.isArray(raw.author) ? raw.author.filter(Boolean) : [],
    description: raw.description || undefined,
    publishedDate,
    publisher: raw.publisher || undefined,
    isbn,
  };
}
