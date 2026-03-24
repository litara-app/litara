# Documentation Screenshots

PNG files used in the Docusaurus documentation site are stored at
`apps/docs/static/screenshots/` (served by Docusaurus as `/screenshots/*.png`).

This directory is kept as a placeholder.

## Regenerating

Run the following command from `apps/web` with a `dev:e2e` stack running, then commit the updated PNGs:

```bash
npm run screenshots
```

Output goes to `apps/docs/static/screenshots/`. These files are **not updated automatically by CI** — only a deliberate local run followed by a commit updates them.

## Files

| File              | Page                          |
| ----------------- | ----------------------------- |
| `login.png`       | Login page                    |
| `dashboard.png`   | Dashboard with imported books |
| `book-detail.png` | Book detail modal (open)      |
| `settings.png`    | Settings page                 |

## CI behaviour

The advisory PR job writes screenshots to `playwright-screenshots/` and uploads them as a GitHub Actions artifact named **`ui-screenshots`**. Nothing is ever committed by CI.
