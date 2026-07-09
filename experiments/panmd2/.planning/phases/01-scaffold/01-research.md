# Phase 1: Scaffold - Research

**Researched:** 2026-04-27
**Domain:** CLI binary scaffold with file walker, stub engine, formatters, and I/O contract
**Confidence:** HIGH (all claims verified via project-level research; no new external research needed)

## Summary

Phase 1 builds the working binary end-to-end: CLI entry point, file walker, stub engine, two formatters, and the stdout/stderr/exit-code contract. No rules exist yet — the engine returns an empty violations array. The goal is a runnable `panmd lint <dir>` that exercises the full pipeline with zero violations.

All technology decisions are locked by project-level research (see `.planning/research/stack.md` and `.planning/research/architecture.md`). Phase 1 adds no new libraries, no new patterns — it instantiates the architecture research into concrete files.

**Primary recommendation:** Build bottom-up (walker, engine, formatters, then CLI entry) so each layer is testable before integration.

<user_constraints>
## User Constraints (from context.md)

### Locked Decisions
- Human format: `file:line:col: severity rule message` (grep/eslint style)
- JSON format: `process.stdout.write(JSON.stringify(results))` — array of violation objects, not pretty-printed
- `--format human` default; `--format json` flag
- Zero violations: human emits nothing to stdout; JSON emits `[]`
- Use `util.parseArgs` (stable in Node.js v20+) — no external arg parser
- `panmd lint <dir>` as primary invocation (positional arg for target directory)
- `--format human|json`, `--rules <comma-list>`, `--fix`, `--help`, `--version` flags
- Short flags: none in v1
- `fs.readdirSync` with manual recursion using `{ withFileTypes: true }` — avoid `{ recursive: true }` bug
- Filter by `.md` extension using `path.extname`
- Walk target directory only — no symlink following
- Sort files alphabetically for deterministic output order
- Exit codes: 0 = clean, 1 = violations found, 2 = runtime error
- Use `process.exitCode = N` not `process.exit(N)`
- stderr for all diagnostics; stdout for violation output only
- `bin/panmd.js` — CLI entry point with shebang
- `src/walker.js` — file discovery
- `src/engine.js` — linter engine (stub in Phase 1)
- `src/formatters/human.js` and `src/formatters/json.js`
- `package.json` with `"bin": { "panmd": "bin/panmd.js" }`, `"engines": { "node": ">=22.2.0" }`
- CommonJS throughout (not ESM)

### Claude's Discretion
- Exact human format spacing and alignment
- Whether to show a summary line in human format
- Help text wording
- Package.json metadata (description, keywords, license)

### Deferred Ideas (OUT OF SCOPE)
- `--ignore` glob patterns — v2
- Short flags (`-f`, `-r`) — v2
- Color/ANSI output — not in v1
- `fs.globSync` as alternative — defer
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| CLI-01 | `panmd lint <dir>` walks `.md` files recursively, emits violations to stdout | Architecture research: CLI entry + walker + engine + formatter pipeline |
| CLI-02 | `--format human|json` controls output format | Context.md locks format design; architecture research: formatter layer |
| CLI-05 | Exit code 0/1/2 contract | Stack research: `process.exitCode` pattern; pitfalls research: Pitfall 2 |
| CLI-06 | stderr for diagnostics, stdout for violations only | Pitfalls research: Pitfall 2; architecture research: formatter/CLI separation |
| CONS-01 | Zero runtime dependencies | Stack research: all Node.js built-ins; no npm install needed |
| CONS-02 | Uses `process.stdout.write` not `console.log` | Stack research: "What NOT to Use" section |
| CONS-03 | Sync I/O throughout (P-401) | Stack research: all sync fs APIs documented |
</phase_requirements>

## Phase-Specific Findings (Deltas from Project-Level Research)

### File Structure for Phase 1

Only a subset of the full architecture is needed. Phase 1 creates:

