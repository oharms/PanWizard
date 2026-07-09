# Skills Enhancement Plan v2 — COMPLETED

Second-pass systematic review. Deeper techniques from Anthropic's agent engineering
guides, Manus context engineering, and 2025-2026 multi-agent orchestration research.

**Status:** ALL 12 ENHANCEMENTS APPLIED (2026-04-12)
**SKILLS-FULL-TEXT.md:** 8884 lines (up from ~8300 pre-v2)

**Sources:** Anthropic Building Effective Agents, Anthropic Context Engineering for
AI Agents, Anthropic Writing Effective Tools, Anthropic Multi-Agent Research System,
Manus Context Engineering, OpenAI GPT-5.4 Prompt Guidance, Chanl Multi-Agent Patterns.

---

## Enhancement Summary

| # | Enhancement | Technique | Skills Affected | Status |
|---|-------------|-----------|----------------|--------|
| 1 | Output Contract Specification | Explicit deliverables + completion criteria | exec-phase, focus-exec, focus-auto, plan-phase | APPLIED |
| 2 | Negative Examples / Anti-Patterns | Concrete violation examples | focus-exec, exec-phase, plan-phase | APPLIED |
| 3 | Dependency-Aware Phase Rules | "After X, MUST do Y" enforcement | exec-phase, focus-exec, focus-auto | APPLIED |
| 4 | Structured Handoff Protocol | YAML schema for pause/resume | pause, resume, debug | APPLIED |
| 5 | Todo-List Recitation | Attention anchoring in long workflows | focus-auto, exec-phase, focus-exec | APPLIED |
| 6 | Grounding / Citation Enforcement | File:line evidence for all claims | verify-phase, milestone-audit, assumptions | APPLIED |
| 7 | Explicit Routing Criteria | Decision tree for path selection | plan-phase, new-project, resume | APPLIED |
| 8 | Action Gating by Phase | Tool allowlists per execution stage | exec-phase, focus-exec | APPLIED |
| 9 | Progressive Disclosure | Layered context loading strategy | new-project, map-codebase, focus-design | APPLIED |
| 10 | Failure Pattern Capture | Log and learn from repeated failures | focus-auto, focus-exec | APPLIED |
| 11 | Diversity Injection | Vary approach for similar batch items | focus-exec, focus-auto | APPLIED |
| 12 | Meta-Prompting | Self-generated reasoning templates | focus-design, debug | APPLIED |

---

## Enhancement Details

### Enhancement 1: Output Contract Specification
**Technique:** Explicit deliverables + completion criteria
**Target skills:** exec-phase, focus-exec, focus-auto, plan-phase
**What to add:** A `<completion_contract>` block defining testable done-conditions
and required artifacts. Removes ambiguity about when to stop.

### Enhancement 2: Negative Examples / Anti-Patterns
**Technique:** Concrete violation examples alongside rules
**Target skills:** focus-exec, exec-phase, plan-phase
**What to add:** 1-2 concrete "BAD/GOOD" code examples for the most critical rules.
Models in 2025+ pay extreme attention to examples.

### Enhancement 3: Dependency-Aware Phase Rules
**Technique:** Hard dependency enforcement between phases
**Target skills:** exec-phase, focus-exec, focus-auto
**What to add:** Explicit dependency rules: "Stage 1 MUST complete before Stage 3.
If Stage 2 validation fails, STOP." Currently phases are described but not enforced.

### Enhancement 4: Structured Handoff Protocol
**Technique:** YAML schema for cross-context handoff
**Target skills:** pause, resume, debug
**What to add:** Formalize the pause/resume handoff with structured fields:
position, completed items, pending decisions, context snapshot, next action.

### Enhancement 5: Todo-List Recitation
**Technique:** Attention anchoring via running checklist
**Target skills:** focus-auto, exec-phase, focus-exec
**What to add:** Instruct agent to emit "Remaining Steps" after each major action.
Prevents lost-in-the-middle drift in 10+ step workflows.

### Enhancement 6: Grounding / Citation Enforcement
**Technique:** File:line evidence requirement for all claims
**Target skills:** verify-phase, milestone-audit, assumptions
**What to add:** Explicit gate: "Before writing any judgment, scan for unsourced
claims. Every assertion needs file:line evidence."

### Enhancement 7: Explicit Routing Criteria
**Technique:** Decision tree for conditional paths
**Target skills:** plan-phase, new-project, resume
**What to add:** Formalize IF/THEN routing as decision rules instead of prose.

### Enhancement 8: Action Gating by Phase
**Technique:** Tool allowlists per execution stage
**Target skills:** exec-phase, focus-exec
**What to add:** Table showing which tools are appropriate at each stage.
Prevents misuse (e.g., Edit during verification).

### Enhancement 9: Progressive Disclosure
**Technique:** Layered context loading
**Target skills:** new-project, map-codebase, focus-design
**What to add:** Context loading layers: (1) manifest, (2) structure, (3) hotspots,
(4) baselines. Load progressively, not all at once.

### Enhancement 10: Failure Pattern Capture
**Technique:** Log and learn from repeated failures
**Target skills:** focus-auto, focus-exec
**What to add:** When same failure pattern appears 2+ times, capture it and suggest
a new anti-pattern rule for future runs.

### Enhancement 11: Diversity Injection
**Technique:** Vary approach for similar batch items
**Target skills:** focus-exec, focus-auto
**What to add:** For batches of similar items, vary the fix strategy to avoid
tunnel vision and catch emergent interactions.

### Enhancement 12: Meta-Prompting
**Technique:** Self-generated reasoning templates
**Target skills:** focus-design, debug
**What to add:** Before complex phases, have agent generate its own investigation
strategy, then follow it.

---

## Execution Order

Apply in priority order, one at a time:
1. Output Contract Specification (exec-phase, focus-exec, focus-auto, plan-phase)
2. Negative Examples / Anti-Patterns (focus-exec, exec-phase, plan-phase)
3. Dependency-Aware Phase Rules (exec-phase, focus-exec, focus-auto)
4. Structured Handoff Protocol (pause, resume, debug)
5. Todo-List Recitation (focus-auto, exec-phase, focus-exec)
6. Grounding / Citation Enforcement (verify-phase, milestone-audit, assumptions)
7. Explicit Routing Criteria (plan-phase, new-project, resume)
8. Action Gating by Phase (exec-phase, focus-exec)
9. Progressive Disclosure (new-project, map-codebase, focus-design)
10. Failure Pattern Capture (focus-auto, focus-exec)
11. Diversity Injection (focus-exec, focus-auto)
12. Meta-Prompting (focus-design, debug)
