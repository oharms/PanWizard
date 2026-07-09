---
require-code-mention: true
---

# ADR-0027: Doc–Code Link Graph — `@pan:` Source Anchors & `links validate` Lint

## Status
Proposed

## Context

PAN's planning surface is a graph in everything but enforcement. ADRs reference specs, specs reference phases, phases reference modules, learnings reference workflows. The relationships exist; the integrity does not. When a module is renamed, a phase archived, or an ADR superseded, no tooling notices the dangling references — they surface as agent confusion ("I cannot find the file referenced in the plan") during exec, which is the worst possible time.

We have one partial mechanism today: `must_haves.key_links` in plan-file frontmatter, verified by `cmdVerifyKeyLinks` in [verify.cjs:376](../../pan-wizard-core/bin/lib/verify.cjs#L376). It checks that a regex pattern occurs in a target file. Its scope is narrow:

- Per-plan-file declaration only — ADRs, specs, learnings, references, and workflows have no link contract.
- Frontmatter-only — body-text references like "see ADR-0021" are not validated.
- One-directional — docs declare what they reference; **code does not declare which docs anchor it**. Renaming a module silently strands its ADR.
- No reverse query — "what depends on this ADR?" requires `grep`.

The recently-surveyed external project [`1st1/lat.md`](https://github.com/1st1/lat.md) demonstrates the missing half: `// @lat: [[section-id]]` source comments tie code to its documentation, and a single lint walks the whole graph. lat.md's full feature set (semantic search, MCP server, libsql, tree-sitter, TypeScript) is incompatible with PAN's zero-runtime-deps + CJS posture, but the **annotation convention and graph-lint pattern translate cleanly** and require no dependencies.

This ADR records the smallest valuable slice: an annotation convention for source files, a frontmatter assertion for docs that require a code backlink, and a single lint that walks both sides.

## Decision

Add a doc–code link graph as an additive extension to existing PAN doc/lint infrastructure. **Three** elements ship together; everything else is deferred.

### 1. Source-code annotation convention: `// @pan: <doc-id>`

Source files in `pan-wizard-core/`, `bin/`, `hooks/`, `commands/`, and `agents/` may carry one or more anchor comments:

```js
// @pan: ADR-0026
// @pan: docs/specs/self_improvement_loop_featureai.md
// @pan: learnings/universal/test-isolation
```

Rules:

- **Comment style is host-language idiomatic.** `//` for `.cjs`/`.js`, `#` for shell/Python, HTML comments for `.md`. The scanner accepts any of these so long as the literal token `@pan:` appears.
- **Doc IDs are paths or known short forms.** `ADR-NNNN` resolves to `docs/decisions/ADR-NNNN-*.md`; everything else is a repo-relative path.
- **An anchor is a claim**: "this file is a load-bearing implementation of that doc." Annotations are not required everywhere; they are required only where the *doc* asserts it (see element 3).
- **The convention is documentation, not gating.** Missing or incorrect anchors are lint findings, not commit blockers, until the team opts a doc into `require-code-mention`.

### 2. Doc-side frontmatter: `require-code-mention: true`

Any markdown doc — ADR, spec, learning, reference — may add a frontmatter field:

```yaml
---
require-code-mention: true
---
```

The lint then asserts that **at least one** source file under the scanned roots carries an `@pan:` anchor resolving to this doc. Docs without the field are treated as advisory; the absence of code mentions is silent.

This mirrors lat.md's `require-code-mention: true` semantics one-for-one. The choice of which docs opt in is the user's, not the tool's. Initial defaults (suggested, not enforced): all `docs/decisions/ADR-*.md` for accepted ADRs; specs are opt-in.

### 3. New CLI: `pan-tools links validate`

A single command produces a graph-integrity report. It runs three passes:

1. **Forward link resolution.** Walks `docs/`, `pan-wizard-core/{workflows,templates,references,learnings}/`, `commands/`, `agents/` for inline `[[<id>]]` references and frontmatter `must_haves.key_links` entries. Each link must resolve to a real file (and section, when supplied).
2. **Backlink contract.** For every doc with `require-code-mention: true`, scan source roots for `@pan:` anchors resolving to that doc. Zero matches → finding.
3. **Anchor target existence.** For every `@pan:` anchor, the resolved target must exist. A renamed ADR with a stale anchor → finding.

Output shape mirrors existing `validate health` JSON: `{ ok, findings: [{ type, severity, source, target, detail }] }`. Subcommands: `validate` (default), `--strict` (exit 1 on any finding), `--json` (machine output for hooks).

Implementation slot: a new `links.cjs` module under `pan-wizard-core/bin/lib/`, registered in `pan-wizard-core/bin/pan-tools.cjs`. The forward-link walker reuses the doc-lint walker in [pan-wizard-core/bin/lib/doc-lint/walk.js](../../pan-wizard-core/bin/lib/doc-lint/walk.js); the frontmatter parser reuses [frontmatter.cjs](../../pan-wizard-core/bin/lib/frontmatter.cjs); the source scanner is a 30-line regex over the source roots. No new runtime dependencies.

### What this ADR explicitly does NOT add

- **Inline `[[wiki-link]]` rendering or rewriting.** The lint *checks* such links; nothing transforms them.
- **`pan-tools links refs <doc>` (reverse-index query).** Implementable on top of the same scanner; deferred to a follow-up phase to keep this ADR small.
- **`pan-tools links expand <file>` (inline ref content into a prompt).** Belongs near `context-budget.cjs` and needs a budget contract; deferred.
- **Semantic search, embeddings, MCP server, vector DB.** Out of scope — violates zero-deps and overlaps with Claude Code's own MCP plumbing.
- **Tree-sitter / AST parsing.** Regex over comment lines is sufficient and stays consistent with [codebase.cjs](../../pan-wizard-core/bin/lib/codebase.cjs)'s regex-not-AST stance (per ADR-0021).
- **Auto-creation of anchors.** Humans place `@pan:` anchors; the tool does not infer them.
- **Pre-commit hook integration.** Runs on demand and inside `validate health`; commit-time enforcement is opt-in via `--strict` in user CI, not bundled.

## Consequences

### Positive

- **One name for one concept.** "Link graph" supersedes the ad-hoc mix of `key_links`, body-text refs, and unwritten conventions.
- **Renames stop being silent breakages.** Moving an ADR or renaming a `.cjs` module produces a finding the next time `validate links` runs.
- **Bidirectional traceability.** `@pan:` anchors make the implementation-of-an-ADR question answerable from the code side, not only the doc side.
- **Drop-in for existing infrastructure.** `key_links` keeps working; new lint subsumes it as a special case (frontmatter-declared link is just one shape of forward link).
- **Zero new runtime dependencies.** Pure CJS + regex + existing walkers.
- **Composable with `validate health`.** The umbrella health check can call `links validate` once `--full`-style cost is acceptable; intermediate solution is a separate top-level command.

### Negative

- **One more lint to keep green.** Docs with `require-code-mention: true` will fail the lint if their anchor module is deleted; someone must intervene.
- **Anchors are noise in source files.** A `.cjs` module implementing two ADRs and a spec carries three comment lines. Mitigation: anchors cluster at the top of the file under a single banner; convention documented.
- **The convention is human-enforced.** Nothing makes contributors place `@pan:` anchors; only the *doc-side* `require-code-mention` flag is enforced. This is deliberate — an over-eager rule ("every module must declare an anchor") would generate noise without improving the graph.
- **Two link styles coexist for one release.** Existing `must_haves.key_links` regex-based entries and new `[[<id>]]` inline references both pass `validate links`. Migration is opt-in, not forced. Authors of new docs should prefer inline refs; legacy `key_links` continue to work.
- **Doc-lint coverage expands.** `doc-lint.cjs` and `links.cjs` will overlap. Mitigation: `doc-lint.cjs` continues to handle prose/style; `links.cjs` owns reference integrity. Boundary is "is this about *this file's* shape, or about *cross-file* relationships?"

### Neutral / Tradeoffs considered

- **Why a new module, not an extension of `verify.cjs`?** `verify.cjs` is plan-file-centric (`cmdVerifyKeyLinks`, `cmdVerifyPlanStructure`); the link graph spans all docs and code. A focused module keeps both clean.
- **Why not a single `[[wiki]]` syntax to replace `key_links`?** `key_links` carries an extra field — a regex pattern — that asserts not just "the file exists" but "the file contains this token." Inline `[[wiki]]` is reference-only. They serve different needs; both stay.
- **Why `@pan:` and not a runtime-prefixed token (`@pan-claude:`)?** PAN ships into 5 runtimes from one source; the anchor describes a relationship in *PAN-the-tool*'s graph, independent of which runtime the reader is using.
- **Why opt-in `require-code-mention` rather than scan-everything?** Some docs are aspirational (future ADRs, design notes). Forcing a code mention for every doc in `docs/` would either be spammed with anchors-of-convenience or hold ADRs hostage to implementation status.

## Implementation Notes

### Files added

| File | Purpose |
|------|---------|
| `pan-wizard-core/bin/lib/links.cjs` | New core module — graph walker + lint |
| `commands/pan/links.md` | New command — exposes `links validate` |
| `tests/links.test.cjs` | Unit tests for forward/backlink/anchor passes |
| `tests/scenarios/links-graph.test.cjs` | Scenario test — full repo against the lint |
| `docs/specs/doc_code_link_graph_featureai.md` | Spec (W0 prerequisite) |

### Files modified

- `pan-wizard-core/bin/pan-tools.cjs` — register `links` subcommand.
- `pan-wizard-core/bin/lib/verify.cjs` — `cmdValidateConsistency` calls into `links.validateAll()` for a graph summary line in `validate health` output (advisory, not blocking).
- `pan-wizard-core/bin/lib/frontmatter.cjs` — recognize `require-code-mention` as a known field (no parser changes; it's already preserved).
- `docs/USER-GUIDE.md`, `docs/CLI-REFERENCE.md`, `docs/ARCHITECTURE.md` — document the convention and command.
- `CLAUDE.md` counts table — module count and command count update on ship.

### Rollout phases

| Phase | Scope | Gate |
|-------|-------|------|
| W0 | Spec at `docs/specs/doc_code_link_graph_featureai.md` | Reviewed |
| W1 | `links.cjs` + dispatcher + unit tests for forward-link & anchor-target passes | All tests green |
| W2 | Backlink-contract pass + `require-code-mention` opt-in + scenario test | `validate links` green against current repo |
| W3 | Wire summary line into `validate health` + docs + opt three accepted ADRs into `require-code-mention: true` as the canary | `validate health` shows graph row; canary ADRs have anchors |

`refs` and `expand` follow as separate ADRs (or as v3.8 phases) once the graph itself is trustworthy.

### Rollback plan

Entirely additive. Steps:

- Remove `pan-wizard-core/bin/lib/links.cjs` — `pan-tools links validate` becomes "command not found".
- Remove the `links.validateAll()` call from `cmdValidateConsistency` — `validate health` returns to its pre-W3 shape.
- Strip `require-code-mention: true` from the canary ADRs (or leave them; the field is harmless when no lint reads it).
- `@pan:` comments are valid host-language comments and harmless if the lint is removed.

No schema changes, no manifest changes. Rollback is a commit-level revert.

### References

- Predecessor: `cmdVerifyKeyLinks` in [verify.cjs](../../pan-wizard-core/bin/lib/verify.cjs#L376) — frontmatter-declared link verification (the link graph's first slice)
- Predecessor: ADR-0021 (Codebase Mapper v2) — established regex-not-AST as the codebase-analysis stance
- Predecessor: ADR-0026 (Self-Improvement Loop) — established the `learnings/{universal,internal}/` two-tier delivery; its docs become natural opt-in candidates for `require-code-mention`
- External inspiration: [`1st1/lat.md`](https://github.com/1st1/lat.md) — `// @lat:` annotation convention and `lat check` graph lint. The full project (TS, libsql, tree-sitter, MCP server, embeddings) is rejected; the convention and the lint pattern are adopted.
- Related infrastructure: [doc-lint.cjs](../../pan-wizard-core/bin/lib/doc-lint.cjs) and the walker in [doc-lint/walk.js](../../pan-wizard-core/bin/lib/doc-lint/walk.js) — reused, not duplicated

## Future scope

- **`pan-tools links refs <doc>`** — reverse query: "what files anchor or reference this doc?" Cheap once the scanner exists; separate ADR or v3.8 phase.
- **`pan-tools links expand <file>`** — inline `[[<id>]]` content into a prompt before sending to an agent, gated by [context-budget.cjs](../../pan-wizard-core/bin/lib/context-budget.cjs). Replaces a class of "the agent didn't have the ADR loaded" failures.
- **Auto-anchor suggestion in `pan-optimizer`** — when the optimizer harvests a session that touches `<file>` and a recently-modified ADR, propose an `@pan:` anchor as a learning. Only after the manual graph is stable.
- **Promote `key_links` to a special-cased forward link** — eventual unification, contingent on a low-friction migration story for existing plan files.
- **Commit-hook gate** — opt-in via repo-local hooks once the graph has been green for two release cycles.
