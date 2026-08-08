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
| "I'll mark this phase complete; the docs can lag behind" | Doc/state drift compounds. By the next session, the agent reads stale docs and proceeds on false assumptions. | Run the doc-sync step (update CHANGELOG/state and commit via `pan-tools commit`) before phase completion. CHANGELOG and version bumps are part of the phase, not after it. |
| "The tests pass, so the code is portable" | Tests run on one Node version on one OS. Modern Node auto-detects ESM syntax, so `import`/`export` in a project with no `package.json` passes locally and fails under `"type": "commonjs"` or older Node. | Declare the module type explicitly whenever you emit `import`/`export` or `require` — `"type"` in `package.json`, or `.mjs`/`.cjs` extensions. Never rely on syntax detection. |
| "It rejects bad input — I wrapped the parser in try/catch" | That only rejects *unparseable* input. Valid JSON of the wrong shape passes through and surfaces as `undefined` in an unrelated caller. | Validate shape after parsing, not just parseability. Assert the expected type/keys and fall back or throw. See `references/verification-patterns.md` → Baseline Checks. |
| "I'll write the doc now and refine it as I go" | Skeleton-then-refine never converges: field transcripts show planning files rewritten 12-19× and re-read 6-16× in a single step, and every in-flight version of state.md is one a later step can read (P-1808). | Compose the complete document in memory, then issue exactly ONE Write per file per step. Don't re-read a file you wrote this step. Post-write corrections are targeted Edits for a verified defect, never a rewrite. |

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
