---
topic: live-path-honesty
last_updated: 2026-07-09T14:04:40.512Z
patterns:
  - id: P-HON-001
    summary: No fabricated data or fabricated success on live/trusted paths — demo synthetics and test fixtures are legitimate; fake data feeding real actions and success flags with no backing call are violations
    promoted_at: 2026-07-09T14:04:40.509Z
    source_experiments: [lending-fake-code-audit]
  - id: P-HON-002
    summary: Render honest-empty states instead of synthetic data on live paths, gate all demo values behind an explicit demo flag that defaults OFF, and never parse feature flags as "enabled unless literal false"
    promoted_at: 2026-07-09T14:04:40.511Z
    source_experiments: [lending-fake-code-audit]
  - id: P-HON-003
    summary: Scaffold is not deliverable: code is not complete while any generated stub (NotImplementedException / placeholder body) remains — wire an automated conformance check that flags unimplemented stubs
    promoted_at: 2026-07-09T14:04:40.512Z
    source_experiments: [spec-factory]
---

# Live Path Honesty (AI-derived)

> Auto-maintained by `pan-tools learn promote`. Each pattern was extracted from one or more experiment runs (see source_experiments). Patterns are **advisory** — orchestrators should weight them against current context.

## P-HON-001 — No fabricated data or fabricated success on live/trusted paths — demo synthetics and test fixtures are legitimate; fake data feeding real actions and success flags with no backing call are violations

**Evidence:** A read-only fake-code audit of a staff-facing lending frontend (92 agents, 1,155 file inspections) found: a local flag asserting "arrangement recorded" with no backend call ever made; hardcoded debts feeding a REAL disbursement saga; guards that fail open (policy=null => pass); and a .catch(()=>null) that reported COMPLETE on a failed write. The audit doctrine that made findings tractable: demo-labelled synthetics, simulator test-doubles and fixtures are legitimate — violations are fabrication on live/trusted paths and status surfaces computed from constants.

**Rule:** Classify every synthetic value by the path it flows into. On live/trusted paths: no hardcoded domain data, no success status without the backing side effect having actually happened, no fail-open guards on policy checks, no swallowed errors that report completion. Audit for status surfaces computed from constants and placeholders presented as working features. Demo-labelled synthetics and test fixtures are fine — the violation is fabrication presented as real.

**Applies in:** Fake-code audits, code review lenses, verifier anti-pattern scans, any app with a demo mode adjacent to a live mode.

## P-HON-002 — Render honest-empty states instead of synthetic data on live paths, gate all demo values behind an explicit demo flag that defaults OFF, and never parse feature flags as "enabled unless literal false"

**Evidence:** Same audit: a feature ran against a public demo API on a staff-facing surface because the gate was "enabled unless the env var is exactly the string false" — any typo, unset var, or casing difference silently enabled it. The accepted remediation doctrine: on a live path with no real data, render an honest "not available / nothing was transmitted" state; every demo/synthetic value sits behind one explicit demo flag; synthetic features default OFF; fix plans also removed a fake progress spinner and retitled a step honestly.

**Rule:** When a live path has no real data, show an honest empty state — never synthetic stand-in data. Put every demo/synthetic value behind one explicit demo flag and default it OFF. Parse feature gates as "disabled unless explicitly enabled"; a gate of the form enabled-unless-value-equals-false fails open on every unset or mistyped value.

**Applies in:** UI states, feature flags, demo modes, environment-variable gates.

## P-HON-003 — Scaffold is not deliverable: code is not complete while any generated stub (NotImplementedException / placeholder body) remains — wire an automated conformance check that flags unimplemented stubs

**Evidence:** A spec-to-code factory pipeline shipped scaffolds whose every service body threw NotImplementedException; its SOP had to state explicitly "This is a SKELETON — a case is not code-complete while any scaffolded NotImplementedException remains", and a conformance evaluator gained a code_unimplemented check because generated skeletons otherwise "look done" to downstream agents.

**Rule:** Treat generated scaffolds as skeletons, never as deliverables. Add an automated conformance check that fails handoff while any generated stub marker (NotImplementedException, unimplemented!, TODO-body, placeholder DTO) remains. An agent must not be able to mark work complete on the strength of files that merely exist and compile.

**Applies in:** Code generators, scaffolding steps, verifier artifact checks (exists vs substantive vs wired).
