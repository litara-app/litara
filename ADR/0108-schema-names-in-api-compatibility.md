# ADR-0108: Keep published schema names stable within `v1`

Status: Accepted
Date: 2026-11-26
Decision owner: Repository owner
Amends: [ADR-0082](0082-api-compatibility-policy-and-enforcement.md)

## Context

[ADR-0082](0082-api-compatibility-policy-and-enforcement.md) lists what breaks a `v1` client: among other things, removing or renaming a path, operation, `operationId`, parameter or property. It does not mention the names of component schemas (`components.schemas` in the OpenAPI document).

Observed on 2026-11-26, while 113 schema names were changed on branch `claude/api-schema-names` (commit `9e519b4`, before any API release):

- `go run ./cmd/ctl api-baseline check` passed before the baseline was updated.
- `go run ./cmd/ctl api-baseline update` then reported 0 changes.

The code explains both (`apps/server/internal/apicompat`). `Diff` follows each `$ref` and compares the two target schemas, never their names. `Verify` calls the baseline stale only when `Diff` returns a change. So a rename is neither breaking nor recorded. It would also pass against a released snapshot, without a new minor version. ADR-0082 says a non-breaking change to the surface is still recorded by regenerating the baseline; the check does not require that for a rename.

A rename does not change the JSON on the wire, so a hand-written HTTP client is unaffected. Client generators normally name types after component schemas, so a third party who regenerates from a newer server's document can get renamed or missing types and stop compiling. An app already built keeps working. The server sets no schema naming of its own, so the names come from Huma's default, which derives them from Go type names. An ordinary Go refactor can therefore rename a published schema without anyone noticing.

## Decision

On 2026-11-26 the repository owner, asked whether published schema names should be part of the `v1` API promise, chose "Yes, promise names". This accepts the recommendation this record proposed: published schema names are part of the `v1` promise.

- Where an operation reaches a named schema in the baseline or a released snapshot, the same place in the current document keeps that name. Changing it, or replacing the reference with an inline schema, is breaking.
- Giving a name to a schema that was inline also changes generated types, so it is breaking too.
- A new schema reached only through new operations or new properties is additive.
- Renaming a component that no operation reaches is not breaking.
- During development, a rename uses the existing named waiver. After the first release it needs a new major version, like any other break.

The decision was made before the first release, just after the names were cleaned up, while they could still change freely.

## Alternatives

- **Names are not promised (today's behavior).** Go types and schema names stay free to change. Document that generated clients should keep their own copy of the document and may need source changes after regenerating. Third parties can break at build time, with no record of when.
- **Record renames without forbidding them.** A rename counts as a change, so the baseline goes stale, it appears in the baseline diff, and after release it needs a new minor version. Nothing is prevented, but nothing changes silently.
- **Promise names only for some schemas,** such as request and response bodies. Fewer names are frozen, but someone has to maintain the list and generators use the other names too.

## Consequences

This record amends ADR-0082. Third parties who generate clients can regenerate within `v1` without renamed types. Go type names that Huma publishes become frozen after the first release; keeping a published name across a Go rename would need an explicit schema name or custom naming. A poorly chosen name stays until `v2`, so names should be reviewed before the first release.

Not covered by this record: names that generators derive for inline schemas (from property paths or union positions) are not component names and are not covered. Property names, `operationId`s and the rest of ADR-0082 do not change because of this record.

## Verification

Completed on 2026-11-26 (`apps/server/internal/apicompat`):

- Table tests: a renamed component, exchanged names, a reference made inline and an inline schema given a name are each breaking. A new schema under a new operation or property, a new named request union branch, a removed response union branch and a renamed unreachable component are not.
- A rename is found inside an array, a map, a union branch, a response header and a recursive schema.
- Each pair of old and new names is one change with one waiver ID, however many places use the schema. A renamed union branch is reported as a rename only when its shape is otherwise identical; if its shape also changed, it is reported as a branch added or removed.
- With an unrecorded rename, verification fails and `update` refuses it until a waiver names it.
- The apicompat tests, `TestAPIStaysBackwardCompatible` and `api-baseline check` pass against the committed snapshots, both on the working branch and on a copy of `origin/main` (`e64d650`) with these changes applied.
- Comparing the baseline before `9e519b4` with the baseline in it reports 109 name changes, each matching `scripts/contracts/schema_names.json`. The other four listed schemas belong to the smart shelf filter that ADR-0107 removed.

Not run: the full server test suite.

## Open questions

None within this record's scope.
