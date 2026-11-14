# ADR-0049: Include opt-in Open Library Google Books and Audnexus enrichment

Status: Accepted
Date: 2026-11-13
Decision owner: Repository owner

## Context

The archived implementation contains Open Library, Google Books and Audnexus providers. Current primary documentation was checked; Audnexus now recommends AudiobookDB for new projects while stating Audnexus remains maintained. The user explicitly selected Audnexus now rather than deferring the audio provider.

## Decision

The user selected the following on 2026-11-13:

- Include Open Library and Google Books for external metadata, plus Audnexus for audio in T004.
- External lookups remain disabled until enabled per library.
- Never upload book files to these providers.

## Alternatives

- Local/sidecar metadata only.
- Ebook providers now, audio provider later.
- Include Audnexus for audio now alongside opt-in ebook providers, as selected.

## Consequences

Use provider APIs behind an adapter boundary; do not copy provider server implementations into the MIT backend. Expose configuration/missing-key/unavailable states, honor current quotas/identification terms, cache permitted responses and use bounded durable enrichment jobs. Enabled lookups may transmit identifiers or title/author/narrator search terms; document this per-library boundary. No external account credentials or keys in Git/logs. Provider failures never delete catalog data or overwrite protected values. AudiobookDB and other providers are not selected by the Audnexus successor notice.

## Verification

Planned for T004: all providers disabled by default, per-library enablement, no file upload, identifier/search fixtures, unavailable/key/rate-limit behavior, cancellation/retry, provenance and protected gaps. Use recorded synthetic responses for deterministic tests and report any live-provider checks separately.

Documentation evidence is in [reference observations](../research/t004/reference-observations.md), with primary links and the Audnexus successor caveat.

## Open questions

ADR-0060 now selects provider preference and match acceptance/review rules. Credentials/configuration, current quotas/terms and live availability must be checked during implementation; this ADR does not guarantee third-party uptime or accept AudiobookDB.
