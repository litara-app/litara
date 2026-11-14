# ADR-0006: Separate titles, editions, recordings, and physical files

Status: Accepted
Date: 2026-11-12
Decision owner: Repository owner

## Context

Litara attaches ebook and audiobook files to a book. BookOrbit can group a book by its folder or file. Neither folder identity nor matching title text alone is sufficient to distinguish translations and recordings.

## Decision

The user selected one title with separate editions/recordings beneath it. Exact reading locations belong to the specific file. Folder layout must not dictate title identity.

## Alternatives

- One book per folder.
- Separate entries per file or audiobook folder with manual links.
- A title with distinct editions and recordings, as selected.

## Consequences

A shared title can present related media without assuming location equivalence. Translations, abridgements, and narrations remain distinguishable. An audiobook recording may span several ordered files. Automatic grouping rules and cross-format progress conversion are separate decisions.

## Verification

Planned: an EPUB, a translated EPUB, and two audio recordings can share a title while retaining separate edition/recording identities. Saving a location in one file cannot silently overwrite an incompatible file's location. Moving a file must not inherently create a new title.

## Open questions

Matching confidence, merge/split controls, and the file-version matching algorithm remain undecided. ADR-0018 selects stable opaque IDs/content versions, ADR-0019 defines audio position anchors, and ADR-0022 selects edition/recording completion with title history.
