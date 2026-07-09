# ADR-0022: Lifecycle Completeness — Test Generation, Code Review, Test Gate, Retrospective

## Status
Proposed

## Context
PAN Wizard's lifecycle has structural gaps when compared against industry SDLC frameworks (V-Model, Agile, DevOps, SAFe). Specifically:

1. **Test generation is orphaned:** `/pan:phase-tests` exists but no orchestrator calls it. Users must manually discover and invoke it.
2. **No code review stage:** Between execution (pan-executor) and verification (pan-verifier), nobody checks code quality, convention compliance, or security patterns.
3. **Verifier doesn't run tests:** `pan-verifier` checks goals against success criteria and artifacts, but never executes the project's test suite.
4. **No retrospective:** `/pan:milestone-audit` checks WHAT was built against requirements, but there's no process-focused analysis of HOW work was done (estimation accuracy, common gap patterns).

These gaps were discovered during a systematic comparison of PAN's lifecycle against 8 industry frameworks (Waterfall, V-Model, Agile/Scrum, SAFe, DevOps/CI-CD, Shift-Left, SRE, TOGAF ADM).

## Decision
Close the V-Model right-side gap by:

1. **Wire `/pan:phase-tests` into `exec-phase.md`** — auto-invoke after execution completes (step 6.5)
2. **Create `pan-reviewer` agent** — read-only code review with quality/convention/security checks
3. **Add review step to `exec-phase.md`** — spawn pan-reviewer after test generation (step 6.7)
4. **Add test suite gate to `verify-phase.md`** — verifier runs `npm test` and compares before/after counts
5. **Create `/pan:retro` command** — milestone-level retrospective analyzing estimation accuracy and gap patterns

The new lifecycle becomes:
```
plan → exec → tests (auto) → review (auto) → verify (with test gate) → next phase
                                                                          ↓
milestone-done → retro → next milestone
```

## Consequences

### Positive
- PAN becomes the only AI coding tool with complete V-Model coverage
- Test generation is no longer orphaned — automatically invoked
- Code quality issues caught before verification, not after
- Test regressions caught by verifier (not just goal achievement)
- Process learning through retrospectives improves estimation over time

### Negative
- exec-phase takes longer (~1-2 min for test gen + review)
- pan-reviewer may produce false positive warnings (tuning needed)
- Additional agent increases installer size slightly

### Neutral
- --skip-tests and --skip-review flags provide opt-out for rapid iteration
- Retro is a separate command, not auto-invoked (user chooses when to reflect)
- No changes to existing command JSON schemas — purely additive

## Options Considered

1. **Do nothing** — Leave gaps as-is. Rejected: user discovered the gap, evidence is clear.
2. **Just wire phase-tests** — Minimal fix. Rejected: misses review + test gate opportunities.
3. **Full lifecycle with mandatory gates** — All stages required. Rejected: too rigid for exploratory work.
4. **Full lifecycle with skip flags (CHOSEN)** — All stages available, skippable via flags.

## Links
- Spec: `docs/specs/lifecycle_completeness_featureai.md`
- Gap analysis: `link_system_temp.md`
- Related: exec-phase.md, verify-phase.md, phase-tests.md workflows
- Related: pan-verifier, pan-executor agents
- Related: ADR-0019 (E2E UAT testing)
