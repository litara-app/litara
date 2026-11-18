# M2 evidence: opt-in metadata providers against current upstream documentation (2026-11-18)

Providers are opt-in per library (`providerOrder` is empty by default; the disposable stack leaves it empty). Checked with public documentation pages and one public synthetic query each ("The Hobbit", a well-known public-domain-adjacent title, and a public Audible ASIN); no private library data was sent. The server's adapters live in `apps/server/internal/metadata/provider.go`.

| Provider | Adapter use | Upstream documentation / terms observed | Live check |
| --- | --- | --- | --- |
| Open Library (`open_library`) | `search.json` with `fields=key,title,author_name`, `limit=5`, User-Agent `Litara (self-hosted metadata lookup)` | Page https://openlibrary.org/developers/api: unidentified clients get 1 request/s, identified clients (User-Agent naming the application **with contact email or phone**) 3/s; no bulk downloading through the API (use data dumps); cache responses; no use as the backend of high-traffic commercial services; violations may be throttled or blocked. A separate licensing page was not read. | HTTP 200, response shape matches the adapter fields (`key`, `title`, `author_name`) |
| Google Books (`google_books`) | `volumes?q=...&maxResults=5`, optional operator key (`LITARA_GOOGLE_BOOKS_API_KEY`) | https://developers.google.com/books/docs/v1/using: public-data requests must carry an API key or OAuth token to be identified; quotas not stated on that page. Terms page: no charging users for an application using the API without a separate agreement; content removal duty for stored content on infringement notices. Caching/storage rules sit in the incorporated Google APIs Terms, which were not read. | **A keyless request returned 429 "Queries per day" quota exceeded** (shared anonymous quota); keyless use is unreliable, so a per-operator key is effectively required |
| Audnexus (`audnexus`) | `GET /books/{asin}` only (no title search) | https://github.com/laxamentumtech/audnexus: GPL-3.0 open source; hosted API terms and rate limits not published; the maintainers say new projects should start with its community-maintained successor AudiobookDB; chapters endpoint needs Audible tokens (not used by Litara). | HTTP 200 for a public ASIN on `api.audnex.us` |

Findings (no provider was substituted):
1. **Open Library identification:** our User-Agent has no contact detail, so we are an unidentified 1 req/s client under their rules. Adding an operator-configurable contact to the User-Agent is a small change; the choice of what contact string to send is the operator's (privacy), not decided here.
2. **No client-side rate limiting:** the adapters have no throttle, back-off or `Retry-After` handling (grep of `metadata/`); a large scan with lookups enabled could exceed 1 to 3 req/s and be blocked. Needs a bounded rate limiter (not implemented in T007 to avoid broadening scope).
3. **Google Books needs a key in practice** (429 without one). The key option exists; the operator docs should say so.
4. **Audnexus successor and unstated terms:** a policy choice for the user (keep, replace with AudiobookDB, or drop); not substituted.
5. Terms not fully read: Google APIs Terms (caching/storage), Open Library licensing page. Persistent storage of provider results as evidence should be reviewed against them before release.

Not covered: Atom/event hints (ADR-0050), provider outage behavior against live services, response-size limits against hostile responses (unit-tested locally in `providers_test.go`, inherited).
