import * as fs from 'fs';
import * as path from 'path';

/**
 * Find a .metadata.json sidecar alongside an ebook file.
 * Strategy 1: exact name match — <basename>.metadata.json
 * Strategy 2 (when bookTitle provided): scan dir, match by title case-insensitively
 */
export function findSidecar(
  filePath: string,
  bookTitle?: string,
): string | null {
  const dir = path.dirname(filePath);
  const base = path.basename(filePath, path.extname(filePath));
  const candidate = path.join(dir, `${base}.metadata.json`);
  if (fs.existsSync(candidate)) return candidate;

  if (bookTitle) {
    try {
      const entries = fs
        .readdirSync(dir)
        .filter((f) => f.endsWith('.metadata.json'));
      for (const entry of entries) {
        try {
          const parsed = JSON.parse(
            fs.readFileSync(path.join(dir, entry), 'utf8'),
          ) as { title?: string };
          if (parsed.title?.toLowerCase() === bookTitle.toLowerCase()) {
            return path.join(dir, entry);
          }
        } catch (err) {
          console.warn(
            `[findSidecar] Could not parse sidecar "${entry}": ${(err as Error).message}`,
          );
        }
      }
    } catch (err) {
      console.warn(
        `[findSidecar] Could not read directory "${dir}": ${(err as Error).message}`,
      );
    }
  }
  return null;
}
