# Multi-Track Planning Roots & Milestone Resolution — Feature Specification

**Generated:** 2026-08-21
**Version:** 1.0
**Status:** Implemented
**Source:** Field defect report against PAN 3.25.0, filed from a host repository holding four independently-planned products in one git repo (planning trees at `.planning/` plus `.planning/tracks/{core,defense,verify}/`)

---

## Problem Statement

Two defects, both confirmed still present in 3.26.0. They share a shape worth naming up front: **each fails by silently succeeding against the wrong thing.**

### D1 — No command could target a planning track

Every command resolved `.planning/` relative to its working directory with no way to point elsewhere. In a repo with more than one planning tree, three of four were unreachable, and the commands did not fail — they succeeded against the wrong tree.

| Command | Intended target | Actual |
|---|---|---|
| `hygiene scan` | all four tracks | scanned `.planning/` only; reported **clean** while `tracks/verify/optimization/traces` held 18 sessions against a retention of 5 |
| `milestone-audit` | the `core` track | resolved the root (exchange) track |
| `milestone-done` | — | would have archived the wrong milestone |

`hygiene` is the sharpest case: it exists to prune stale trace sessions, 13 were prunable, and it returned `summary.total: 0`.

### D2 — The milestone resolver spliced two different milestones

`getMilestoneInfo` derived version and name with two **independent** unanchored regexes over the whole of `roadmap.md`:

```js
const versionMatch = roadmap.match(/v(\d+\.\d+)/);                  // first vN.N ANYWHERE, prose included
const nameMatch    = roadmap.match(/## .*v\d+\.\d+[:\s]+([^\n(]+)/); // matches inside `### ` too
```

Three faults compounded: the version pattern was unanchored and read versions out of body prose; the name pattern was matched independently, so the two halves could come from different milestones; and `## ` matches inside `### `.

Reported observation — `init milestone-op` returned `milestone_version: "v4.2"` with `milestone_name: "— Full Platform"`. `v4.2` was *Ledger Rebrand*; *Full Platform* was `v4.1`. **The pair did not exist.** The version came from body prose at `roadmap.md:19`; the name from an H3 at `roadmap.md:75`.

**Confirmed worse than reported.** The defect fires on PAN's **own** documented roadmap format (`templates/roadmap.md`, "Milestone-Grouped Roadmap"), not only on the reporter's `###`-style layout:

```
## Milestones
- ✅ **v1.0 MVP** - Phases 1-4 (shipped)
- 🚧 **v1.1 Hardening** - Phases 5-6 (in progress)
### 🚧 v1.1 Hardening (In Progress)
```

→ old resolver returned `v1.0` (a **shipped** milestone, read from the summary bullet list) spliced with `Hardening` (the name of v1.1).

**Red herring, recorded so it is not chased again.** The reporter's roadmap separately had *two* milestones marked `(current)`. That was a genuine planning-state error, but it was not the cause: the old resolver never read `(current)` at all.

**Correction to the report's suggested fix.** It proposed falling back to `state.md`'s `milestone:` field, "which was correct here throughout". That is circular in PAN's model — `state.cjs` *writes* that field from `getMilestoneInfo()` (`buildStateFrontmatter`). It cannot be an independent source of truth. The fix therefore had to come entirely from within roadmap parsing.

## Requirements

| ID | Requirement |
|---|---|
| REQ-01 | A command can target a planning tree other than `.planning/`, by flag and by environment variable |
| REQ-02 | Every command that resolves a planning root reports which root it resolved, from where, and whether it exists |
| REQ-03 | `hygiene` can sweep the root tree and every discovered track in one invocation, attributing each finding to its track |
| REQ-04 | Project-level checks (version alignment) are reported once per invocation, not once per tree |
| REQ-05 | A planning root may not escape the project root |
| REQ-06 | Milestone version and name are always read from a single heading |
| REQ-07 | Milestone headings are matched anchored, at any heading level, and never inside body prose |
| REQ-08 | An explicit current-milestone marker outranks document position |
| REQ-09 | Multiple milestones marked current is surfaced as ambiguous rather than resolved silently |
| REQ-10 | Default behaviour is unchanged when no targeting flag is passed |
| REQ-11 | `milestone-audit` can target one tree and enumerate every tree, and refuses to audit an unresolvable milestone |

## Design

### Planning root resolution

`pan-wizard-core/bin/lib/planning-root.cjs` — a leaf module (requires only `fs`, `path`). See [ADR-0043](../decisions/ADR-0043-addressable-planning-roots.md) for the decision record.

Resolution precedence: `--planning-dir` / `--track` → `PAN_PLANNING_DIR` → `PAN_TRACK` → `.planning`.

Roots are stored project-relative and POSIX-separated, because the same value serves both as an absolute-path component and, verbatim, as the display path in output and `git add` arguments.

Key exports:

