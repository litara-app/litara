/**
 * Registered NestJS configuration factory.
 * Values defined here are accessible via ConfigService.get('<key>').
 * Environment variables always take precedence; these provide typed defaults.
 */
export default () => ({
  /**
   * Path to the directory that contains ebook files.
   * Defaults to /books (the standard Docker volume mount path).
   * Override with the EBOOK_LIBRARY_PATH environment variable.
   */
  ebookLibraryPath: process.env.EBOOK_LIBRARY_PATH ?? '/books',

  /**
   * Path to the book drop folder. Files placed here are automatically
   * ingested into the admin review queue. Must be separate from ebookLibraryPath.
   * Override with the BOOK_DROP_PATH environment variable.
   */
  bookDropPath: process.env.BOOK_DROP_PATH ?? '',
});
