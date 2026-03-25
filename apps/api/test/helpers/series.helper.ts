import { DatabaseService } from '../../src/database/database.service';

/**
 * Seeds a copyright-free "Oz" series fixture using L. Frank Baum's public-domain novels.
 * Creates: Series, Author, Library, 2 Books, BookAuthor, SeriesBook records.
 */
export async function seedOzSeries(db: DatabaseService) {
  const library = await db.library.create({
    data: { name: 'Oz Test Library' },
  });

  const author = await db.author.create({
    data: { name: 'L. Frank Baum' },
  });

  const series = await db.series.create({
    data: { name: 'Oz', totalBooks: 14 },
  });

  const book1 = await db.book.create({
    data: {
      libraryId: library.id,
      title: 'The Wonderful Wizard of Oz',
      coverData: Buffer.from('fake-cover-oz1'),
      files: {
        create: [
          {
            filePath: '/fake/oz1.epub',
            format: 'EPUB',
            sizeBytes: BigInt(1024 * 100),
            fileHash: 'oz1' + 'a'.repeat(61),
          },
        ],
      },
      authors: { create: [{ authorId: author.id }] },
    },
  });

  const book2 = await db.book.create({
    data: {
      libraryId: library.id,
      title: 'The Tin Woodman of Oz',
      coverData: Buffer.from('fake-cover-oz12'),
      files: {
        create: [
          {
            filePath: '/fake/oz12.epub',
            format: 'EPUB',
            sizeBytes: BigInt(1024 * 90),
            fileHash: 'oz12' + 'b'.repeat(60),
          },
        ],
      },
      authors: { create: [{ authorId: author.id }] },
    },
  });

  await db.seriesBook.create({
    data: { seriesId: series.id, bookId: book1.id, sequence: 1 },
  });

  await db.seriesBook.create({
    data: { seriesId: series.id, bookId: book2.id, sequence: 12 },
  });

  return { library, author, series, book1, book2 };
}
