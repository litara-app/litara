## ADDED Requirements

### Requirement: Audiobook progress included in book list response

The system SHALL include audiobook progress data (`audiobookProgress`) alongside ebook reading progress in the book list and book detail API responses, so that clients can display a unified "progress" indicator for both formats.

#### Scenario: Book list includes audiobook progress when present

- **WHEN** an authenticated user requests `GET /api/v1/books` and has an `AudiobookProgress` record for one or more books
- **THEN** each book object in the response includes an `audiobookProgress` field containing `{ currentFileIndex, currentTime, totalDuration, completedAt }` or `null` if no progress exists

#### Scenario: Book with both ebook and audiobook progress returns both

- **WHEN** an authenticated user has reading progress for an ebook and audiobook progress for the same book
- **THEN** the book response contains both `readingProgress` (existing) and `audiobookProgress` (new) fields

---

### Requirement: Audiobook completion counted in library statistics

The system SHALL count a book as "completed" in library statistics when `AudiobookProgress.completedAt` is non-null, alongside books completed via ebook reading progress.

#### Scenario: Audiobook completion reflected in read count

- **WHEN** the user has `AudiobookProgress.completedAt` set for a book
- **THEN** that book is counted as "read" in the dashboard statistics, even if no ebook `ReadingProgress` record exists
