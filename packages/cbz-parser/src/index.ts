import AdmZip from 'adm-zip';
import { XMLParser } from 'fast-xml-parser';
import * as path from 'path';

export interface CbzMetadata {
  title: string;
  authors: string[];
  description?: string;
  publishedDate?: Date;
  publisher?: string;
  language?: string;
  series?: string;
  seriesNumber?: string;
  subjects?: string[];
  ids?: Record<string, string>;
}

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp']);

interface ComicInfoXml {
  Title?: string;
  Writer?: string;
  Publisher?: string;
  Series?: string;
  Number?: string | number;
  Year?: number;
  Month?: number;
  Day?: number;
  Summary?: string;
  LanguageISO?: string;
  Genre?: string;
  Tags?: string;
  Pages?: {
    Page?:
      | Array<{ '@_Image'?: number; '@_Type'?: string }>
      | { '@_Image'?: number; '@_Type'?: string };
  };
}

function splitField(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseComicInfoXml(xmlString: string): {
  meta: CbzMetadata;
  frontCoverIndex?: number;
} {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
  });
  const parsed = parser.parse(xmlString) as { ComicInfo?: ComicInfoXml };
  const ci = parsed.ComicInfo ?? {};

  const title = ci.Title ? String(ci.Title).trim() : '';
  const authors = splitField(ci.Writer ? String(ci.Writer) : undefined);
  const publisher = ci.Publisher ? String(ci.Publisher).trim() : undefined;
  const description = ci.Summary ? String(ci.Summary).trim() : undefined;
  const language = ci.LanguageISO ? String(ci.LanguageISO).trim() : undefined;
  const series = ci.Series ? String(ci.Series).trim() : undefined;
  const seriesNumber = ci.Number !== undefined ? String(ci.Number) : undefined;

  const genreSubjects = splitField(ci.Genre ? String(ci.Genre) : undefined);
  const tagSubjects = splitField(ci.Tags ? String(ci.Tags) : undefined);
  const subjects = [...genreSubjects, ...tagSubjects];

  let publishedDate: Date | undefined;
  if (ci.Year) {
    const month = ci.Month ?? 1;
    const day = ci.Day ?? 1;
    const d = new Date(
      `${ci.Year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
    );
    if (!isNaN(d.getTime())) publishedDate = d;
  }

  const ids: Record<string, string> = {};
  if (series) ids['series'] = series;
  if (seriesNumber) ids['seriesNumber'] = seriesNumber;

  // Locate FrontCover page index from <Pages>
  let frontCoverIndex: number | undefined;
  if (ci.Pages?.Page) {
    const pages = Array.isArray(ci.Pages.Page)
      ? ci.Pages.Page
      : [ci.Pages.Page];
    const fc = pages.find((p) => p['@_Type'] === 'FrontCover');
    if (fc?.['@_Image'] !== undefined) frontCoverIndex = fc['@_Image'];
  }

  return {
    meta: {
      title,
      authors,
      description: description || undefined,
      publishedDate,
      publisher: publisher || undefined,
      language: language || undefined,
      series: series || undefined,
      seriesNumber: seriesNumber || undefined,
      subjects: subjects.length ? subjects : undefined,
      ids: Object.keys(ids).length ? ids : undefined,
    },
    frontCoverIndex,
  };
}

function openZip(filePath: string): AdmZip {
  return new AdmZip(filePath);
}

function findComicInfo(zip: AdmZip): string | undefined {
  // Match ComicInfo.xml at any depth (root or inside a subdirectory)
  const entry = zip
    .getEntries()
    .find((e) => path.basename(e.entryName).toLowerCase() === 'comicinfo.xml');
  return entry ? entry.getData().toString('utf8') : undefined;
}

function getImageEntries(zip: AdmZip): AdmZip.IZipEntry[] {
  return zip
    .getEntries()
    .filter((e) => {
      if (e.isDirectory) return false;
      const ext = path.extname(e.entryName).toLowerCase();
      return IMAGE_EXTS.has(ext);
    })
    .sort((a, b) => a.entryName.localeCompare(b.entryName));
}

export function extractCbzMetadata(
  filePath: string,
  log?: (msg: string) => void,
): CbzMetadata {
  const zip = openZip(filePath);
  const entries = zip.getEntries().map((e) => e.entryName);
  log?.(
    `CBZ entries (${entries.length}): ${entries.slice(0, 10).join(', ')}${entries.length > 10 ? ' ...' : ''}`,
  );

  const xmlString = findComicInfo(zip);

  if (!xmlString) {
    log?.(
      `No ComicInfo.xml found in ${path.basename(filePath)} — falling back to filename`,
    );
    return {
      title: path.basename(filePath, path.extname(filePath)),
      authors: [],
    };
  }

  log?.(`ComicInfo.xml found in ${path.basename(filePath)}`);
  const { meta } = parseComicInfoXml(xmlString);
  if (!meta.title) {
    meta.title = path.basename(filePath, path.extname(filePath));
  }
  return meta;
}

export function extractCbzCover(filePath: string): Buffer | undefined {
  const zip = openZip(filePath);
  const images = getImageEntries(zip);
  if (images.length === 0) return undefined;

  const xmlString = findComicInfo(zip);
  if (xmlString) {
    const { frontCoverIndex } = parseComicInfoXml(xmlString);
    if (frontCoverIndex !== undefined && frontCoverIndex < images.length) {
      return images[frontCoverIndex].getData();
    }
  }

  return images[0].getData();
}
