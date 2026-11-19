# TLS and the separate reader origin

Exercised with `python scripts/t007/tls_rehearsal.py` (35 checks, `research/t007/evidence/m3-tls-origins/`) behind a throwaway-CA TLS terminator, `scripts/t007/tlsproxy/` (stdlib Go; a rehearsal tool, not a deployment recommendation).

Requirements the server enforces or the rehearsal depended on:

* Two hostnames, one per origin, both routed to the server: the application hostname to `LITARA_HTTP_ADDR` (8080) and the reader hostname to `LITARA_READER_ADDR` (8081). Set `LITARA_WEB_DIR`, `LITARA_PUBLIC_ORIGIN`, `LITARA_READER_ORIGIN` (bare `https://host[:port]` origins) and `LITARA_ALLOWED_ORIGINS` (the application origin).
* The proxy must preserve the `Host` header and send `X-Forwarded-Proto: https` (the server marks cookies Secure from it), and must present a certificate clients can validate: the rehearsal clients refused wrong-name and unknown-CA handshakes.
* Do not set `LITARA_DEV_INSECURE_HTTP`. The server has no HTTP fallback; clients must not add one either.

Observed behavior: the app origin serves the SPA with CSP, nosniff and frame denial and refuses `/reader/` and `/api/` from the static handler; the reader origin serves only reader assets, denies `/`, `/api/*` and app routes, and grants no CORS; session cookies are Secure with SameSite; cookie writes need the CSRF token and an allowed Origin; the API grants no CORS to any origin; bearer login, original Range/HEAD, refresh rotation and session revocation work over TLS.

Not exercised: a production proxy (Caddy/nginx/Traefik) configuration, HSTS, certificate rotation, a real browser rendering the reader iframe, HTTP/2 specifics, WebSockets.
