# ADR-0048: One core per project — collapse the per-runtime `pan-wizard-core` copies for local installs

## Status

Accepted — option A (status quo) — 2026-09-10, by the maintainer, after the reality check framed the choice (plan item R16a). The per-runtime duplication is recorded here as an accepted cost; R16b is closed without implementation. Revisit trigger: a second runtime-neutral consumer that needs the shared core, or a measured version-drift incident that `hygiene scan` did not catch.

## Context

A local install selects one or more of the five runtimes, and each selected runtime directory receives its own complete copy of `pan-wizard-core/` — the engine, the workflows, the templates, the references, the MCP bridge. Measured on a packed `3.27.0` install into all five runtimes on 2026-09-10 (reality check RC18, reproduce with Phase 4.2 of `.claude/commands/reality-check.md`): five identical core trees, one per runtime directory, and a sixth under `.agents/pan-wizard-core/` when `--unified-skills` is on. Each copy is a few megabytes and a few hundred files. The duplication is a design consequence, not an accident:

- **Per-runtime self-containment.** Every runtime's commands embed a path into *its own* core (`~/.claude/pan-wizard-core/…`, `.opencode/pan-wizard-core/…`), so a runtime keeps working when another is uninstalled, and a global install of one runtime never depends on another's home.
- **Manifest ownership.** Each runtime's `pan-file-manifest.json` tracks the files it installed; uninstall removes exactly those.
- **The shared tree already exists for one case.** ADR-0028 Phase 2 introduced `.agents/pan-wizard-core/` as the runtime-neutral home for unified skills, with path rewriting (`rewriteSharedCoreMarkdown`) and a ref-counted uninstall (the last tracker removes and prunes). The per-runtime copies remained for the proprietary command trees.

What the duplication costs: disk and file count per project; five drift surfaces where one would do (a partial upgrade leaves two runtimes on two engine versions, which `hygiene scan`'s version-alignment check exists to catch); and five MCP server locations registered per project when one would serve every client.

## Options

**A — Status quo.** Keep one core per runtime directory. Cost: the duplication above. Benefit: no migration, no cross-runtime coupling, global installs and local installs share one code path.

**B — One core per project for local installs.** Local installs place the core once at `.agents/pan-wizard-core/` (the ADR-0028 location) and every runtime's commands, agents, hooks and MCP registration point there. Global installs are unchanged: their homes differ per runtime (`~/.claude`, `~/.config/opencode`, `~/.gemini`, `~/.codex`, `~/.copilot`) and cannot share a tree.

- Converters: the path rewriting exists (`rewriteSharedCoreMarkdown`, `rewriteUnifiedSkillCommandContent`); the proprietary command converters would take the same target.
- Manifests and uninstall: the shared tree's ref-counted uninstall exists; every runtime's manifest would record the shared core with a shared-owner marker, as unified skills do today.
- Hooks: the hook scripts resolve the engine relative to their runtime directory today; they would resolve the shared path instead, with a fallback to the per-runtime copy for older installs.
- MCP registration: one server path in every runtime's registration file.
- `--config-dir`: a custom runtime directory still points at the project's shared core.
- Migration: an upgrade over an existing five-copy install must either migrate (remove the per-runtime cores after re-pointing) or keep serving the old layout; `hygiene` would report the leftover copies.
- Failure domain: the shared tree is a single point of failure for every runtime in the project — the same trade ADR-0028 accepted for unified skills, mitigated by the same scenario matrix.

**C — Links.** Symlink or hardlink the per-runtime paths to one tree. Rejected: Windows symlinks need a privilege or Developer Mode, hardlinks do not cross volumes, and a link is invisible to the manifest.

## Decision

**A — status quo — accepted 2026-09-10.** The reality check recommended B scoped to local installs; the maintainer chose A: `hygiene scan`'s version-alignment check already catches the drift class, the footprint cost is disk only, and B would carry two install layouts indefinitely because global installs cannot share. If the revisit trigger in Status fires, B re-opens under the gates below.

Gates for accepting B: the `install-matrix` and `runtime-roundtrip` scenarios green on the new layout; the packed-install footprint measured before and after with the Phase 4.2 command; an upgrade from a five-copy install verified in `d:\pantesting`; `hygiene scan` recognising and offering to remove the orphaned per-runtime copies.

## Consequences

If A: nothing changes; RC18 stays an accepted cost and is recorded here so the next review does not rediscover it.

If B: one engine version per project, one MCP server per project, a smaller footprint, and a migration path that every existing local install will walk once. Global installs keep the per-runtime layout, so the installer carries both layouts indefinitely — the documentation must say which layout a given install has and why.
