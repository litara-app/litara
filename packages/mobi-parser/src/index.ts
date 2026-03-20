import { readFile } from 'node:fs/promises';

export interface MobiMetadata {
  title: string;
  authors: string[];
  description?: string;
  publishedDate?: Date;
  publisher?: string;
  isbn?: string;
  asin?: string;
}

interface PalmDbHeader {
  numberOfRecords: number;
  recordOffsets: number[];
}

interface MobiHeader {
  textEncoding: number;
  fullNameOffset: number;
  fullNameLength: number;
  firstImageIndex: number;
  exthFlags: number;
  headerLength: number;
}

interface ExthData {
  authors: string[];
  publisher?: string;
  description?: string;
  isbn?: string;
  asin?: string;
  publishedDate?: string;
  coverOffset?: number;
  thumbnailOffset?: number;
  updatedTitle?: string;
  kf8BoundaryRecord: number;
}

interface ParsedMobi {
  title: string;
  exth: ExthData;
  firstImageIndex: number;
  palm: PalmDbHeader;
  buf: Buffer;
}

function parsePalmDbHeader(buf: Buffer): PalmDbHeader {
  const numberOfRecords = buf.readUInt16BE(76);
  const recordOffsets: number[] = [];
  for (let i = 0; i < numberOfRecords; i++) {
    recordOffsets.push(buf.readUInt32BE(78 + i * 8));
  }
  return { numberOfRecords, recordOffsets };
}

function readRecord(buf: Buffer, palm: PalmDbHeader, index: number): Buffer {
  const start = palm.recordOffsets[index];
  const end =
    index + 1 < palm.numberOfRecords
      ? palm.recordOffsets[index + 1]
      : buf.length;
  return buf.subarray(start, end);
}

function parseMobiHeader(record0: Buffer): MobiHeader {
  const magic = record0.subarray(16, 20).toString('ascii');
  if (magic !== 'MOBI') throw new Error('Not a MOBI file: missing MOBI magic');

  const headerLength = record0.readUInt32BE(20);
  const textEncoding = record0.readUInt32BE(28);
  const fullNameOffset = record0.readUInt32BE(84);
  const fullNameLength = record0.readUInt32BE(88);
  const firstImageIndex = record0.readUInt32BE(108);
  const exthFlags = record0.readUInt32BE(128);

  return {
    textEncoding,
    fullNameOffset,
    fullNameLength,
    firstImageIndex,
    exthFlags,
    headerLength,
  };
}

function decodeString(buf: Buffer, encoding: number): string {
  return buf.toString(encoding === 65001 ? 'utf8' : 'latin1');
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]*>/g, '').trim();
}

function parseExth(record0: Buffer, mobi: MobiHeader): ExthData {
  const result: ExthData = {
    authors: [],
    kf8BoundaryRecord: 0xffffffff,
  };

  const hasExth = (mobi.exthFlags & 0x40) !== 0;
  if (!hasExth) return result;

  const exthStart = 16 + mobi.headerLength;
  if (exthStart + 12 > record0.length) return result;

  const magic = record0.subarray(exthStart, exthStart + 4).toString('ascii');
  if (magic !== 'EXTH') return result;

  const recordCount = record0.readUInt32BE(exthStart + 8);
  let offset = exthStart + 12;

  for (let i = 0; i < recordCount; i++) {
    if (offset + 8 > record0.length) break;
    const type = record0.readUInt32BE(offset);
    const length = record0.readUInt32BE(offset + 4);
    if (length < 8 || offset + length > record0.length) break;
    const data = record0.subarray(offset + 8, offset + length);

    switch (type) {
      case 100:
        result.authors.push(decodeString(data, mobi.textEncoding));
        break;
      case 101:
        result.publisher = decodeString(data, mobi.textEncoding);
        break;
      case 103:
        result.description = stripHtml(decodeString(data, mobi.textEncoding));
        break;
      case 104:
        result.isbn = decodeString(data, mobi.textEncoding)
          .replace(/^urn:isbn:/i, '')
          .trim();
        break;
      case 113:
        result.asin = decodeString(data, mobi.textEncoding).trim();
        break;
      case 106:
        result.publishedDate = decodeString(data, mobi.textEncoding);
        break;
      case 121:
        result.kf8BoundaryRecord = data.readUInt32BE(0);
        break;
      case 201:
        result.coverOffset = data.readUInt32BE(0);
        break;
      case 202:
        result.thumbnailOffset = data.readUInt32BE(0);
        break;
      case 503:
        result.updatedTitle = decodeString(data, mobi.textEncoding);
        break;
    }

    offset += length;
  }

  return result;
}

