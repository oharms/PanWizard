# ADR-0043: Addressable planning roots — a command must be able to name the tree it acted on

## Status

Accepted — 2026-08-21. Implemented in `pan-wizard-core/bin/lib/planning-root.cjs`, with `utils.planningPath()` / `utils.planningRel()` as the only path constructors. `hygiene` and `init milestone-op` (which backs `/pan:milestone-audit`) are the multi-root consumers.

## Context

Every planning path in PAN was built as `path.join(cwd, PLANNING_DIR, …)`, where `PLANNING_DIR` was the hard-coded constant `'.planning'`. That made exactly one planning tree per project addressable, and it was the only tree any command could see.

The `--cwd` flag looked like an escape hatch but is not one: it moves the *project* root, and the planning tree is always `<project>/.planning`. A repo whose planning trees live at `.planning/tracks/{core,defense,verify}/` — several independently-planned products merged into one repository — had three of its four trees permanently unreachable.

The damage was not that the other trees were awkward to reach. It was that **the commands did not fail.** They succeeded against the wrong tree:

- `hygiene scan` reported `summary.total: 0` — "clean" — while `tracks/verify/optimization/traces` held 18 trace sessions against a retention of 5. Thirteen were prunable. The command exists to prune them and reported nothing to do.
- `milestone-audit` resolved a different track than the one requested.
- `milestone-done` would have archived the wrong milestone.

A tool that errors is safe: the reader retries. A tool that reports "clean" teaches the reader to trust a result it never computed. That is the failure mode this ADR addresses, and it generalises past `hygiene` — any command that silently resolves an implicit target has it.

## Decision

**1. One resolver owns the question "which tree?".** `planning-root.cjs` is a leaf module (it requires only `fs` and `path`) that resolves a project-relative, POSIX-separated planning root, with precedence:

| Rank | Source | Form |
|---|---|---|
| 1 | `--planning-dir <path>` / `--track <name>` | explicit flag |
| 2 | `PAN_PLANNING_DIR` | project-relative path |
| 3 | `PAN_TRACK` | track name |
| 4 | default | `.planning` |

**2. Every resolution carries its provenance.** The resolver returns `{rel, source, track}`, never a bare string, and `describePlanningRoot()` adds `planning_root_exists`. Commands surface all four fields. This is the half of the fix that matters most: it is what makes a wrong target *visible* rather than indistinguishable from a right one. A mistyped `--track ghost` now reports `planning_root_exists: false` next to its zero findings, instead of passing for a healthy project.

**3. Two path constructors, no direct joins.** `utils.planningPath(cwd, …segments)` builds absolute paths; `utils.planningRel(…segments)` builds the project-relative display form used in output, findings, and `git add` arguments. They read the same root, so what a command *reports* is always the tree it *touched*. Roughly ninety direct `path.join(cwd, PLANNING_DIR, …)` sites were routed through them, and `PLANNING_DIR` is no longer imported for path building anywhere.

**4. Tracks are discovered, not declared.** `discoverTracks()` walks `.planning/tracks/*/` and returns only directories carrying a planning spine (`state.md`, `roadmap.md`, `phases/`, `focus/`, …). An empty or incidental folder under `tracks/` is not a track — inventing one would reintroduce exactly the "acted on the wrong thing" failure being removed. No registry file, so a track cannot drift out of sync with the filesystem.

**5. Sweeping several trees is scoped, not threaded.** `withPlanningRoot(rel, fn)` pins the root for a synchronous callback and restores it in a `finally`. `hygiene --all-tracks` uses it per tree. Threading a root parameter through each check would have stopped at the module boundary — the checks call into `memory.cjs` and `cost.cjs`, which resolve the root themselves — so the ambient scope is what makes downstream readers follow the sweep instead of all reporting on `.planning/`.

**6. Project-level checks run once.** Version alignment is a property of the project (which runtimes are installed, at what version), not of any planning tree. Sweeping four trees must not report the same drift four times.

## Consequences

- **The reported defect is closed.** `--track verify` surfaces the 13 prunable sessions; `--all-tracks` sweeps the root tree and every track, attributing each finding to its track; `clean --apply` prunes the offending tree and leaves the others intact.
- **Clean verdicts now name their scope.** Every `hygiene` scan prints the tree it read, and a single-tree scan on a project with tracks says so and points at `--all-tracks`.
- **Traversal is bounded at the seam.** `--planning-dir` rejects absolute, drive-relative, and `..`-containing paths; `--track` is restricted to a slug alphabet. Both checks are inline literals rather than helper calls, because static analysis does not follow guards across function boundaries.
- **Behaviour is unchanged when nothing is passed.** The default root stays `.planning`; the full suite passed before the new tests were added, which is the evidence that the ~90-site reroute is faithful.
- **`withPlanningRoot` is synchronous-only.** Overlapping scopes would interleave and restore onto the wrong value. This is documented at the function and is the one sharp edge the design accepts in exchange for downstream readers following the sweep.
- **Two commands sweep today.** `--track` / `--planning-dir` work for every command because they resolve at the seam. `--all-tracks` aggregation is implemented for `hygiene` and `init milestone-op`; extending it to the phase/state commands is follow-on work, not a gap in the seam.
- **The audit gained a refusal.** `init milestone-op` now reports `milestone_basis` and `milestone_ambiguous`, and `/pan:milestone-audit` stops when the roadmap marks more than one milestone current. This is the same principle applied one level up: an audit that cannot resolve its subject must say so rather than produce a confident report about a silently-chosen one.

## Alternatives considered

- **A `--planning-dir` flag with no provenance reporting.** Cheaper, and it would have made the tracks reachable — but it fixes only the "unreachable" half. The costly half of the defect was that a wrong target looked like a right one, which no amount of reachability addresses.
- **Resolving `PLANNING_DIR` from the environment at module load.** Nearly zero churn: every existing call site would have become track-aware for free. Rejected because the value freezes at first `require`, so any in-process caller that sets the root afterwards (every test, and the `--all-tracks` sweep) silently gets the stale tree — the same class of silent-wrong-target bug, relocated.
- **A `tracks.json` registry.** Explicit, but a declared list drifts from the filesystem, and a track missing from the registry would be invisible in precisely the way this ADR exists to prevent.
