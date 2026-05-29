## ADDED Requirements

### Requirement: Admin-only folder browse endpoint rooted at EBOOK_LIBRARY_PATH

The system SHALL expose `GET /admin/folders?path=<relative>` (admin-only) that returns the immediate child directories of `{EBOOK_LIBRARY_PATH}/{path}`. The response SHALL be a JSON array of `{name, relPath, hasChildren}` entries, where `relPath` is the path relative to `EBOOK_LIBRARY_PATH`.

#### Scenario: List root contents

- **GIVEN** `EBOOK_LIBRARY_PATH = /books` containing folders `ebooks` and `audiobooks`
- **WHEN** an admin sends `GET /admin/folders?path=`
- **THEN** the response is `200` with entries for `ebooks` and `audiobooks`, each with `relPath` set to its name

#### Scenario: List nested folder

- **WHEN** an admin sends `GET /admin/folders?path=ebooks`
- **THEN** the response lists the immediate subfolders of `/books/ebooks` with their relative paths

#### Scenario: Non-admin is rejected

- **WHEN** a non-admin user sends `GET /admin/folders?path=`
- **THEN** the system returns HTTP 403

### Requirement: Path traversal is rejected

The endpoint SHALL resolve the requested path against `EBOOK_LIBRARY_PATH` using filesystem canonicalization (resolving `..` and symlinks). If the resolved path is not equal to `EBOOK_LIBRARY_PATH` or a descendant of it, the system SHALL return HTTP 400.

#### Scenario: Parent traversal is rejected

- **WHEN** an admin sends `GET /admin/folders?path=../etc`
- **THEN** the system returns HTTP 400 and does not list anything outside `EBOOK_LIBRARY_PATH`

#### Scenario: Symlink escaping root is rejected

- **GIVEN** `/books/escape` is a symlink pointing at `/etc`
- **WHEN** an admin sends `GET /admin/folders?path=escape`
- **THEN** the system returns HTTP 400

### Requirement: Non-existent path returns 404

When the resolved path does not exist or is not a directory, the endpoint SHALL return HTTP 404.

#### Scenario: Missing directory

- **WHEN** an admin sends `GET /admin/folders?path=does-not-exist`
- **THEN** the system returns HTTP 404
