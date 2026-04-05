import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { Injectable, Logger } from '@nestjs/common';
import JSZip from 'jszip';

export interface EpubMetadataInput {
  title?: string | null;
  subtitle?: string | null;
  description?: string | null;
  authors?: string[];
  publisher?: string | null;
  publishedDate?: string | null;
  language?: string | null;
  isbn13?: string | null;
  isbn10?: string | null;
  genres?: string[];
  tags?: string[];
  seriesName?: string | null;
  seriesNumber?: number | null;
}

@Injectable()
export class EpubMetadataWriterService {
  private readonly logger = new Logger(EpubMetadataWriterService.name);

  async writeMetadataToEpub(
    filePath: string,
    metadata: EpubMetadataInput,
  ): Promise<void> {
    const zipBuffer = fs.readFileSync(filePath);
    const zip = await JSZip.loadAsync(zipBuffer);

    // 1. Read META-INF/container.xml to find OPF path
    const containerEntry = zip.file('META-INF/container.xml');
    if (!containerEntry) {
      throw new Error('Invalid epub: missing META-INF/container.xml');
    }
    const containerXml = await containerEntry.async('string');
    const opfPath = extractOpfPath(containerXml);
    if (!opfPath) {
      throw new Error(
        'Could not locate OPF rootfile in META-INF/container.xml',
      );
    }

    // 2. Read and patch the OPF
    const opfEntry = zip.file(opfPath);
    if (!opfEntry) {
      throw new Error(`OPF file not found in epub: ${opfPath}`);
    }
    const opfXml = await opfEntry.async('string');
    const patchedOpf = patchOpf(opfXml, metadata);

    // 3. Replace the OPF in the ZIP
    zip.file(opfPath, patchedOpf);

    // 4. Write to temp file then atomically rename
    const dir = path.dirname(filePath);
    const tmpPath = path.join(
      dir,
      `litara-tmp-${crypto.randomBytes(6).toString('hex')}.epub`,
    );

    const outBuffer = await zip.generateAsync({
      type: 'nodebuffer',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 },
    });

    fs.writeFileSync(tmpPath, outBuffer);

    try {
      fs.renameSync(tmpPath, filePath);
    } catch {
      // Windows: renameSync over existing file throws EPERM
      try {
        fs.rmSync(filePath, { force: true });
        fs.renameSync(tmpPath, filePath);
      } catch (err2) {
        fs.rmSync(tmpPath, { force: true });
        throw err2;
      }
    }

