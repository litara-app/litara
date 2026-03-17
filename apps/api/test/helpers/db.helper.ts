import { DatabaseService } from '../../src/database/database.service';

/**
 * Truncate all user-data tables in FK-safe order.
 * CASCADE handles any remaining FK constraints automatically.
 *
 * Works with any object that exposes `$executeRaw` (DatabaseService or a raw PrismaClient).
 */
export async function cleanDatabase(db: DatabaseService): Promise<void> {
  await db.$executeRaw`
    TRUNCATE
      "BookShelf",
      "SmartShelfRule",
      "UserReview",
      "UserBookLibrary",
      "ReadingProgress",
      "Annotation",
      "BookFile",
      "BookAuthor",
      "SeriesBook",
      "Book",
      "Author",
      "Series",
      "Tag",
      "WatchedFolder",
      "UserSettings",
      "Shelf",
      "Library",
      "User",
      "Task",
      "Log",
      "ServerSettings"
    CASCADE
  `;
}
