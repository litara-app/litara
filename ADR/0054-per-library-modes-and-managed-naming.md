# ADR-0054: Configure library modes and preview managed-import templates

Status: Accepted
Date: 2026-11-13
Decision owner: Repository owner

## Context

ADR-0004 accepts existing folders and optional managed imports; ADR-0046 selects copy-only reviewed imports. Naming/configuration granularity remained open.

## Decision

The user selected the following on 2026-11-13:

- Choose existing-folder or managed-import mode per library.
- Existing-folder mode retains paths.
- Start managed-import naming with Author/Title/Edition-or-recording/Original filename, with a per-library template and destination preview.
- Changing a mode or template must not automatically reorganize existing files.

## Alternatives

- One fixed managed layout for all libraries.
- Per-library modes/templates and explicit destination previews, as selected.

## Consequences

Treat template expansion as a plan under the target root, not arbitrary path execution. Sanitize filename components and apply the accepted collision suffix policy. Preserve leaf filenames by default and distinguish editions/recordings in destination directories. Existing files are not implicitly renamed when configuration changes; any future reorganize operation requires its own explicit plan/authorization. Managed imports preserve their external sources under ADR-0046.

## Verification

Planned for T004: mode/template isolation, proposed destinations, missing/special-character metadata, collisions, template traversal attempts and configuration changes leaving existing names/bytes unchanged. No runtime import operation was tested in this decision session.

## Open questions

Concrete template tokens, fallback labels, path-length/platform normalization and the versioned review-plan schema must be specified in the T004 brief within these rules.
