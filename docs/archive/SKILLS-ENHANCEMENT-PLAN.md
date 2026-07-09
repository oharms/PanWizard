# Skills Enhancement Plan

Systematic review of all 42 shipped PAN Wizard skills against 20 modern prompting
techniques researched from 2025-2026 best practices. Each enhancement is one
self-contained change, applied and verified individually.

**Sources:** Anthropic Prompting Best Practices, Claude Code Best Practices,
Paxrel (10 Agent Patterns), Agentic AI Design Patterns 2026, BrightCoding
System Prompts Guide, PromptLayer Flow Engineering, Deepset Context Engineering.

---

## Current State Assessment

**What PAN already does well:**
- Phase-gated execution (Plan-Act-Verify) in exec-phase, focus-auto
- State handover protocol in pause/resume (state.md)
- Structured JSON output enforcement in focus-scan, focus-plan
- Guard rails (PAN_SOURCE_ROOT, NEVER DO sections in focus-auto)
- Parallel tool directives in exec-phase (wave-based)
- Supervisor/orchestrator pattern in plan-phase, map-codebase

**What's missing or weak across multiple skills:**

| # | Enhancement | Technique | Skills Affected | Priority |
|---|-------------|-----------|----------------|----------|
| 1 | Add Chain of Verification checklists | Self-Check Before Commit | exec-phase, quick, focus-exec | HIGH |
| 2 | Add Error Recovery Classification | Recoverable vs Unrecoverable | exec-phase, focus-auto, focus-exec, debug | HIGH |
| 3 | Add Motivation to Constraints | Explain the "Why" | focus-auto (NEVER DO), focus-exec (9 rules) | HIGH |
| 4 | Add Investigate-Before-Answering directive | Anti-hallucination | verify-phase, assumptions, audit-deployment | HIGH |
| 5 | Add Tool Selection Heuristics | Priority-ordered routing | focus-scan, focus-design, map-codebase | MEDIUM |
| 6 | Soften aggressive directive language | Claude 4.6 calibration | focus-auto, focus-exec, focus-scan | MEDIUM |
| 7 | Add Dry-Run verification step | Simulate Before Execute | exec-phase, quick, focus-exec | MEDIUM |
| 8 | Add Context Window Management rules | Retention policies | focus-auto, focus-design, exec-phase | MEDIUM |
| 9 | Add Reflexion Loop to verification | Generate-Critique-Revise | verify-phase, plan-phase (plan-checker) | MEDIUM |
| 10 | Standardize XML structural tags | XML-First Architecture | Inconsistent across skills — some use XML, some don't | LOW |
| 11 | Add Anti-Overengineering directive | Scope containment | exec-phase, quick, focus-exec | LOW |
| 12 | Add Thinking Tags guidance | Mandatory reasoning | debug, focus-design, assumptions | LOW |

---

## Enhancement Details

### Enhancement 1: Chain of Verification Checklists
**Technique:** Self-Check Before Commit
**Target skills:** exec-phase, quick, focus-exec
**What to add:** A numbered verification checklist that the agent MUST run through
before committing any code change. Currently these skills say "test after changes"
but don't have a structured self-check protocol.
**Checklist template:**
```
Before committing, verify ALL:
1. All modified files were read before editing
2. Tests pass (run test suite, record count)
3. No unintended files in git diff
4. Commit message accurately describes only verified changes
5. No TODO/FIXME introduced without tracking
If any check fails: fix and re-verify. Do not commit until all pass.
```

### Enhancement 2: Error Recovery Classification
**Technique:** Recoverable vs Unrecoverable errors
**Target skills:** exec-phase, focus-auto, focus-exec, debug
**What to add:** Explicit classification of error types with recovery protocols.
Currently focus-auto has "revert fast" (5 min limit) but doesn't distinguish
error types. exec-phase delegates to workflows but has no error taxonomy.
**Classification template:**
```
RECOVERABLE (retry with analysis, max 3 attempts):
- Test failure after code change → read error, fix, re-test
- File not found → search for moved/renamed file
- Merge conflict → attempt auto-resolution, then checkpoint

UNRECOVERABLE (halt, report to user):
- Persistent test regression after revert
- Permission/auth errors on critical paths
- State corruption (malformed JSON in planning files)
- Build system failure unrelated to current changes
```

### Enhancement 3: Motivation-Enriched Constraints
**Technique:** Explain the "Why" behind rules
**Target skills:** focus-auto (NEVER DO section), focus-exec (9 Behavioral Rules)
**What to add:** A "Why" annotation to each constraint. Currently the NEVER DO
list in focus-auto has 11 bare rules with no reasoning. Adding motivation helps
the model generalize to edge cases.
**Example transformation:**
```
Before: "- Skip the baseline test capture (Phase 1)"
After:  "- Skip the baseline test capture (Phase 1) — without a baseline, the
          regression circuit breaker cannot detect test count decreases"
```

### Enhancement 4: Investigate-Before-Answering Directive
**Technique:** Anti-hallucination through evidence requirement
**Target skills:** verify-phase, assumptions, audit-deployment
**What to add:** Explicit directive to read referenced files before making claims.
verify-phase currently says "validate built features" but doesn't mandate reading
the actual implementation before judging. assumptions should read the codebase
before surfacing assumptions.
**Directive:**
```
NEVER claim a feature works or doesn't work without reading the implementation.
Before each verification judgment:
1. Read the source file(s) that implement the feature
2. Read the test file(s) that cover it
3. Run the tests
4. Only THEN state your assessment with file:line evidence
```

