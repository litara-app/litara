/**
 * CJS stub for @litara/cbz-parser used by Jest e2e tests.
 *
 * The real package is pure ESM which Jest (running in CJS mode) cannot load.
 * This stub uses adm-zip (CJS-compatible) and fast-xml-parser directly to
 * parse ComicInfo.xml from the CBZ, mirroring the real package's logic.
 */
const path = require('path');
const AdmZip = require('adm-zip');
const { XMLParser } = require('fast-xml-parser');

function openZip(filePath) {
  return new AdmZip(filePath);
}

function findComicInfo(zip) {
  const entry = zip
    .getEntries()
    .find((e) => path.basename(e.entryName).toLowerCase() === 'comicinfo.xml');
  return entry ? entry.getData().toString('utf8') : undefined;
}

function getImageEntries(zip) {
  return zip
    .getEntries()
    .filter((e) => /\.(jpe?g|png|gif|webp)$/i.test(e.entryName))
    .sort((a, b) => a.entryName.localeCompare(b.entryName));
}

function parseComicInfoXml(xmlString) {
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });
  const doc = parser.parse(xmlString);
  const ci = doc['ComicInfo'] || {};

  const splitField = (val) =>
    val ? String(val).split(',').map((s) => s.trim()).filter(Boolean) : [];

  let publishedDate;
  if (ci['Year']) {
    const y = parseInt(ci['Year'], 10);
    const m = ci['Month'] ? parseInt(ci['Month'], 10) - 1 : 0;
    const d = ci['Day'] ? parseInt(ci['Day'], 10) : 1;
    const dt = new Date(y, m, d);
    if (!isNaN(dt.getTime())) publishedDate = dt;
  }

  // Parse FrontCover page index
  let frontCoverIndex;
  const pages = ci['Pages'];
  if (pages) {
    const pageList = pages['Page'];
    const arr = Array.isArray(pageList) ? pageList : [pageList];
    const fc = arr.find((p) => p && p['@_Type'] === 'FrontCover');
    if (fc && fc['@_Image'] !== undefined) {
      frontCoverIndex = parseInt(String(fc['@_Image']), 10);
    }
  }

  const subjects = [
    ...splitField(ci['Genre']),
    ...splitField(ci['Tags']),
  ];

  return {
    meta: {
      title: ci['Title'] ? String(ci['Title']) : '',
      authors: splitField(ci['Writer']),
      description: ci['Summary'] ? String(ci['Summary']) : undefined,
      publishedDate,
      publisher: ci['Publisher'] ? String(ci['Publisher']) : undefined,
      language: ci['LanguageISO'] ? String(ci['LanguageISO']) : undefined,
      subjects: subjects.length ? subjects : undefined,
    },
    frontCoverIndex,
  };
}

function extractCbzMetadata(filePath) {
  const zip = openZip(filePath);
  const xmlString = findComicInfo(zip);
  if (!xmlString) {
    return { title: path.basename(filePath, path.extname(filePath)), authors: [] };
  }
  const { meta } = parseComicInfoXml(xmlString);
  if (!meta.title) meta.title = path.basename(filePath, path.extname(filePath));
  return meta;
}

function extractCbzCover(filePath) {
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

module.exports = { extractCbzMetadata, extractCbzCover };
