---
sidebar_position: 9
---

# Disk Writing

By default, Litara is **read-only** — it never modifies, renames, or deletes your ebook files. Disk writing must be explicitly enabled before any write operations are permitted.

:::note Admin only
Disk write settings and sidecar operations are available to admin users only, via **Admin Settings → General**.
:::

## Allow Disk Writes

The **Allow Disk Writes** toggle controls whether Litara is permitted to write any files to your ebook library directory. It defaults to **off**.

When disabled, all operations that would write to disk (such as writing sidecar files) are blocked and will return an error if triggered via the API.

When you enable the toggle, Litara immediately probes the library directory with a temporary file to verify the volume is actually writable. If the probe fails (for example, the directory is mounted read-only at the OS level), a warning is shown and the toggle cannot be saved as enabled.

## Sidecar Files

A **sidecar file** is a `.metadata.json` file written alongside an ebook file, using the same base filename:

```
The Great Gatsby - F Scott Fitzgerald.epub
The Great Gatsby - F Scott Fitzgerald.metadata.json   ← sidecar
```

The sidecar stores the book's metadata in a portable JSON format so it travels with the file if you move or back up your library.

### Writing a sidecar for a single book

On any book's detail page, open the **Sidecar** tab. If disk writes are enabled, a **Write to Disk** button is available. Clicking it writes the current metadata to a sidecar file next to the book's EPUB (preferred) or other file.

If a sidecar file already exists at that path it is overwritten atomically — the new content is written to a temporary file first and then renamed into place, so a crash mid-write cannot leave a partial file.

### Bulk sidecar write

The **Write All Sidecars** button on the **Admin Settings → Metadata** page writes sidecars for every book in your library in the background. Progress is tracked on the **Tasks** tab, which shows:

- Books written, skipped (already up to date), and failed.
- Live progress during the run.

Books are processed with up to 10 concurrent workers. If a book has no associated files on disk the sidecar write for that book is skipped.

### Sidecar format

```json
{
  "title": "The Great Gatsby",
  "subtitle": null,
  "authors": ["F. Scott Fitzgerald"],
  "description": "...",
  "publisher": "Scribner",
  "publishedDate": "1925-04-10",
  "language": "en",
  "isbn13": "9780743273565",
  "isbn10": "0743273567",
  "pageCount": 180,
  "genres": ["Fiction", "Classic"],
  "tags": [],
  "seriesName": null,
  "seriesNumber": null,
  "googleBooksId": "...",
  "openLibraryId": "/works/...",
  "goodreadsId": "...",
  "goodreadsRating": 3.91
}
```

Fields that have no value are written as `null`. The file is UTF-8 encoded with 2-space indentation.

## Writing Metadata to Epub Files

Litara can write the current metadata stored in its database directly back into an EPUB file's OPF document. This is useful when you want the epub file itself to reflect updated titles, authors, descriptions, series info, ISBNs, genres, and tags — so the metadata travels with the file if you move it outside Litara.

:::note Epub only
Only EPUB files are supported. MOBI, AZW, CBZ, and PDF files cannot have their metadata written in this way.
:::

### Write metadata for a single book

On any book's detail page, click the **Edit Metadata** tab. If the book has an EPUB file and disk writes are enabled, a **Write to File** button is shown. Clicking it patches the OPF metadata inside the epub in-place using an atomic write (temp file → rename), so a crash mid-write cannot corrupt the original file.

The following fields are written:

| Written field  | OPF element / attribute                         |
| -------------- | ----------------------------------------------- |
| Title          | `<dc:title>`                                    |
| Description    | `<dc:description>`                              |
| Publisher      | `<dc:publisher>`                                |
| Published date | `<dc:date>`                                     |
| Language       | `<dc:language>`                                 |
| Authors        | `<dc:creator>` (all existing ones are replaced) |
| Genres + Tags  | `<dc:subject>` (all existing ones are replaced) |
| ISBN-13        | `<dc:identifier opf:scheme="ISBN-13">`          |
| ISBN-10        | `<dc:identifier opf:scheme="ISBN-10">`          |
| Subtitle       | `<meta name="dcterms:alternative">`             |
| Series name    | `<meta name="calibre:series">`                  |
| Series number  | `<meta name="calibre:series_index">`            |

:::note Series metadata format
Series fields are written using the Calibre convention (`calibre:series` / `calibre:series_index`) because it is widely supported by ebook readers and library managers. The [EPUB 3.3 specification](https://www.w3.org/TR/epub-33/#sec-belongs-to-collection) defines a standard `belongs-to-collection` property for this purpose, which Litara may also write in a future release.
:::

### Auto-write metadata to epub after bulk enrichment

The **Auto-Write Epub on Enrichment** toggle on **Admin Settings → Metadata** causes every completed bulk enrichment run to also write the updated metadata into the epub file. Only books with an epub file on disk are written; books with no epub are silently skipped.

Requires disk writes to be enabled and the library directory to be writable.

## Read-only Docker Mounts

If you want to **guarantee** that Litara can never write to your ebook directory — even if an admin accidentally enables disk writes — mount the volume as read-only in Docker Compose:

```yaml
services:
  api:
    volumes:
      - /path/to/your/ebooks:/books:ro # ← :ro makes it read-only at the OS level
```

With `:ro` the OS will reject any write attempt regardless of what is configured in Litara. The disk-write probe will detect this and show a warning in the UI, keeping the Allow Disk Writes toggle disabled.

This is the recommended approach for setups where the ebook directory is shared with other applications (such as an NFS mount or a Calibre library) and you want Litara to remain strictly non-destructive.
