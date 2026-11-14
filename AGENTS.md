# Litara rebuild instructions

## Sources of truth

- The active project is a fresh Litara rebuild with a Go backend.
- Read `TASKS.md` for external-agent assignments, write scopes, and handoff requirements. Only the coordination owner updates that register. Workers write their own `handoffs/Tnnn.md`, stay within the assigned package, and do not accept ADRs or claim another agent's work. A separate clone/worktree must start from a committed rebuild checkpoint; uncommitted root decisions are not available through Git pull.
- T003 assignment source is `handoffs/T003-assignment.md`; its shared wire contract/model/fixtures live in `contracts/t003/`. Read both before implementation. The register identifies the committed start point and exclusive ownership.
- Architectural decisions live directly in `ADR/`. Read `ADR/README.md` and relevant accepted ADRs before designing or changing behavior.
- `archive/litara-v1/` is historical reference, not the active application. Do not modify, build, format, or include it in active dependency discovery unless the user explicitly requests archive work. Archived agent instructions apply only to historical reference work.
- The Android starting point is `deranjer/bookorbit-android`, not the archived Expo application. Preserve its Chromecast and Android Auto work; see ADR-0005.

## ADR enforcement

- Before implementing an architectural choice, find an accepted ADR that authorizes it. If none exists, write a proposed ADR and ask the user for the actual decision. Continue independent work while awaiting the answer.
- Only explicit user choices may move an ADR to Accepted. Recommendations, elapsed time, and proposals are not approval.
- Record the user's decision promptly, including context, alternatives, consequences, and concrete verification requirements. Do not turn unresolved subquestions into accepted decisions.
- A change that conflicts with an accepted ADR requires a new proposed superseding ADR and user acceptance before implementation. Preserve the old decision, mark it Superseded, and link both directions when the replacement is accepted.
- Use sequential four-digit IDs and the template in `ADR/TEMPLATE.md`. Keep the index synchronized. Proposed ADRs must identify their open questions.
- Each architectural change must identify its governing ADR in its PR description (or handoff when no PR is requested). Review must check actual behavior against that ADR; the structural checker cannot infer architectural compliance.
- Run `pwsh -NoProfile -File scripts/Validate-Adrs.ps1` after ADR edits. CI validates structure and the decision index; it does not approve decisions.
- React/TypeScript/Mantine, the first-release scope, local login with library access, an open versioned API, revision-aware resume conflicts, and a modular Go application with durable PostgreSQL-backed jobs are accepted. Android belongs in `apps/android/`. ADR-0024 selects net/http + Huma, sqlc/pgx, Goose, and River core. ADR-0027 selects pristine Foliate plus direct PDF.js for web while preserving Android's reader initially. ADR-0028 selects bundled native ffprobe/FFmpeg executables. ADRs 0031–0043 now select the T003 account/auth/API/offline/progress/readiness policies. Implement their concrete contract under `contracts/t003/`; do not silently choose unresolved ingestion, binary/platform, conversion or production policies.

## Research and implementation

- Use the existing Litara implementation and pinned BookOrbit/Android references in `ADR/RESEARCH.md` to compare concrete behavior. Distinguish code observations from advertised features and recommendations.
- Use Context7 MCP for current library, framework, SDK, API, CLI, and cloud documentation. Start with `resolve-library-id` unless an exact `/org/project` ID was supplied, then `query-docs` for each distinct concept. Do not use it for general programming questions or code review unrelated to platform APIs.
- Backend/web first-party work remains MIT; Android retains AGPL under ADR-0017, which supersedes ADR-0012. Preserve third-party licenses, notices, and provenance. MIT relicensing is no longer a prerequisite to Android reuse under AGPL. Restore missing reader/vendor notices at import. Do not copy AGPL Android/BookOrbit reader modifications into MIT web/backend source without compatible rights.
- Android plays specific recordings using stable opaque file/recording IDs and content versions. Audio positions are file/version plus millisecond offset with layout-change detection and revision-aware conflicts. Use bearer-authenticated app-to-server media and the preserved phone Cast proxy; rotating native refresh tokens have per-device revocable sessions. Completion belongs to editions/recordings with title history. Preserve full and Cast-free F-Droid build paths. Read ADR-0018 through ADR-0023 for boundaries and unresolved protocol details.
- Target the broad format matrix in ADR-0025; recognition is not full support. Keep explicit incomplete/unsupported capability states. ADR-0028 supersedes ADR-0026: use bundled native ffprobe for inspection and bundle FFmpeg for explicitly designed media operations. Automatic transcoding is not selected. Preserve original files. WASM testing is deferred research, not a production dependency or implementation blocker; keep its module/results separate from the application.
- ADR-0029 selects file/version-relative chapter starts with server-derived whole-recording times. Protect user edits, then prefer valid associated CUE over embedded chapters; generate clearly identified file-boundary markers when chapters are absent. ADRs 0039/0042 select incomplete-recording readiness and whole-source validation; T003 wire fields are specified in `contracts/t003/`. Real CUE association and ingestion policies remain T004 decisions.
- Avoid running old release workflows or hooks as part of the rebuild. Old deployment configuration is archived.
- Preserve secrets, signing keys, local books, and user data without adding them to Git. Do not restore pre-existing deletions unless requested.
- Verify changes with checks appropriate to their impact. State explicitly when runtime behavior or hardware behavior has not been tested.