```
bin/
  panmd.js          # CLI entry: shebang, util.parseArgs, dispatch
src/
  walker.js         # fs.readdirSync recursive, filter .md, sort alphabetically
  engine.js         # lint(filePaths, readFile) → LintResult[] (stub: empty violations)
  formatters/
    human.js        # format(results) → string (grep-style)
    json.js         # format(results) → string (JSON.stringify)
test/
  walker.test.js    # Test file discovery against fixture directory
  engine.test.js    # Test stub engine returns empty violations
  cli.test.js       # Integration: run binary, check stdout/stderr/exit code
  formatters.test.js # Test both formatters with mock data
fixtures/
  sample/
    valid.md        # A clean .md file for walker tests
    subdir/
      nested.md     # Nested .md file to verify recursion
    not-md.txt      # Non-.md file to verify filtering
package.json        # bin, engines, scripts
```

### util.parseArgs Configuration

Per context.md decisions, the exact `parseArgs` config for Phase 1:

```javascript
const { values, positionals } = parseArgs({
  args: process.argv.slice(2),
  options: {
    format: { type: 'string', default: 'human' },
    rules: { type: 'string' },
    fix: { type: 'boolean', default: false },
    help: { type: 'boolean', default: false },
    version: { type: 'boolean', default: false },
  },
  allowPositionals: true,
  strict: true,
});
```

`strict: true` causes `parseArgs` to throw on unknown flags — catch this and exit 2 with a message to stderr.

### Engine Stub Design

In Phase 1, the engine has no rules to run. It should still exercise the full contract:

```javascript
function lint(filePaths, readFile) {
  return filePaths.map(filePath => ({
    filePath,
    violations: [], // No rules loaded in Phase 1
  }));
}
```

The engine receives a `readFile` function (dependency injection per architecture research Pattern 2). In Phase 1 it doesn't call it (no rules), but the signature is established for Phase 2.

### Formatter Contracts

**Human formatter:**
- Input: `LintResult[]` (array of `{ filePath, violations[] }`)
- Output: string (one line per violation: `filePath:line:col: severity rule message`)
- When no violations across all files: return empty string (no output)
- Trailing newline after last violation line

**JSON formatter:**
- Input: `LintResult[]`
- Output: `JSON.stringify(results)` + `\n`
- When no violations: `[]\n`

### Test Strategy for Phase 1

Tests use `node:test` and `node:assert/strict`. All tests are sync.

| Test | What It Verifies | Command |
|------|------------------|---------|
| walker.test.js | Finds .md files recursively, excludes non-.md, sorts alphabetically | `node --test test/walker.test.js` |
| engine.test.js | Returns LintResult[] with empty violations per file | `node --test test/engine.test.js` |
| formatters.test.js | Human format outputs correct format; JSON outputs valid JSON | `node --test test/formatters.test.js` |
| cli.test.js | Full binary run: exit 0, JSON pipe works, stderr clean | `node --test test/cli.test.js` |

Run all: `node --test test/`

## Common Pitfalls (Phase 1 Specific)

From project-level pitfalls research, these apply to Phase 1:

1. **Pitfall 2 (stdout/stderr mixing):** Establish the contract NOW. All diagnostics to stderr, violations only to stdout. Test with `--format json | jq .` from day one.

2. **Pitfall 6 (symlinks in walker):** Context.md says "no symlink following." Use `dirent.isFile()` and `dirent.isDirectory()` from `{ withFileTypes: true }` — these do NOT follow symlinks. Do NOT use `fs.statSync` which follows symlinks.

3. **Pitfall 11 (trailing newline at EOF):** Handle in formatter, not in engine. Ensure output always ends with `\n` per P-402.

## Infrastructure Dependencies

None — unit tests only, no external infrastructure needed.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all APIs are stable built-ins, verified in stack.md
- Architecture: HIGH — direct instantiation of architecture.md patterns
- Pitfalls: HIGH — phase-specific subset of verified pitfalls.md

**Research date:** 2026-04-27
**Valid until:** 2026-05-27 (stable stack, unlikely to change)
