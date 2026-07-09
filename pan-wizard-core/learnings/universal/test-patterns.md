---
topic: test-patterns
last_updated: 2026-05-03T03:29:54.837Z
patterns:
  - id: P-001
    summary: Assert non-deterministic CLI output by SHAPE not VALUE
    promoted_at: 2026-04-27T09:26:19.280Z
    source_experiments: [whooo]
  - id: P-002
    summary: Use execFileSync over execSync for CLI subprocess tests
    promoted_at: 2026-04-27T09:26:26.755Z
    source_experiments: [whooo]
  - id: P-204
    summary: Test the violation/error CONTRACT (codes + field names + severity), not message prose
    promoted_at: 2026-04-27T09:49:02.194Z
    source_experiments: [whooo]
  - id: P-NPRS-004
    summary: Pure-logic helper extracted from side-effect wrapper makes Win32/IO/network code testable without a real environment
    promoted_at: 2026-05-03T03:29:54.837Z
    source_experiments: [notepadrs]
---

# Test Patterns (AI-derived)

> Auto-maintained by `pan-tools learn promote`. Each pattern was extracted from one or more experiment runs (see source_experiments). Patterns are **advisory** — orchestrators should weight them against current context.

## P-001 — Assert non-deterministic CLI output by SHAPE not VALUE

**Evidence:** whooo build: a naive test asserting the exact ISO timestamp would have been flaky on every run. Asserting the regex shape /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/ catches output regressions without flakiness.

**Rule:** When testing CLI output that contains non-deterministic data (timestamps, UUIDs, hashes, PIDs, paths), assert the SHAPE of the output via regex rather than the exact value. The shape is the contract; the value is incidental.

**Applies in:** exec-phase, focus-exec, plan-phase (when planning test cases)

## P-002 — Use execFileSync over execSync for CLI subprocess tests

**Evidence:** whooo test/whooo.test.js used execFileSync('node', [BIN]) directly. Cross-platform safe, no shell-injection surface, no dependency on shell behavior.

**Rule:** When testing CLI binaries via subprocess, use execFileSync(bin, args) rather than execSync('command string'). execFileSync skips the shell, avoids shell-injection risk, and is portable across Windows/Unix without quoting differences.

**Applies in:** exec-phase (writing tests), test-file generation in plan-phase

## P-204 — Test the violation/error CONTRACT (codes + field names + severity), not message prose

**Evidence:** whooo trace.jsonl 11:40Z (decision minor): Tests assert violation SHAPE not exact string messages. Cites P-001 and explicitly generalizes the timestamp-shape principle. All 9 validate.test.js tests follow this pattern: they assert code, field, severity but never the message text.

**Rule:** When testing structured error/violation/diagnostic output of the form {file, line, code, message, severity, ...}, assert on the stable contract fields (code, field, severity, type) and NEVER on the human-readable message text. Messages evolve for clarity; codes are the API consumers depend on. Generalizes P-001 (timestamp-shape): same principle, broader application.

**Applies in:** exec-phase (writing tests for any tool emitting structured diagnostics), plan-phase (test-case design)

## P-NPRS-004 — Pure-logic helper extracted from side-effect wrapper makes Win32/IO/network code testable without a real environment

**Evidence:** notepadrs recurring split: dispatch_pure.rs (decision logic) + dispatch.rs (Win32 wiring); decide_next_wrap_state (pure) + apply_wrap (unsafe Win32); tab_close_decision pure fn + Tab Drop impl; categorize_open_error (pure) + open_path_external (Win32). 109 tests in Phase 2; 35 gap-coverage tests in Phase 3 verification — almost all hit the pure helpers headlessly via cargo test, no Windows desktop required.

**Rule:** When you write a function that mixes a NON-OBVIOUS DECISION (what to do) with a SIDE EFFECT (Win32 message, file write, network call), split it into two functions in two files: foo_pure.rs::decide_foo(&inputs) -> FooDecision (pure, headless-testable) + foo.rs::apply_foo(&hwnd_or_handle, decision) (the unsafe / I/O effect). Test the decision exhaustively at the unit layer; cover the wrapper with a thin smoke test (or skip it if it's just 5 lines of API plumbing). Cost: one extra file per side-effect family. Payoff: cargo test / npm test stays fast and reproducible across platforms, and the decision logic gets the test density it deserves.

**Applies in:** Win32 message dispatch, IPC handlers, network request encoding, database query construction, any code that mixes decision logic with a side effect
