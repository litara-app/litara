import { TestApp, createTestApp } from './helpers/app.helper';
import { cleanDatabase } from './helpers/db.helper';
import { LibraryScannerService } from '../src/library/library-scanner.service';

/**
 * Covers the "mount remap" scenario: the underlying volume mapping changes, so
 * DB rows point at paths that no longer resolve while the same content is found
 * at a new path on rescan.
 *
 *  A — reconcile: a scan marks unseen-on-disk files in the library as missing.
 *  B — relink: a rescan re-points a row to a new path when the content hash
 *      matches and the old path is gone (even if missingAt was never set).
 *  C — backfill self-heal: the KOReader hash backfill marks vanished paths
 *      missing instead of warning + failing on ENOENT.
 */
describe('LibraryScanner reconcile / remap (e2e)', () => {
  let testApp: TestApp;
  let scanner: LibraryScannerService;
  let ebookPath: string;

  beforeAll(async () => {
    testApp = await createTestApp({ mockScanner: false });
    scanner = testApp.moduleRef.get(LibraryScannerService);
    ebookPath = process.env.EBOOK_LIBRARY_PATH!;
  });

  afterAll(async () => {
    await testApp.app.close();
  });

  beforeEach(async () => {
    await cleanDatabase(testApp.db);
    await testApp.db.library.create({
      data: { name: 'Test Library', path: ebookPath },
    });
    await scanner.fullScan();
  });

  // -- B ----------------------------------------------------------------------
  it('relinks a row to its real path on rescan when the old path is gone (missingAt never set)', async () => {
    const file = await testApp.db.bookFile.findFirst({
      where: { fileHash: { not: null } },
    });
    expect(file).not.toBeNull();
    const realPath = file!.filePath;

    // Simulate a stale row left behind by a mount remap: same content hash,
    // path that no longer resolves, and missingAt still null (no unlink fired).
    const stalePath = '/nonexistent/old-mount/book.epub';
    await testApp.db.bookFile.update({
      where: { id: file!.id },
      data: { filePath: stalePath, missingAt: null },
    });

    await scanner.fullScan();

    const relinked = await testApp.db.bookFile.findUnique({
      where: { id: file!.id },
    });
    expect(relinked!.filePath).toBe(realPath);
    expect(relinked!.missingAt).toBeNull();
  });

  // -- A ----------------------------------------------------------------------
  it('marks a library file missing when it is not found on disk during a scan', async () => {
    const library = await testApp.db.library.findFirstOrThrow();
    const book = await testApp.db.book.create({
      data: { title: 'Ghost Book', libraryId: library.id },
    });
    const ghost = await testApp.db.bookFile.create({
      data: {
        bookId: book.id,
        filePath: '/nonexistent/ghost.epub',
        format: 'EPUB',
        sizeBytes: BigInt(123),
        fileHash: 'ghost-unique-hash-not-on-disk',
        missingAt: null,
      },
    });

    await scanner.fullScan();

    const after = await testApp.db.bookFile.findUnique({
      where: { id: ghost.id },
    });
    expect(after!.missingAt).not.toBeNull();
  });

  // -- C ----------------------------------------------------------------------
  it('backfill marks vanished paths missing and reports them as skipped', async () => {
    const library = await testApp.db.library.findFirstOrThrow();
    const book = await testApp.db.book.create({
      data: { title: 'Vanished Book', libraryId: library.id },
    });
    const vanished = await testApp.db.bookFile.create({
      data: {
        bookId: book.id,
        filePath: '/nonexistent/vanished.epub',
        format: 'EPUB',
        sizeBytes: BigInt(456),
        fileHash: 'vanished-unique-hash',
        koReaderHash: null,
        missingAt: null,
      },
    });

    const result = await scanner.backfillKoReaderHashes();
    expect(result.skipped).toBeGreaterThanOrEqual(1);

    const after = await testApp.db.bookFile.findUnique({
      where: { id: vanished.id },
    });
    expect(after!.missingAt).not.toBeNull();
  });
});
