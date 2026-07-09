# ADR-0039: Worktrees are project variants — resolution + state-namespace rule for agent tooling

## Status

Accepted (design rule; no immediate implementation) — 2026-07-09. Recorded from the 2026-07 field harvest (`docs/FIELD-HARVEST-2026-07.md`, follow-up 4). Applies the rule to any future PAN feature that keys state or identity off a project path.

## Context

PAN's army mode (ADR-0032/0033) gives each parallel builder its own git worktree (`worktree.cjs`, `army/<task>` branches). Today PAN keeps no per-worktree state beyond the branch itself, so nothing breaks. But any future feature that resolves "which project am I in?" from a filesystem path — per-project review state, comment threads, HUD scoping, memory namespacing — will hit the failure mode documented in an external design spec found during the harvest (the worktree-awareness plan of an MCP code-review tool in a third-party agent-tooling monorepo): an agent running inside `<repo>/.claude/worktrees/foo/` either gets matched to the parent repo (wrong context — state from the main checkout bleeds into the worktree's review) or fails to match at all.

The spec's resolution, validated against exactly the branch-per-agent shape PAN's army uses:

1. **A worktree is a *variant* of its project** — not a separate project, not silently the parent.
2. **Two-phase resolution:** resolve the project by longest-prefix match on the main checkout path, then resolve the variant from the worktree suffix (their encoding: an `@<worktree>` suffix on the project key).
3. **Per-variant state namespace:** mutable state (comments, review verdicts, progress) is keyed `project@worktree`, defaulting to the main checkout when no variant is given, so existing callers stay valid.
4. **Backward compatibility:** an optional `worktree` parameter defaulting to main; legacy unsuffixed references resolve to the main variant.

## Decision

Adopt "worktree = project variant" as the design rule for any PAN feature that keys identity or state off a project path:

- **Resolution:** project first (main checkout), variant second (worktree). Never treat a worktree as an independent project; never silently collapse it into the parent's mutable state.
- **State namespace:** any per-project mutable store that can be touched from inside a worktree must be keyed by `(project, variant)`, with `variant = main` as the default and the back-compat reading of unsuffixed keys.
- **Read vs write:** immutable project facts (roadmap, requirements, learnings) may be read from the parent; mutable work-in-progress state (review findings, executor progress, bus messages scoped to a task) belongs to the variant.

No current module changes: `worktree.cjs` stays a lifecycle tool; `.planning/` state is not yet variant-keyed because army workers commit to branches rather than writing shared `.planning` state from inside worktrees. The rule becomes binding the first time a feature violates that assumption (e.g., per-worktree review comments, worktree-scoped HUD panels, or bus channels written from inside a worktree).

## Consequences

- Future specs touching path-keyed state must name their variant-resolution behavior; reviewers can cite this ADR.
- The army's existing safety property (parallel builders never share mutable state) is now stated as a design invariant rather than an accident of the current feature set.
- Cost of adoption later is one keying change (`project` → `project@variant`) plus a default; cost of ignoring it is cross-worktree state bleed — the exact bug class the external spec was written to fix.

## References

- `docs/FIELD-HARVEST-2026-07.md` (follow-up 4); external evidence: the worktree-awareness design plan of an MCP code-review tool in a third-party agent-tooling monorepo.
- Related: ADR-0032 (squads), ADR-0033 (branch-per-agent worktrees), `pan-wizard-core/bin/lib/worktree.cjs`.
