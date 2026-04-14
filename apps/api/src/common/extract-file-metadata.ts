import * as path from 'path';
import { EPub } from 'epub2';
import { extractMobiMetadata } from '@litara/mobi-parser';
import { extractCbzMetadata } from '@litara/cbz-parser';

export interface ExtractedFileMetadata {
  title: string;
  authors: string[];
  description?: string;
  publishedDate?: Date;
  publisher?: string;
  language?: string;
  isbn13?: string;
  subjects?: string[];
  ids?: Record<string, string>;
  // EPUB-specific display fields
  contributor?: string;
  rights?: string;
  source?: string;
  coverage?: string;
  relation?: string;
  type?: string;
}

export async function extractFileMetadata(
  filePath: string,
  log?: (msg: string) => void,
): Promise<ExtractedFileMetadata> {
  const ext = path.extname(filePath).toLowerCase();

  if (ext === '.epub') {
    try {
      return await extractEpubFileMetadata(filePath);
    } catch (err) {
      console.warn(
        `[epub] Failed to parse metadata for "${filePath}", falling back to filename:`,
        err instanceof Error ? err.message : err,
      );
      return {
        title: path.basename(filePath, path.extname(filePath)),
        authors: [],
      };
    }
  }

  if (['.mobi', '.azw', '.azw3'].includes(ext)) {
    const meta = await extractMobiMetadata(filePath);
    const ids: Record<string, string> = {};
    if (meta.isbn) ids['isbn'] = meta.isbn;
    if (meta.asin) ids['amazon'] = meta.asin;
    return {
      title: meta.title ?? '',
      authors: meta.authors ?? [],
      description: meta.description,
      publishedDate: meta.publishedDate,
      publisher: meta.publisher,
      isbn13: meta.isbn,
      ids: Object.keys(ids).length ? ids : undefined,
    };
  }

  if (ext === '.cbz') {
    const meta = extractCbzMetadata(filePath, log);
    return {
      title: meta.title,
      authors: meta.authors,
      description: meta.description,
      publishedDate: meta.publishedDate,
      publisher: meta.publisher,
      language: meta.language,
      subjects: meta.subjects,
      ids: meta.ids,
    };
  }

  // PDF — fall back to filename
  return {
    title: path.basename(filePath, path.extname(filePath)),
    authors: [],
  };
}

async function extractEpubFileMetadata(
  filePath: string,
): Promise<ExtractedFileMetadata> {
  const epub = await EPub.createAsync(filePath);
  const meta = epub.metadata;

  const rawCreator = meta.creator ?? '';
  const authors = rawCreator
    ? rawCreator
        .split(/[,;]/)
        .map((s: string) => s.trim())
        .filter(Boolean)
    : [];

  let publishedDate: Date | undefined;
  if (meta.date) {
    const d = new Date(meta.date);
    if (!isNaN(d.getTime())) publishedDate = d;
  }

  const rawSubject = meta.subject ?? [];
  const subjects = (Array.isArray(rawSubject) ? rawSubject : [rawSubject])
    .flatMap((s: string) => s.split(/[,;]/))
    .map((s: string) => s.trim())
    .filter(Boolean);

  const ids = await extractEpubIds(epub);

  // Prefer the thoroughly-parsed ids map for isbn, fall back to meta['identifier']
  const isbn =
    ids['isbn'] ??
    (String(meta['identifier'] ?? '')
      .replace(/^urn:isbn:/i, '')
      .trim() ||
      undefined);

  return {
    title: meta.title ?? '',
    authors,
    description: meta.description || undefined,
    publishedDate,
    publisher: meta.publisher || undefined,
    language: meta.language || undefined,
    isbn13: isbn,
    subjects: subjects.length ? subjects : undefined,
    ids: Object.keys(ids).length ? ids : undefined,
    // epub2 metadata fields are loosely typed — disable unsafe-assignment for this block
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    contributor: meta.contributor || undefined,
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    rights: meta.rights || undefined,
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    source: meta.source || undefined,
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    coverage: meta.coverage || undefined,
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    relation: meta.relation || undefined,
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    type: meta.type || undefined,
  };
}

function extractEpubIds(epub: EPub): Promise<Record<string, string>> {
  return new Promise((resolve) => {
    // TODO: Lets just rewrite this in-house at some point instead of relying on the library's metadata parsing
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
    (epub as any).zip.readFile(
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      (epub as any).rootFile,
      (_err: unknown, data: Buffer) => {
        if (_err || !data) {
          resolve({});
          return;
        }
        const xml = data.toString('utf8');
        const ids: Record<string, string> = {};

        const re = /<dc:identifier([^>]*)>([\s\S]*?)<\/dc:identifier>/gi;
        let match: RegExpExecArray | null;
        while ((match = re.exec(xml)) !== null) {
          const attrs = match[1];
          const raw = match[2].trim();
          const value = raw.replace(/^urn:isbn:/i, '').trim();
          if (!value) continue;

          const schemeMatch = /(?:opf:scheme|scheme)="([^"]+)"/i.exec(attrs);
          if (schemeMatch) {
            ids[schemeMatch[1].toLowerCase()] = value;
          } else {
            if (/^97[89]\d{10}$/.test(value) && !ids['isbn']) {
              ids['isbn'] = value;
            } else if (/^[A-Z0-9]{10}$/.test(value) && !ids['amazon']) {
              ids['amazon'] = value;
            } else if (!ids['identifier']) {
              ids['identifier'] = value;
            }
          }
        }

        resolve(ids);
      },
    );
  });
}
