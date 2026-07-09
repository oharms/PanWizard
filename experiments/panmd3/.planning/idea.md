---
title: "panmd — pluggable markdown linter with rule-based architecture"
created: "2026-04-27"
created_by: oharms
runtime_preference: claude
budget: 100
priority: high
planning_depth: standard
parallelization: true
research_enabled: true
plan_checker_enabled: true
verifier_enabled: true
model_profile: balanced
---

# panmd — pluggable markdown linter

A zero-dependency Node.js CLI markdown linter with a **plugin-style rule architecture** — each rule is a self-contained module that exports a check function. Composable, testable in isolation, and extensible without touching core code.

## Problem

PAN Wizard's `docs/` directory has 16 user-facing markdown files plus 38 spec files plus 24 ADRs plus 33 workflows plus 51 commands. Drift accumulates: trailing whitespace, lines over 120 chars, broken internal links, headings that skip levels (H1 → H3), missing required frontmatter fields. A linter with **per-rule plugins** would let us add new rules over time without rewriting core, and self-apply to PAN's own corpus to find real issues.

This idea is substantive enough to validate the v3.7.0 self-improvement loop on a **multi-phase, multi-plan project** — substantively bigger than whootoc.

## Success Criteria

- **SC-1**: `panmd lint <dir>` walks `.md` files, runs all enabled rules, emits structured violations to stdout.
- **SC-2**: At least 5 working rules implemented, each in its own file under `src/rules/`:
  - `frontmatter-required` — required fields per a configurable schema (mirror of whooo)
  - `heading-skip` — flag jumps from `##` to `####` (skipping `###`)
  - `line-length` — flag lines >120 chars (configurable)
  - `trailing-whitespace` — flag lines with trailing space
  - `internal-link` — flag `[text](path.md)` links to non-existent files
- **SC-3**: Each rule exports a uniform `{ name, description, severity, check(content, opts, filePath) → violations[] }` shape; loaded dynamically from `src/rules/*.js`.
- **SC-4**: `--rules <comma-list>` runs only the named rules; default is all.
- **SC-5**: `--fix` applies safe auto-fixes (only for trailing-whitespace by default; other rules are report-only). Documents which rules support `--fix`.
- **SC-6**: `--format human|json` output formats.
- **SC-7**: ≥12 tests across rules + CLI, including one that runs panmd against PAN's `docs/` (dogfood gate).
- **SC-8**: `npm test` exits 0 with all tests passing.
- **SC-9**: Zero runtime dependencies. Built-in `node:test`, `node:fs`, `node:path` only.

## Scope

| In Scope | Out of Scope |
|----------|--------------|
| 5 core rules listed above | MDX, GFM extensions (tables, footnotes) |
| Per-rule severity (error/warning/info) | Severity overrides via config (always rule default) |
| Plugin discovery from `src/rules/*.js` | Loading rules from npm packages or user paths |
| `--fix` for trailing-whitespace | Auto-fix for any other rule (out for v0.1) |
| Human + JSON output formats | NDJSON streaming, sarif, GitHub Actions annotations |
| Cross-platform paths (forward slashes) | Symlink resolution beyond what fs handles |
| Reading config from `panmd.config.json` if present | Cascading configs / .editorconfig |

## Constraints

- Zero runtime dependencies. Everything from Node.js built-ins.
- Use `process.stdout.write` not `console.log`.
- Apply prior universal patterns: P-401 (sync I/O), P-402 (trailing newline), P-403 (data-driven dispatcher), P-204 (assert SHAPE), P-501 (no `**/` in JSDoc), P-901 (round-trip tests where applicable), P-1101 (Buffer for binary, string for text).
- Per P-203: each phase MUST document its explicit Out-of-Scope cuts.
- Per P-1402: per-phase research must read project-level research first, not re-derive.

## Suggested phase decomposition (the planner can override)

1. **Project scaffolding** — package.json, dirs, CLI stub, rule-loader skeleton (1 plan, lightweight per P-1401)
2. **Rule architecture** — rule schema, loader, dispatcher, severity handling
3. **Core rules** — implement 5 rules (parallel plans, one per rule)
4. **CLI integration** — argv parsing, config loading, --fix, --format, --rules
5. **Test suite + dogfood** — unit tests per rule, integration tests, run against PAN docs/

## Reference material

- Compare conceptually to: `eslint`, `markdownlint`, `vale`. We're a much smaller subset for our specific needs.
- Reuse pattern from `whooo` (frontmatter parsing) and PAN's `pan-wizard-core/bin/lib/doc-lint/` (vendored from whooo).

## Notes

This is a deliberate **scale-up validation** of the v3.7.0 autonomous loop. After v3.7.3 patches:
- P-1304 (runner shell-quote) — should spawn cleanly
- P-1301 (auto-mode AskUserQuestion) — should not stall
- P-1401 (lightweight-phase bypass) — Phase 1 should be fast
- P-1402 (phase-researcher reads project research) — phase research should be tight
- P-1404 (session reuse) — trace data should consolidate into one session
- **P-1501** (open) — auto-mode workflow ending with prose. We'll see if substantive workflows continue past Phase 0 or hit the same wall as the trivial whoonum experiment.
