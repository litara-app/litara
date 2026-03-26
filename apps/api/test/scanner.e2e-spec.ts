import { TestApp, createTestApp } from './helpers/app.helper';
import { cleanDatabase } from './helpers/db.helper';
import { LibraryScannerService } from '../src/library/library-scanner.service';

describe('LibraryScanner (e2e)', () => {
  let testApp: TestApp;
  let libraryScannerService: LibraryScannerService;

  beforeAll(async () => {
    // Create the app first so DatabaseService.onModuleInit() runs migrations
    // and the PrismaClient is fully initialised before we touch the DB.
    // We use mockScanner: false so we can get a reference to the real service,
    // but we will trigger the scan manually after resetting state.
    testApp = await createTestApp({ mockScanner: false });
    libraryScannerService = testApp.moduleRef.get(LibraryScannerService);

    // Reset to a known-clean state now that the schema exists.
    await cleanDatabase(testApp.db);

    // Re-create the prerequisites that the scanner needs
    // (ensureDefaultLibraryAndFolder normally does this in onModuleInit).
    const ebookPath = process.env.EBOOK_LIBRARY_PATH!;
    await testApp.db.library.create({ data: { name: 'Default Library' } });
    await testApp.db.watchedFolder.create({
      data: { path: ebookPath, isActive: true },
    });

    // Run the full scan — imports all 6 fixture ebook files.
    await libraryScannerService.fullScan();
  });

  afterAll(async () => {
    await testApp.app.close();
  });

  it('imports all 6 ebook files from ebook-library/', async () => {
    const books = await testApp.db.book.findMany({ include: { files: true } });
    expect(books).toHaveLength(7);
  });

  it('EPUB: extracts title and author from metadata (Great Gatsby EPUB)', async () => {
    // Both EPUB and MOBI Gatsby files create separate book records,
    // so filter explicitly for the EPUB one.
    const book = await testApp.db.book.findFirst({
      where: {
        title: { contains: 'Gatsby', mode: 'insensitive' },
        files: { some: { format: 'EPUB' } },
      },
      include: {
        files: true,
        authors: { include: { author: true } },
      },
    });
    expect(book).not.toBeNull();
    expect(book!.authors.map((a) => a.author.name)).toContain(
      'F. Scott Fitzgerald',
    );
    expect(book!.files.some((f) => f.format === 'EPUB')).toBe(true);
  });

  it('EPUB: stores cover image bytes (Pride and Prejudice)', async () => {
    const book = await testApp.db.book.findFirst({
      where: {
        title: { contains: 'Pride', mode: 'insensitive' },
        files: { some: { format: 'EPUB' } },
      },
    });
    expect(book).not.toBeNull();
    expect(book!.coverData).not.toBeNull();
    expect((book!.coverData as Buffer).length).toBeGreaterThan(0);
  });

  it('MOBI: extracts title and author from filename (Dorian Gray)', async () => {
    // The mobi-parser is stubbed in tests; it parses author from filename
    // using the "Title - Author Name" convention.
    const book = await testApp.db.book.findFirst({
      where: { title: { contains: 'Dorian', mode: 'insensitive' } },
      include: {
        files: true,
        authors: { include: { author: true } },
      },
    });
    expect(book).not.toBeNull();
    expect(book!.authors.map((a) => a.author.name)).toContain('Oscar Wilde');
    expect(book!.files.some((f) => f.format === 'MOBI')).toBe(true);
  });

  it('sets a SHA-256 fileHash on every BookFile', async () => {
    const files = await testApp.db.bookFile.findMany();
    expect(files.length).toBeGreaterThan(0);
    expect(
      files.every((f) => f.fileHash !== null && f.fileHash!.length === 64),
    ).toBe(true);
  });

  it('does not duplicate books when fullScan() is called a second time', async () => {
    await libraryScannerService.fullScan();
    const books = await testApp.db.book.findMany();
    expect(books).toHaveLength(7);
  });
});
