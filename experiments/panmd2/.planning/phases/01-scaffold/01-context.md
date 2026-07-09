# Phase 1: Scaffold - Context

**Gathered:** 2026-04-27
**Status:** Ready for planning

<domain>
## Phase Boundary

Working binary that walks `.md` files recursively, emits structured output with correct stdout/stderr/exit-code behavior. No rules yet — the binary runs end-to-end with zero violations (no rules loaded). This phase establishes the I/O contract that all subsequent phases build on.

</domain>

<decisions>
## Implementation Decisions

### Output format
- Human format: one violation per line, `file:line:col: severity rule message` (familiar grep/eslint style)
- JSON format: `process.stdout.write(JSON.stringify(results))` — array of violation objects, not pretty-printed by default
- `--format human` is the default; `--format json` is the flag
- With zero violations, human format emits nothing to stdout; JSON format emits `[]`

### Flag design
- Use `util.parseArgs` (stable in Node.js v20+) — no external arg parser
- `panmd lint <dir>` as the primary invocation (positional arg for target directory)
- `--format human|json` (string type, default "human")
- `--rules <comma-list>` (string type, parsed later in Phase 3)
- `--fix` (boolean type, implemented in Phase 4)
- `--help` and `--version` (boolean types)
- Short flags: none in v1 — keep it simple, add `-f`, `-r` etc. in v2 if needed

### File walker
- `fs.readdirSync` with manual recursion using `{ withFileTypes: true }` — avoid `{ recursive: true }` bug (research finding)
- Filter by `.md` extension using `path.extname`
- Walk target directory only — no symlink following
- Sort files alphabetically for deterministic output order
- No ignore patterns in Phase 1 — deferred to v2

### Exit codes
- 0 = clean (no violations found)
- 1 = violations found (at least one error-severity violation)
- 2 = runtime error (bad args, target dir not found, etc.)
- Use `process.exitCode = N` not `process.exit(N)` — lets stdout drain (research finding)

### stderr contract
- All diagnostic messages (version, help, warnings, errors) go to stderr
- Only violation output goes to stdout
- This ensures `panmd lint . --format json | jq .` works correctly

### Project structure
- `bin/panmd.js` — CLI entry point with shebang
- `src/walker.js` — file discovery
- `src/engine.js` — linter engine (stub in Phase 1, receives file list, returns empty violations)
- `src/formatters/human.js` and `src/formatters/json.js` — output formatters
- `package.json` with `"bin": { "panmd": "bin/panmd.js" }`, `"engines": { "node": ">=22.2.0" }`
- CommonJS throughout (not ESM) — simpler for sync I/O CLI tool

### Claude's Discretion
- Exact human format spacing and alignment
- Whether to show a summary line (e.g., "0 violations found") in human format
- Help text wording
- Package.json metadata (description, keywords, license)

</decisions>

<specifics>
## Specific Ideas

- Use `process.stdout.write` not `console.log` (project constraint)
- Sync I/O throughout per P-401
- Data-driven dispatcher pattern per P-403 for formatter selection
- Assert SHAPE per P-204 for violation objects
- Trailing newline in all output per P-402

</specifics>

<deferred>
## Deferred Ideas

- `--ignore` glob patterns for file/directory exclusion — v2 requirement (ADVC-01)
- Short flags (`-f`, `-r`) — add if usage patterns demand it
- Color/ANSI output for human format — not in v1 scope
- `fs.globSync` as alternative to manual recursion — validate in testing

</deferred>

---

*Phase: 01-scaffold*
*Context gathered: 2026-04-27*
