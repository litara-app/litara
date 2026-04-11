---
sidebar_position: 10
---

# Library Management

Litara provides two admin tools for managing your library files on disk: **Reorganize Library** and **Download Backup**. Both are available in **Admin Settings → General → Library Management**.

:::note Admin only
These operations are available to admin users only.
:::

---

## Reorganize Library

Over time, books imported from an existing flat directory structure may sit in arbitrary locations rather than Litara's canonical layout. The **Reorganize Library** action moves every ebook file (and its sidecar, if present) to the correct location without touching any metadata.

### Canonical path layout

```
<libraryRoot>/<Author>/[<Series>/]<Title>.<ext>
```

Examples:

```
Brandon Sanderson/Mistborn/The Final Empire.epub
F. Scott Fitzgerald/The Great Gatsby.epub
```

If a book has no author metadata, it is placed under an `unknown/` directory. Enriching metadata before reorganizing is recommended for the cleanest result.

### What gets moved

- The ebook file itself (`.epub`, `.mobi`, `.azw`, `.azw3`, `.cbz`, `.pdf`)
- The Litara sidecar file (`.metadata.json`), if one exists alongside the ebook — it is moved to the same directory as the ebook and renamed to match the new ebook basename

### What does NOT get moved

- **KOReader progress directories** (`.sdr/`) — these are created by KOReader next to the ebook and are not tracked by Litara. If present they will be left behind at the old path and become orphaned. This does **not** affect Litara's KOReader Sync feature, which stores progress in the database and does not rely on `.sdr/` files.
- Any other third-party files placed alongside your ebooks (Calibre `.opf` files, custom cover images, etc.)

### How to run

1. Ensure **Allow Disk Writes** is enabled in **Admin Settings → General → Disk Writes**.
2. Click **Reorganize Library**. A confirmation dialog explains what will be moved and warns about orphaned files.
3. Confirm to start the background task.
4. Monitor progress on the **Tasks** tab. Each file is logged with one of these prefixes:

| Prefix            | Meaning                                                                       |
| ----------------- | ----------------------------------------------------------------------------- |
| `[skip]`          | File is already at the canonical path, or source not found on disk            |
| `[move]`          | File successfully moved to canonical path                                     |
| `[sidecar-move]`  | Sidecar file moved alongside the ebook                                        |
| `[sidecar-error]` | Sidecar move failed (ebook move still counts as success)                      |
| `[dedup]`         | Target already exists with the same content — DB path updated, no file moved  |
| `[collision]`     | Target already exists with different content — file skipped, resolve manually |
| `[error]`         | Unexpected failure for this file                                              |

The task completes with a summary line: `Done. Moved: X, Skipped: X, Collisions: X, Failed: X`.

### Idempotency and re-runs

The reorganize task is safe to run multiple times. Files already at their canonical path are skipped, so re-running after a partial failure will only process the remaining files.

### Move strategy

Litara uses `fs.rename` as the primary move operation (atomic, instant on the same filesystem). If `rename` fails — for example when the source and destination are on different mounts — it falls back to `fs.copyFile` + `fs.rmSync`. After each move, the vacated parent directory is removed if it is now empty.

:::caution Irreversible
File moves cannot be automatically undone. Consider downloading a backup before running reorganize on a large library.
:::

---

## Download Backup

The **Download Backup** button downloads a `.zip` archive of all book files currently tracked by Litara (files marked as missing are excluded).

### Archive layout

The zip uses paths relative to your library root, so the archive is portable:

```
Brandon Sanderson/Mistborn/The Final Empire.epub
F. Scott Fitzgerald/The Great Gatsby.epub
```

The filename is datestamped: `litara-backup-YYYY-MM-DD.zip`.

### Large library warning

If the total size of your library exceeds **2 GB**, a warning dialog is shown with the estimated size before the download begins. You can still proceed — the warning is informational.

If the size check fails (e.g. a network error), the warning dialog also appears so you can decide whether to continue.

### Notes

- The backup includes ebook files and their Litara sidecar files (`.metadata.json`), if present.
- For very large libraries (tens of GB), the download may time out depending on your network and server configuration. Consider taking a direct filesystem backup in those cases.
- Authentication is required; the download link is not shareable without a valid admin token.