    this.logger.log(`Wrote metadata to epub: ${filePath}`);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function extractOpfPath(containerXml: string): string | null {
  // <rootfile full-path="..." media-type="application/oebps-package+xml"/>
  const match = containerXml.match(/full-path\s*=\s*["']([^"']+\.opf)["']/i);
  if (match) return match[1];
  // Fallback: any rootfile
  const fallback = containerXml.match(/full-path\s*=\s*["']([^"']+)["']/i);
  return fallback ? fallback[1] : null;
}

function patchOpf(opfXml: string, metadata: EpubMetadataInput): string {
  // Use string-based patching to preserve the original file structure as much
  // as possible. We parse to understand the structure, then do targeted
  // replacements at the string level.
  let result = opfXml;

  if (metadata.title) {
    result = replaceOrAddDcElement(result, 'title', metadata.title);
  }
  if (metadata.description) {
    result = replaceOrAddDcElement(result, 'description', metadata.description);
  }
  if (metadata.publisher) {
    result = replaceOrAddDcElement(result, 'publisher', metadata.publisher);
  }
  if (metadata.publishedDate) {
    result = replaceOrAddDcElement(result, 'date', metadata.publishedDate);
  }
  if (metadata.language) {
    result = replaceOrAddDcElement(result, 'language', metadata.language);
  }

  if (metadata.authors && metadata.authors.length > 0) {
    result = replaceAllCreators(result, metadata.authors);
  }

  const subjects = buildSubjects(metadata.genres, metadata.tags);
  if (subjects.length > 0) {
    result = replaceAllSubjects(result, subjects);
  }

  if (metadata.isbn13) {
    result = replaceOrAddIsbn(result, 'ISBN-13', metadata.isbn13);
  }
  if (metadata.isbn10) {
    result = replaceOrAddIsbn(result, 'ISBN-10', metadata.isbn10);
  }

  if (metadata.subtitle) {
    result = replaceOrAddCaliberMeta(
      result,
      'dcterms:alternative',
      metadata.subtitle,
    );
  }
  if (metadata.seriesName) {
    result = replaceOrAddCaliberMeta(
      result,
      'calibre:series',
      metadata.seriesName,
    );
  }
  if (metadata.seriesNumber != null) {
    result = replaceOrAddCaliberMeta(
      result,
      'calibre:series_index',
      String(metadata.seriesNumber),
    );
  }

  return result;
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Replace the first occurrence of <dc:tag>...</dc:tag>, or add before </metadata>. */
function replaceOrAddDcElement(
  opf: string,
  tag: string,
  value: string,
): string {
  const safe = escapeXml(value);
  // Match <dc:tag ...>...</dc:tag> or <dc:tag .../>
  const tagRe = new RegExp(
    `<dc:${tag}(\\s[^>]*)?>(?:[^<]*)<\\/dc:${tag}>`,
    'i',
  );
  if (tagRe.test(opf)) {
    return opf.replace(tagRe, `<dc:${tag}$1>${safe}</dc:${tag}>`);
  }
  // No existing element — insert before </metadata>
  return opf.replace(
    /<\/metadata>/i,
    `    <dc:${tag}>${safe}</dc:${tag}>\n  </metadata>`,
  );
}

/** Remove all existing <dc:creator> elements and replace with new ones. */
function replaceAllCreators(opf: string, authors: string[]): string {
  const creatorRe = /<dc:creator(\s[^>]*)?>(?:[^<]*)<\/dc:creator>(\s*)/gi;
  // Remove all existing creators first
  const result = opf.replace(creatorRe, '');
  // Build replacement block
  const block = authors
    .map((a) => `    <dc:creator>${escapeXml(a)}</dc:creator>`)
    .join('\n');
  return result.replace(/<\/metadata>/i, `${block}\n  </metadata>`);
}

/** Remove all existing <dc:subject> elements and replace with new ones. */
function replaceAllSubjects(opf: string, subjects: string[]): string {
  const subjectRe = /<dc:subject(\s[^>]*)?>(?:[^<]*)<\/dc:subject>(\s*)/gi;
  const result = opf.replace(subjectRe, '');
  const block = subjects
    .map((s) => `    <dc:subject>${escapeXml(s)}</dc:subject>`)
    .join('\n');
  return result.replace(/<\/metadata>/i, `${block}\n  </metadata>`);
}

/** Replace or add a <dc:identifier> with a specific scheme. */
function replaceOrAddIsbn(opf: string, scheme: string, value: string): string {
  const safe = escapeXml(value);
  const schemeRe = new RegExp(
    `<dc:identifier[^>]+opf:scheme=["']${scheme}["'][^>]*>[^<]*<\\/dc:identifier>`,
    'i',
  );
  if (schemeRe.test(opf)) {
    return opf.replace(
      schemeRe,
      `<dc:identifier opf:scheme="${scheme}">${safe}</dc:identifier>`,
    );
  }
  return opf.replace(
    /<\/metadata>/i,
    `    <dc:identifier opf:scheme="${scheme}">${safe}</dc:identifier>\n  </metadata>`,
  );
}

/** Replace or add a calibre-style <meta name="..." content="..."/> */
function replaceOrAddCaliberMeta(
  opf: string,
  name: string,
  value: string,
): string {
  const safe = escapeXml(value);
  const metaRe = new RegExp(
    `<meta\\s+name=["']${name.replace(':', '\\:')}["'][^/]*/?>`,
    'i',
  );
  if (metaRe.test(opf)) {
    return opf.replace(metaRe, `<meta name="${name}" content="${safe}"/>`);
  }
  return opf.replace(
    /<\/metadata>/i,
    `    <meta name="${name}" content="${safe}"/>\n  </metadata>`,
  );
}

function buildSubjects(genres?: string[], tags?: string[]): string[] {
  const combined = [...(genres ?? []), ...(tags ?? [])];
  return [...new Set(combined)];
}