function parseMobiFile(buf: Buffer): ParsedMobi {
  const palm = parsePalmDbHeader(buf);
  const record0 = readRecord(buf, palm, 0);
  const mobi = parseMobiHeader(record0);
  const exth = parseExth(record0, mobi);

  let firstImageIndex = mobi.firstImageIndex;

  // AZW3 boundary: re-parse KF8 section for cover offsets
  if (firstImageIndex === 0xffffffff && exth.kf8BoundaryRecord !== 0xffffffff) {
    const kf8Record0 = readRecord(buf, palm, exth.kf8BoundaryRecord);
    try {
      const kf8Mobi = parseMobiHeader(kf8Record0);
      const kf8Exth = parseExth(kf8Record0, kf8Mobi);
      firstImageIndex = kf8Mobi.firstImageIndex;
      // Use KF8 cover offsets if present
      if (kf8Exth.coverOffset !== undefined) {
        exth.coverOffset = kf8Exth.coverOffset;
      }
      if (kf8Exth.thumbnailOffset !== undefined) {
        exth.thumbnailOffset = kf8Exth.thumbnailOffset;
      }
    } catch {
      // Fall through with original values
    }
  }

  // Resolve title: EXTH 503 > fullName field > raw bytes
  let title: string;
  if (exth.updatedTitle) {
    title = exth.updatedTitle;
  } else if (
    mobi.fullNameOffset > 0 &&
    mobi.fullNameLength > 0 &&
    mobi.fullNameOffset + mobi.fullNameLength <= record0.length
  ) {
    title = decodeString(
      record0.subarray(
        mobi.fullNameOffset,
        mobi.fullNameOffset + mobi.fullNameLength,
      ),
      mobi.textEncoding,
    );
  } else {
    title = buf.subarray(0, 32).toString('ascii').replace(/\0/g, '').trim();
  }

  return { title, exth, firstImageIndex, palm, buf };
}

export async function extractMobiMetadata(
  filePath: string,
): Promise<MobiMetadata> {
  const buf = await readFile(filePath);
  const parsed = parseMobiFile(buf);
  const { exth } = parsed;

  let publishedDate: Date | undefined;
  if (exth.publishedDate) {
    const d = new Date(exth.publishedDate);
    if (!isNaN(d.getTime())) publishedDate = d;
  }

  return {
    title: parsed.title,
    authors: exth.authors,
    description: exth.description || undefined,
    publishedDate,
    publisher: exth.publisher || undefined,
    isbn: exth.isbn || undefined,
    asin: exth.asin || undefined,
  };
}

export async function extractMobiCover(
  filePath: string,
): Promise<Buffer | undefined> {
  const buf = await readFile(filePath);
  const parsed = parseMobiFile(buf);
  const { exth, firstImageIndex, palm } = parsed;

  const coverOffset = exth.coverOffset ?? exth.thumbnailOffset;
  if (coverOffset === undefined || coverOffset === 0xffffffff) return undefined;
  if (firstImageIndex === 0xffffffff) return undefined;

  const coverRecordIndex = firstImageIndex + coverOffset;
  if (coverRecordIndex >= palm.numberOfRecords) return undefined;

  return Buffer.from(readRecord(buf, palm, coverRecordIndex));
}