### Enhancement 5: Tool Selection Heuristics
**Technique:** Priority-ordered tool routing
**Target skills:** focus-scan, focus-design, map-codebase
**What to add:** Explicit tool priority ordering. focus-scan currently says
"Grep for patterns" but doesn't prioritize which tools to try first. focus-design
has 10 phases with many tool options but no routing guidance.
**Heuristic:**
```
Tool priority (use the simplest sufficient tool):
1. Grep/Glob — for finding specific patterns or files
2. Read — for examining known files
3. Bash — only for commands that dedicated tools can't do
4. Agent (subagent) — only for exploration spanning >5 file reads
5. WebSearch/WebFetch — only when local sources are exhausted
```

### Enhancement 6: Soften Aggressive Directive Language
**Technique:** Claude 4.6 calibration
**Target skills:** focus-auto, focus-exec, focus-scan
**What to change:** Replace over-emphasized "CRITICAL", "MUST", "ABSOLUTELY"
language with normal direct instructions. Claude 4.6 overtriggers on aggressive
directives — they can cause overreaction or over-caution.
**Example transformations:**
- "You MUST ask the user" → "Ask the user"
- "Do NOT proceed past this point" → "Wait for the user's reply before proceeding"
- "ALWAYS EXCLUDE these directories" → "Exclude these directories from scanning"
Note: Keep NEVER DO / ALWAYS DO sections — those are structural, not tonal.

### Enhancement 7: Dry-Run Verification Step
**Technique:** Simulate Before Execute
**Target skills:** exec-phase, quick, focus-exec
**What to add:** For STANDARD and FULL tier items, state the intended changes
before implementing them. Currently exec-phase goes straight to execution.
**Template:**
```
For M+ items, before implementing:
1. State: "I will modify [files], adding [what], to achieve [goal]"
2. Identify risks: "This could break [X] if [Y]"
3. Then implement
```

### Enhancement 8: Context Window Management Rules
**Technique:** Retention policies for long sessions
**Target skills:** focus-auto, focus-design, exec-phase
**What to add:** Explicit guidance on what to keep vs. summarize vs. discard
as context accumulates. focus-auto can run 10+ cycles; focus-design has 10
phases. Both risk context rot without management rules.
**Template:**
```
Context management across cycles/phases:
KEEP: Current task goals, test baselines, error states, file paths being modified
SUMMARIZE: Previous cycle results (1-line per cycle), completed sub-tasks
DISCARD: Raw tool output from previous cycles, superseded scan results
```

### Enhancement 9: Reflexion Loop in Verification
**Technique:** Generate-Critique-Revise
**Target skills:** verify-phase, plan-phase (plan-checker interaction)
**What to add:** After initial verification judgment, explicitly re-evaluate
against the phase goals. Currently verify-phase checks features against UAT
but doesn't self-critique its assessment.
**Template:**
```
After initial assessment:
1. Score each requirement: PASS / PARTIAL / FAIL
2. For PARTIAL/FAIL: state what specifically is missing
3. Re-read the requirement and the code — did you miss anything?
4. Revise scores if needed
5. Only report final scores after this review cycle
```

### Enhancement 10: Standardize XML Structural Tags — SKIPPED
**Technique:** XML-First Architecture
**Target skills:** Many — inconsistent usage across skills
**Decision:** Keep the current split. Short workflow-delegating skills (30-80 lines)
use XML tags (`<objective>`, `<process>`, `<context>`). Long focus skills (200-1000+
lines) use markdown headings for navigability. This is a sensible natural split —
forcing XML on 1000-line files adds noise, forcing markdown on 40-line files loses
structure. No change needed.

### Enhancement 11: Anti-Overengineering Directive
**Technique:** Scope containment
**Target skills:** exec-phase, quick, focus-exec
**What to add:** Explicit instruction not to expand scope beyond the task.
focus-auto already has "Follow the Plan — no scope creep" but exec-phase and
quick lack this. Claude 4.6 tends to over-engineer.
**Directive:**
```
Implement exactly what was planned. Do not:
- Add features not in the plan
- Refactor surrounding code
- Add comments to unchanged code
- Create abstractions for one-time operations
- Add error handling for impossible scenarios
```

### Enhancement 12: Thinking Tags Guidance
**Technique:** Mandatory reasoning before complex actions
**Target skills:** debug, focus-design, assumptions
**What to add:** Encourage explicit reasoning before tool use in investigative
skills. debug already uses scientific method but could benefit from structured
observe-think-act loops.

---

## Execution Order

Apply enhancements in priority order, one at a time:
1. Chain of Verification (exec-phase, quick, focus-exec)
2. Error Recovery Classification (exec-phase, focus-auto, focus-exec)
3. Motivation-Enriched Constraints (focus-auto, focus-exec)
4. Investigate-Before-Answering (verify-phase, assumptions, audit-deployment)
5. Tool Selection Heuristics (focus-scan, focus-design, map-codebase)
6. Soften Aggressive Language (focus-auto, focus-exec, focus-scan)
7. Dry-Run Verification (exec-phase, quick, focus-exec)
8. Context Window Management (focus-auto, focus-design, exec-phase)
9. Reflexion Loop (verify-phase, plan-phase)
10. XML Standardization (all skills — needs design decision)
11. Anti-Overengineering (exec-phase, quick, focus-exec)
12. Thinking Tags (debug, focus-design, assumptions)
