---
topic: live-path-honesty
last_updated: 2026-07-18T08:42:29.859Z
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
  - id: P-FH-003
    summary: When the output channel is unreliable, verify results via a raw independent read
    promoted_at: 2026-07-18T08:42:29.849Z
    source_experiments: [field-harvest-2026-07]
  - id: P-FH-015
    summary: In live paths, surface empty results and real outcomes honestly — never substitute fabricated fallbacks
    promoted_at: 2026-07-18T08:42:29.854Z
    source_experiments: [field-harvest-2026-07]
  - id: P-FH-032
    summary: A load harness that exercises a fault path reports false throughput; validate the real success path first
    promoted_at: 2026-07-18T08:42:29.859Z
    source_experiments: [field-harvest-2026-07]
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

## P-FH-003 — When the output channel is unreliable, verify results via a raw independent read

**Evidence:** A resume note recorded that a session's tool-output channel intermittently truncated/garbled the display; the standing discipline became verifying every build/test/VCS result via a raw byte hexdump, stopping-and-reverting on empty mid-edit reads, and never committing a verified claim on unread or fabricated output.

**Rule:** If the tool/display channel is intermittently truncating or garbling output, do not trust rendered command results — confirm each build/test/VCS outcome through an independent raw channel (hexdump the bytes, checksum, read an exit-code file) and treat a garbled or empty read as 'unknown', never as 'passed'. If a file read comes back empty or corrupted mid-edit, stop and confirm the channel is actually dead before reverting, and never assert a verified claim on output you did not actually read.

**Applies in:** production/live code paths; dashboards; load & perf harnesses; status reporting

## P-FH-015 — In live paths, surface empty results and real outcomes honestly — never substitute fabricated fallbacks

**Evidence:** Live screens fell back to app-computed amounts when the source returned zero line items, and an approval flow reported 'submitted-awaiting-approval' even when the backend had executed the command immediately with no queue.

**Rule:** On production/live code paths an empty or absent upstream result must render as an honest empty/zero state, never be silently replaced with app-computed, demo, or placeholder data; and status/outcome strings must reflect the actual backend response (e.g. report a queued-for-approval state only when the backend actually returned a queued command handle), never optimistically hardcoded. Gate any computed-placeholder or demo fallback strictly to demo/offline modes.

**Applies in:** production/live code paths; dashboards; load & perf harnesses; status reporting

## P-FH-032 — A load harness that exercises a fault path reports false throughput; validate the real success path first

**Evidence:** A local load run showed collapsed throughput because every dispatch faulted (no configured provider for the channel) and dead-lettered into a queue with no consumers, causing a retry storm; fixing the harness to send a valid, deliverable request restored draining and produced trustworthy numbers.

**Rule:** A performance/load number is only meaningful if the harness drives the real success path. A misconfigured target (missing dependency, wrong channel, malformed request) can make every request fail fast into a dead-letter/retry path, which reads as collapsed or zero throughput and slanders healthy code. Before trusting any throughput figure, assert the success path actually succeeds (2xx responses, work queue drains to zero, error rate ~0); only then are the latency/TPS numbers honest.

**Applies in:** production/live code paths; dashboards; load & perf harnesses; status reporting
