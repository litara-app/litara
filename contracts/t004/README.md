# T004 contract preparation

Status: **model and scenario inventory only.** The T004 worker authors `openapi.json` here as milestone 1 and keeps it in parity with the Huma output, as T003 did. Policies are fixed by ADR-0044–0061; nothing here selects new architecture.

- [model.md](model.md): persistence boundary extending `contracts/t003/model.md`.
- [scenarios.json](scenarios.json): required generated-fixture scenarios and expected outcomes. Fixtures are generated at test time; no media is committed.

Conventions come from ADR-0038 (versioned `/api/v1`, UUIDs, zero-based paging, typed errors). Management routes require an administrator with a grant on the library (ADR-0056).
