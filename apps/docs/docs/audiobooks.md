---
sidebar_position: 5
---

# Audiobooks

Litara supports audiobook playback alongside your ebook library. Audiobook files are scanned automatically from your library folder and linked to their matching book record.

## Supported formats

| Format | Notes                                                       |
| ------ | ----------------------------------------------------------- |
| `.m4b` | Preferred — single-file audiobook with embedded chapters    |
| `.m4a` | Treated as a single-file audiobook when ≥ 45 min            |
| `.mp3` | Multi-file (3+ files in a folder) or a single file ≥ 45 min |

## How audiobooks are scanned

The library scanner detects audiobooks in two ways:

- **Single file** — an `.m4b`, `.m4a`, or long `.mp3` (≥ 45 min) file anywhere in the library folder is treated as a standalone audiobook.
- **Folder** — a directory containing any `.m4b`/`.m4a` file, or 3+ `.mp3` files, is treated as a multi-part audiobook. Files are ordered by numeric prefix in the filename.

When an audiobook is found, Litara extracts metadata (title, author, narrator, cover art, chapter markers) from the audio tags and links it to an existing or new book record.

Books that have an audiobook attached display a teal **Audio** badge on their card in the library grid.

## Playing an audiobook

Open any book that has an audiobook attached and go to the **Overview** tab. The **Audiobook** card shows the narrator (if available) and the total duration.

<img src="/img/audiobook-detail.png" width="900" alt="Book detail page showing the Audiobook card with Play button" />

Click **Play Audiobook** to start playback. The persistent player bar appears at the bottom of the screen and stays visible while you browse the rest of the library.

<img src="/img/audiobook-player.png" width="900" alt="Audiobook player bar at the bottom of the screen" />

### Player controls

| Control           | Description                        |
| ----------------- | ---------------------------------- |
| Play / Pause      | Toggle playback                    |
| Skip back 30 s    | Jump back 30 seconds               |
| Skip forward 30 s | Jump forward 30 seconds            |
| Progress slider   | Seek anywhere in the audiobook     |
| Playback speed    | 0.75× – 3× (saved across sessions) |
| Volume            | Saved across sessions              |
| Chapter list      | Jump to any chapter                |

Playback resumes from where you left off — progress is saved to the server every 10 seconds and restored the next time you open the player for that book.

## Audiobook progress

Progress is tracked separately from ebook reading progress. In the book detail panel you will see:

- A teal progress bar showing how far through the audiobook you are, labeled with elapsed time / total duration (e.g. **1h 12m / 8h 45m**).
- A reset button (✕) to clear your audiobook progress. A confirmation dialog appears before the progress is deleted.

For audiobook-only books (no attached ebook file), this progress bar is the only progress indicator shown in the left panel. When a book has both an ebook and an audiobook, both progress bars are displayed — one for the ebook (green, from Litara/KOReader) and one for the audiobook (teal).

### Currently Reading / Dashboard

Audiobooks that are in progress (started but not finished) appear in the **Currently Reading** section on the Dashboard alongside in-progress ebooks. The teal progress bar is shown on the book card for audiobook-only entries.

## Reorganize Library

When you run **Reorganize Library** from Admin Settings, audiobook files are reorganized to match the same canonical layout as ebooks:

**Single-file audiobooks:**

```
<libraryRoot>/<Author>/[<Series>/]<Title>.<ext>
```

**Multi-file audiobooks (folder):**

```
<libraryRoot>/<Author>/[<Series>/]<Title>/
```

The entire folder is moved as a unit. All `audiobookFile` database records are updated to reflect the new paths.

See [Library Management](./library-management) for full details on the reorganize operation.
