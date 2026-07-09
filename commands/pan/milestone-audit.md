---
name: pan:milestone-audit
group: Milestone
description: Audit milestone completion against original intent before archiving
argument-hint: "[version]"
allowed-tools:
  - Read
  - Glob
  - Grep
  - Bash
  - Task
  - Write
---
<objective>
Verify milestone achieved its definition of done. Check requirements coverage, cross-phase integration, and end-to-end flows.

**This command IS the orchestrator.** Reads existing verification.md files (phases already verified during execute-phase), aggregates tech debt and deferred gaps, then spawns integration checker for cross-phase wiring.
</objective>

<execution_context>
@~/.claude/pan-wizard-core/workflows/milestone-audit.md
</execution_context>

<context>
Version: $ARGUMENTS (optional — defaults to current milestone)

Core planning files are resolved in-workflow (`init milestone-op`) and loaded only as needed.

**Completed Work:**
Glob: .planning/phases/*/*-summary.md
Glob: .planning/phases/*/*-verification.md
</context>

<citation_requirement>
Every coverage judgment in the audit MUST cite evidence from the codebase.

**Before writing any requirement as "covered" or "not covered", verify by reading the code.**

**Grounding rules:**
- "Covered" requires: file:line where the requirement is implemented + verification.md or test evidence
- "Partially covered" requires: file:line showing what exists + specific gap description with expected location
- "Not covered" requires: grep showing the expected functionality doesn't exist (show the search and empty result)
- Cross-phase integration claims require: file:line in phase A's output + file:line in phase B's consumer

**Anti-pattern:**
```
BAD:  "Requirement R3 is covered — the billing module handles this"
      → Which file? Which function? How do you know?
GOOD: "Requirement R3 is covered — generateInvoice() at src/billing.ts:42 implements line-item
       calculation. Verified in phase-2-verification.md (line 18). Integration: called from
       src/api/orders.ts:156 (phase 3)."
```

Do not trust summary files at face value. If a verification.md says "all tests pass" but you haven't confirmed the test count, that claim is ungrounded. Spot-check at least 2 verification files by running the actual tests.
</citation_requirement>

<process>
Execute the audit-milestone workflow from @~/.claude/pan-wizard-core/workflows/milestone-audit.md end-to-end.
Preserve all workflow gates (scope determination, verification reading, integration check, requirements coverage, routing).
</process>
