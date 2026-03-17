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
});
