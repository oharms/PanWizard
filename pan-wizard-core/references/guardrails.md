# AI Agent Guardrails for PAN Wizard

This document is read by AI agents (Claude, Codex, Gemini, OpenCode, Copilot)
executing PAN workflows. It encodes rules that prevent the most common shortcut
failures observed across PAN Wizard development. Re-read at the start of every
phase — context compaction may have dropped earlier sections.

## Common Shortcuts to Resist

| Shortcut | Why it fails | Correct action |
|----------|--------------|----------------|
| "User's request is clear, no need to clarify" | You're guessing at intent. Phase 0 catches misunderstandings before scaffolding. | Run the Phase 0 4-question check (see `new-project.md` / `plan-phase.md`). |
| "Phase tests passed locally, /pan:verify-phase isn't needed" | One run isn't validation. verify-phase checks state consistency, doc sync, blockers, and the full suite — not just the phase's own tests. | Always run `/pan:verify-phase` before marking a phase complete. |
| "I'll skip /pan:focus-scan and pick the next item myself" | Manual selection ignores priority/budget logic in `focus.cjs`. You'll bias toward easy items and miss higher-priority work. | Use `/pan:focus-scan` → `/pan:focus-plan` → `/pan:focus-exec`. |
| "I'll bump the model / add a flag / refactor while I'm here" | Scope creep. The user asked for one change; surrounding cleanup belongs in a separate item. | Do only the requested change. Note unrelated cleanup as a TODO for a future focus-scan. |
| "I'll mark this phase complete; the docs can lag behind" | Doc/state drift compounds. By the next session, the agent reads stale docs and proceeds on false assumptions. | Run `/pan:sync` (or the equivalent doc-sync step) before phase completion. CHANGELOG and version bumps are part of the phase, not after it. |

## Code Preservation Principle

Code modifications require surgical precision — alter only the lines directly
targeted by the user's request. Strictly preserve all surrounding code.

Before finalizing any edit, verify:

1. **Target identification** — the exact lines to change, based solely on the user's instructions
2. **Preservation check** — all code, config values (model, version, api_key), comments, and formatting outside the target are identical

If you must touch surrounding code (e.g., to fix an import a rename broke),
name it explicitly in your reply: "Also updating import in X because the
rename broke it." Never silently expand scope.

## Stop-the-Line Rule

If a change breaks something that was working: **stop feature work and fix
the regression first.** Do not push forward with "I'll circle back" —
regressions compound across sessions and become 10x harder to localize later.

A failing test, a broken command, or a manifest-checksum mismatch is a
stop-the-line event. Resume feature work only after the line is restored.

## Systematic Debugging Sequence

When something breaks, follow this sequence — don't shotgun fixes:

1. **Reproduce** — exact failing command, full error output
2. **Localize** — narrow to module, config, or environment
3. **Fix one variable at a time** — changing instruction + tool + config simultaneously means you won't know what fixed it
4. **Verify** — rerun the exact reproduction command
5. **Guard** — if the bug was non-obvious, add a test to catch regressions

## Cross-References

- `references/tdd.md` — test-driven development patterns
- `references/verification-patterns.md` — phase verification methodology
- `references/checkpoints.md` — human-in-the-loop checkpoint protocol
- `workflows/exec-phase.md` — phase execution checklist
- `workflows/verify-phase.md` — phase completion validation
- `workflows/plan-phase.md` — phase planning and decomposition
