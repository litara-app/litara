# Historical reference

`litara-v1/` contains the 31 root entries present before the 2026-11-12 rebuild archive, including source, documentation, deployment files, installed dependencies, local data, and local signing material where present. Ignored local files remain local and must not be committed. Moving dependencies preserves them as reference; it does not guarantee relocated tooling or links remain runnable.

Git metadata stays at the repository root. A copy of the original license stays there as well. The old GitHub workflows are inside the archive and are no longer active workflows.

Inside `litara-v1/`:

- `source-commit.txt` records the original HEAD.
- `pre-archive-status.txt` records the working-tree status before moving anything.
- `archived-root-entries.txt` lists the moved entries.

Many OpenSpec, package, script, and fixture files were already deleted before archiving. Those deletions were preserved; missing content can still be referenced in Git history. This is an archive of the existing working tree, not a restored checkout or a backup of an external database.

Do not change or recursively process the archived stack during normal development.
