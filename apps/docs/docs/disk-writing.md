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
