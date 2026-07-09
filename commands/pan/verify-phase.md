---
name: pan:verify-phase
group: Phase Lifecycle
description: Validate built features through conversational UAT with test suite gate
argument-hint: "[phase number, e.g., '4']"
allowed-tools:
  - Read
  - Bash
  - Glob
  - Grep
  - Edit
  - Write
  - Task
---
<objective>
Validate built features through conversational testing with persistent state.

Purpose: Confirm what Claude built actually works from user's perspective. One test at a time, plain text responses, no interrogation. When issues are found, automatically diagnose, plan fixes, and prepare for execution.

Output: {phase_num}-uat.md tracking all test results. If issues found: diagnosed gaps, verified fix plans ready for /pan:exec-phase
</objective>

<execution_context>
@~/.claude/pan-wizard-core/workflows/verify-phase.md
@~/.claude/pan-wizard-core/templates/uat.md
</execution_context>

<context>
Phase: $ARGUMENTS (optional)
- If provided: Test specific phase (e.g., "4")
- If not provided: Check for active sessions or prompt for phase

Context files are resolved inside the workflow (`init verify-work`) and delegated via `<files_to_read>` blocks.
</context>

<investigate_before_judging>
Never claim a feature works or doesn't work without reading the implementation first.
Before each verification judgment:
1. Read the source file(s) that implement the feature
2. Read the test file(s) that cover it
3. Run the tests
4. Only then state your assessment with file:line evidence
Do not speculate about code you have not opened.
</investigate_before_judging>

<citation_requirement>
Every verdict (PASS, PARTIAL, FAIL) MUST include at least one file:line citation as evidence.

**Before writing any judgment, scan your draft for unsourced claims.** If you find an assertion without evidence, stop and gather it before continuing.

Format: `verdict: PASS — feature works as specified (src/billing.ts:42, tests/billing.test.ts:18-35)`

**Grounding rules:**
- PASS requires: file:line where the feature is implemented + test file:line where it's verified
- PARTIAL requires: file:line showing what works + description of what's missing with expected location
- FAIL requires: file:line showing the defect OR absence (grep result showing the expected function/export doesn't exist)
- "I checked and it's not there" is NOT evidence — show the grep command and its empty result

**Anti-pattern:**
```
BAD:  "FAIL — the retry logic doesn't handle timeouts"
      → No evidence. Maybe it does handle timeouts and you didn't read far enough.
GOOD: "FAIL — retry logic at api/client.ts:67-89 catches ConnectionError but not TimeoutError.
       Grep for 'TimeoutError' in api/: 0 matches. tests/client.test.ts has no timeout test cases."
```
</citation_requirement>

<reflexion_loop>
After initial verification of each requirement:
1. Score each requirement: PASS / PARTIAL / FAIL
2. For PARTIAL or FAIL: state specifically what is missing or broken
3. Re-read the requirement text and the implementation — did you miss anything?
4. Revise the score if the re-read reveals evidence you overlooked
5. Report only final scores after this review cycle
This prevents premature FAIL verdicts from incomplete investigation.
</reflexion_loop>

<cache_priming>
**Before the verifier agent runs**, prime the prompt cache once. The verifier reads project.md / requirements.md / roadmap.md every run; caching avoids ~15-50K input tokens per invocation.

Run once:
```
pan-tools cache prime --summary
```

See [plan-phase.md](plan-phase.md) or [exec-phase.md](exec-phase.md) for the full explanation. No-op on non-Claude runtimes.
</cache_priming>

<process>
Execute the verify-work workflow from @~/.claude/pan-wizard-core/workflows/verify-phase.md end-to-end.
Preserve all workflow gates (session management, test presentation, diagnosis, fix planning, routing).
</process>
