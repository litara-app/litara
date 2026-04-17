---
sidebar_position: 4
---

# In-Browser Reader

Litara includes a built-in reader powered by [Foliate.js](https://github.com/johnfactotum/foliate-js). Open any supported book by clicking **Read** in the book detail panel.

**Supported formats:** EPUB, MOBI, AZW, AZW3, CBZ (comic books)

## Reading progress

Your position is saved automatically as you read (debounced, every ~1 second) and synced across sessions. When you reopen a book, the reader restores your last position. Progress is also shown as a thin green bar on book cards in your library and as a percentage in the book detail panel.

Litara tracks reading progress **per source** — the built-in reader (Litara) and KOReader each maintain their own independent progress record. Opening a book in the Litara reader will never overwrite your KOReader position, and vice versa.

The book detail panel shows a progress bar for each source that has recorded progress, color-coded green (Litara) and blue (KOReader). Each bar has an individual clear button. You can control which source's progress appears on book cards and the dashboard in **Settings → KOReader Sync → Progress display preference**.

## Keyboard shortcuts

All shortcuts work when the reader iframe has focus (i.e., while reading). Most also work when the toolbar is focused.

| Key(s)            | Action                                 |
| ----------------- | -------------------------------------- |
| `→` / `←`         | Next / previous page                   |
| `Space`           | Next page                              |
| `Shift + Space`   | Previous page                          |
| `f` or `Ctrl + F` | Open search bar                        |
| `Enter`           | Next search result                     |
| `Shift + Enter`   | Previous search result                 |
| `Escape`          | Close search (if open), or exit reader |
| `+` / `=`         | Increase font size                     |
| `-`               | Decrease font size                     |
| `1`               | Switch to Light theme                  |
| `2`               | Switch to Sepia theme                  |
| `3`               | Switch to Dark theme                   |
| `?`               | Show keyboard shortcuts panel          |

The keyboard shortcuts panel is also accessible from the toolbar (keyboard icon).

## Search

Press `f` or `Ctrl + F` to open the search bar. As you type, the reader searches the entire book and highlights all matches. The count shows your current position in the results (e.g., `3 / 12`).

- **Enter** or the `›` button — jump to the next match
- **Shift + Enter** or the `‹` button — jump to the previous match
- **Escape** or the `✕` button — close search and clear highlights

Search is case-insensitive by default and uses Unicode-aware matching for better results across languages.

## Appearance

Font size and theme (Light / Sepia / Dark) are saved to `localStorage` and restored on your next reading session. The reader defaults to matching your app theme (dark or light) on first use.

## Footnotes

For EPUBs that use standard footnote markup (`epub:type="noteref"`), clicking a footnote reference opens the footnote content in a panel at the bottom of the screen instead of navigating away from the current page. Press **Escape** or the `✕` button to dismiss it.

## Highlights and annotations

Litara lets you highlight text, underline it, add strikethroughs, and attach personal notes — all saved to your library and synced across sessions.

### Highlighting text

1. Select any passage of text in the reader by clicking and dragging.
2. A popover appears with annotation options.
3. Choose a highlight color (yellow, green, blue, or pink), **Underline**, or **Strikethrough**.
4. Optionally type a note in the text field.
5. Click **Save** — the annotation is stored and the text is visually marked immediately.

Clicking on an existing annotation opens the same popover, letting you edit the note, change the style, or delete it.

:::note
Highlights and annotations are currently supported for EPUB files. Other formats open without the text-selection popover.
:::

### Bookmarks

To bookmark the current page, click the **bookmark icon** (🔖) in the reader toolbar. The icon fills to indicate the page is bookmarked. Click it again to remove the bookmark.

Bookmarks appear in the in-reader annotations panel and on the global [Annotations page](./annotations).

### In-reader annotations panel

Click the **list icon** in the reader toolbar to open the annotations panel on the right side of the reader. The panel lists every highlight, note, and bookmark for the current book:

- **Click any entry** to jump directly to that location in the book.
- **Click the trash icon** to delete an annotation from the panel.

The panel stays open as you read; close it with the `✕` button in its header.
