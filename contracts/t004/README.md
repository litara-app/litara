# T004 contract preparation

Status: **milestone 1 in progress.** `openapi.json` covers library management only (createLibrary, getLibraryAdmin, putLibraryConfig); it was extracted from the implemented Huma output and is merged with the T003 contract by `scripts/contracts/compare.py`. Scan, review, import and write-back operations are still to be specified. Policies are fixed by ADR-0044–0061; nothing here selects new architecture.

- [model.md](model.md): persistence boundary extending `contracts/t003/model.md`.
- [scenarios.json](scenarios.json): required generated-fixture scenarios and expected outcomes. Fixtures are generated at test time; no media is committed.

Conventions come from ADR-0038 (versioned `/api/v1`, UUIDs, zero-based paging, typed errors). Management routes require an administrator with a grant on the library (ADR-0056).