| Function | Purpose |
|---|---|
| `resolvePlanningRoot()` | `{rel, source, track}` — never a bare string |
| `describePlanningRoot(cwd)` | adds `planning_root_exists`; the shape commands spread into output |
| `planningRoots(cwd, {allTracks})` | the trees a command should act on |
| `discoverTracks(cwd)` | `.planning/tracks/*/` directories carrying a planning spine |
| `withPlanningRoot(rel, fn, track)` | pins the root (and its track label) for a synchronous callback, restores in `finally` |

Path construction is confined to `utils.planningPath(cwd, …segments)` (absolute) and `utils.planningRel(…segments)` (project-relative display). ~90 direct `path.join(cwd, PLANNING_DIR, …)` sites were routed through them.

### Milestone resolution

`parseMilestoneHeadings(roadmap)` extracts `{version, name, status, line, heading}` from each **anchored** heading (`/^[ \t]{0,3}#{1,6}[ \t]+(.*\bv\d+(?:\.\d+)+\b.*?)[ \t]*$/`) plus `<summary>` lines, which is how PAN's template collapses shipped milestones. Version and name come from the same captured heading — that constraint *is* the fix.

Status is read from the markers PAN's own template emits — `✅`/shipped, `🚧`/current/in-progress, `📋`/planned. `current` is matched as a word anywhere in the heading rather than as an exact `(current)` parenthetical: real roadmaps write `(current, phases 6–10)`, and requiring the strict form missed the marker and fell through to positional guessing.

`selectCurrentMilestone()` prefers, in order: a heading marked current → the first unshipped heading → the last shipped heading. Multiple current markers return `ambiguous: true` alongside the pick.

`getMilestoneInfo()` returns the previous `{version, name}` plus `{status, basis, ambiguous, candidates}` — additive, so existing callers are unaffected.

## CLI surface

```
pan-tools <command> [args] [--raw] [--cwd <path>]
                    [--track <name> | --planning-dir <path>] [--all-tracks]
```

| Flag | Effect |
|---|---|
| `--track <name>` | act on `.planning/tracks/<name>/` |
| `--planning-dir <path>` | act on an arbitrary project-relative planning tree |
| `--all-tracks` | (`hygiene`, `init milestone-op`) act on the root tree **and** every discovered track |
| `PAN_TRACK`, `PAN_PLANNING_DIR` | same, via environment; flags win |

`--track` and `--planning-dir` are mutually exclusive.

## Security

`--planning-dir` rejects absolute paths (`/`, `\`), Windows drive-relative paths (`C:foo`), and any `..` segment. `--track` is restricted to `^[A-Za-z0-9][A-Za-z0-9._-]*$`, so a track name can only ever be one path segment. Both barriers are inline literal checks rather than helper calls — static analysis does not follow guards across function boundaries.

## Verification

| Requirement | Evidence |
|---|---|
| REQ-01, REQ-05 | `tests/planning-root.test.cjs` — precedence, traversal rejection, slug alphabet |
| REQ-02 | `tests/planning-root.test.cjs` (`describePlanningRoot`), `tests/hygiene.test.cjs` (a mistyped `--track` reports `planning_root_exists: false` beside its zero findings) |
| REQ-03, REQ-04 | `tests/hygiene.test.cjs` — multi-track sweep, per-track attribution, version drift counted once |
| REQ-06…REQ-09 | `tests/milestone-resolver.test.cjs` — prose-version rejection, same-heading pairing, PAN's own template, ambiguity |
| REQ-10 | the full pre-existing suite passed after the ~90-site reroute and before any new test was added |
| REQ-11 | `tests/milestone-resolver.test.cjs` — `--track` resolves a sibling tree's milestone, `--all-tracks` labels each tree, an ambiguous track is listed in `ambiguous_tracks[]` |

Field reproduction: a fixture mirroring the reported repo (root tree + `core`/`defense`/`verify` tracks, 18 aged trace sessions in `verify`, plus a decoy non-track folder) yields **13 findings** under `--track verify` — matching the reported count exactly — and `clean --all-tracks --apply` prunes `verify` to the newest 5 while leaving the root tree and `core` untouched.

### Milestone audit

`init milestone-op` gained `--all-tracks`, returning `{all_tracks, track_count, ambiguous_tracks[], tracks[]}` — one full payload per tree. The payload also carries **how** the milestone was decided (`milestone_status`, `milestone_basis`, `milestone_ambiguous`, `milestone_candidates`), so a caller can distinguish a real `v1.0` from a fallback.

`workflows/milestone-audit.md` no longer hardcodes `.planning/`: it reads `planning_root` from the init payload and uses it for every glob and for the report path. Two gates were added — the audit must state the tree it read, and it must **stop** when `milestone_ambiguous` is true rather than auditing a silently-chosen milestone.

## Follow-on work

`--track` / `--planning-dir` work for every command because they resolve at the seam. `--all-tracks` **aggregation** is implemented for `hygiene` and `init milestone-op`; extending it to the phase/state commands is separate work.
