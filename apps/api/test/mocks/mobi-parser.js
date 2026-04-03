/**
 * CJS stub for @litara/mobi-parser used by Jest e2e tests.
 *
 * The real package is pure ESM which Jest (running in CJS mode) cannot load.
 * This stub parses the filename using the convention:
 *   "Title - Author Name.ext"
 * so scanner tests that check author metadata still pass.
 */
const path = require('path');

async function extractMobiMetadata(filePath) {
  const name = path.basename(filePath, path.extname(filePath));
  const dashIdx = name.indexOf(' - ');
  const title = dashIdx !== -1 ? name.slice(0, dashIdx).trim() : name;
  const authorPart = dashIdx !== -1 ? name.slice(dashIdx + 3).trim() : '';
  const authors = authorPart ? [authorPart] : [];
  return { title, authors, description: undefined, publishedDate: undefined, isbn: undefined };
}

module.exports = { extractMobiMetadata };
