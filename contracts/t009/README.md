# T009 additions

Governing decision: ADR-0081 (book details and personal rating, review and reading dates).

- `GET /editions/{editionId}/details`: effective publisher, published date, page count, ISBN, synopsis and added time.
- `GET`/`PUT /titles/{titleId}/personal`: the caller's own rating (half stars, 1-10), review and date overrides, with a base revision and operation ID like other personal writes. Another account's values are never returned.
- `GET /recordings/{recordingId}/details`: the same for an audiobook recording (no page count).
- Metadata fields `publisher`, `published`, `page_count`, `isbn` and `description` are added to the T005 edition metadata enum (`contracts/t005/openapi.json`).

`scripts/contracts/compare.py` merges this file and compares it with the generated API.
