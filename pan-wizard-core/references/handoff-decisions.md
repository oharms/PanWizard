# Handoff Decisions Reference (P-RES-003)

This reference defines the schema for the **decisions trace** that flows
through PAN's serial pipeline:

```
planner ─[plan.md "Plan Decisions"]──▶ executor ─[summary.md "Implementation Decisions"]──▶ verifier
```

## Why this exists

Cognition's "Don't build multi-agents" (Jun 2025) named the dominant failure
mode of pipeline-based AI: parallel sub-agents fail because every action
encodes unstated decisions that downstream agents reconcile blindly.
Anthropic's countervailing piece argues breadth-first **reads** parallelize
fine but **writes** need a single coherent trace. PAN is mostly serial, but
its file-mediated handoff carried only **artifacts** (plan.md, summary.md) —
not the **reasoning** behind them. This reference fixes that without changing
the file contract: it adds a structured section to each artifact that captures
what would otherwise stay in the agent's head.

## Schema — `## Plan Decisions` (planner → executor handoff)

Lives in `plan.md`, between `<objective>` and `<tasks>`:

```markdown
## Plan Decisions

### Locked (executor MUST follow)
- D-1: <statement>. Why: <rationale>. Source: <context.md REQ-X | research.md | architecture constraint>.

### Open (executor's discretion within constraints)
- O-1: <decision space>. Constraints: <list>. Reason left open: <why planner did not lock>.

### Considered and rejected
- R-1: <alternative>. Rejected because: <reason>.
```

If the plan is mechanical and there genuinely are no notable decisions, write
this single line instead of empty buckets:

```markdown
## Plan Decisions

No decisions worth documenting — plan is mechanical implementation of must_haves.
```

### Bucket semantics

- **Locked** — Constraints the executor MUST follow. If the executor
  diverges, that's a deviation and must be logged in the summary.
  Examples: library choice, security pattern, naming convention,
  protocol shape, error-handling style.

- **Open** — Choices left to the executor's judgment, but bounded.
  The planner names the decision space and the constraints; the
  executor picks within them. The executor should log which option
  they took in the summary's `Decisions Taken`.
  Example: "Hashing algorithm: bcrypt | argon2 | scrypt. Constraint:
  zero-deps Node builtin. Reason left open: equivalent for this use case."

- **Considered and rejected** — Alternatives the planner explored and
  ruled out. Helps the executor avoid re-deriving the same path and
  helps the verifier understand why the implementation looks the way
  it does.

### When to use each bucket

| Bucket | When to fill |
|--------|--------------|
| Locked | Anything where executor divergence would break the plan |
| Open | Decisions where multiple correct answers exist; executor picks |
| Considered/rejected | Significant alternatives explored — only meaningful ones (not "I considered any random thing") |

## Schema — `## Implementation Decisions` (executor → verifier handoff)

Lives in `summary.md`, after `## Files Changed`:

```markdown
## Implementation Decisions

### Taken (within plan's discretion)
- DT-1: Chose <option> for O-N. Reason: <rationale>.

### Deviations (from plan; must explain)
- DV-1: Plan said <X>; I did <Y>. Reason: <rationale>. Verification: <how I confirmed Y is acceptable>.

### Open questions for verifier
- Q-1: <question>. Why it matters: <stake>.
```

If implementation followed plan exactly with no notable items:

```markdown
## Implementation Decisions

No deviations or open questions — implementation followed plan exactly.
```

### Bucket semantics

- **Taken** — Which option the executor picked for each `Open` (O-N)
  decision the plan declared. Reference the original `O-N` ID so the
  verifier can cross-check.

- **Deviations** — Where the executor departed from a `Locked` (D-N)
  decision. Must include the reason AND a verification step (how the
  executor confirmed the deviation is acceptable). Without the
  verification step, this is just an unauthorized change — the verifier
  should treat such a deviation as a finding.

- **Open questions for verifier** — Decisions the executor consciously
  punted to the verifier. NOT a substitute for the existing verification
  dimensions; an EXTRA focus area. The verifier uses these to know
  where to spend extra attention.

## Reading order for downstream agents

- **Executor**, before writing any code:
  1. Read `## Plan Decisions` first
  2. Internalize the Locked bucket as constraints
  3. Note Open decisions to revisit when those task lines come up
  4. Skim Considered/rejected to avoid re-deriving rejected alternatives

- **Verifier**, before checking the code:
  1. Read `## Implementation Decisions` from each plan's summary
  2. For each Deviation, verify the executor's stated verification
  3. For each Open Question, spend extra time on that area
  4. Cross-reference Decisions Taken against the plan's Open bucket
     (every plan-declared `O-N` should have a corresponding `DT-N` or
     have been mooted)

## Empty-bucket discipline

The schema MUST be machine-parseable. Forbidden:

- Section header present, all buckets silently empty (no "no decisions" line)
- Bucket header present with no items and no parenthetical "(none)"
- Out-of-order buckets

`pan-plan-checker` Dimension 12 (P-RES-003) enforces this on the planner side.

## Versioning

Schema version: v1 (introduced v3.7.10).

If this schema ever changes, add a `decisions_schema: v2` field to the
plan.md frontmatter and document the new shape here. Older plans without
that field default to v1.

## Source

- Cognition, "Don't Build Multi-Agents" (Jun 2025): https://cognition.ai/blog/dont-build-multi-agents
- Anthropic, "How we built our multi-agent research system": https://www.anthropic.com/engineering/multi-agent-research-system
- Internal: `pan-wizard-core/learnings/internal/external-research.md` P-RES-003
- Spec: this reference doc IS the spec; no separate doc.
