# Phase 1: Project Setup - Research

**Researched:** 2026-04-27
**Domain:** Node.js ESM package scaffolding
**Confidence:** HIGH

## Summary

Phase 1 scaffolds a zero-dependency Node.js CLI package (`whootoc`) with ESM module format and a bin entry. This is well-trodden territory — Node.js v22+ has mature ESM support, and the patterns are stable and well-documented.

The locked decisions from context.md (ESM, Node.js v22+ floor, `src/cli.js` entry, `node:test` runner) are all standard 2025/2026 best practices. No alternatives need exploration.

**Primary recommendation:** Create a minimal `package.json` with `"type": "module"`, scaffold the directory structure, and wire a shebang-equipped `src/cli.js` as the bin entry.

<user_constraints>
## User Constraints (from context.md)

### Locked Decisions
- ESM (`"type": "module"`) with Node.js v22+ engine floor
- Shebang line in bin entry: `#!/usr/bin/env node`
- `src/cli.js` — bin entry point (I/O layer only)
- `src/lib/` — pure function modules (parser, slugger, renderer) — created empty, populated in Phase 2
- `test/` — test directory for `node:test` suite
- `bin.whootoc` points to `src/cli.js`
- `engines.node` set to `>=22.0.0`
- Zero `dependencies` — only `devDependencies` if any
- `scripts.test` set to `node --test`
- `process.stdout.write` convention (PAN P-402) — CLI entry should stub a minimal "no args" message on startup

### Claude's Discretion
- Exact package.json metadata (description, license, author)
- Whether to include a `.gitignore` or `.editorconfig`
- Exact startup message when run with no arguments

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| PROJ-01 | Package uses ESM (`"type": "module"`) with Node.js v22+ engine floor | ESM is the standard module format for Node.js v22+. `"type": "module"` in package.json enables `.js` files as ESM by default. `"engines": { "node": ">=22.0.0" }` enforces the floor. |
| PROJ-02 | Zero runtime dependencies | Package.json should have no `dependencies` field (or empty object). Dev dependencies are allowed. |
| PROJ-03 | `bin` entry in package.json for `whootoc` command | `"bin": { "whootoc": "src/cli.js" }` in package.json. File must have `#!/usr/bin/env node` shebang as first line. |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Node.js | >=22.0.0 | Runtime | Active LTS (April 2025 - April 2027), stable ESM, built-in test runner |
| node:test | built-in | Test runner | Zero-dep testing, ships with Node.js 22+ |

### Supporting
No supporting libraries needed — Phase 1 is pure scaffolding with zero dependencies.

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `node:test` | jest/vitest | Would add devDependencies; unnecessary for this project's scope |
| `"type": "module"` | `.mjs` extensions | ESM-by-default via package.json is cleaner and more conventional |

**Installation:**
```bash
npm init -y  # then manually configure package.json
```

## Architecture Patterns

### Recommended Project Structure
```
whootoc/
├── package.json          # ESM, bin entry, zero deps
├── src/
│   ├── cli.js           # bin entry point with shebang
│   └── lib/             # empty — populated in Phase 2
│       └── .gitkeep     # preserve empty directory in git
├── test/                # test directory for node:test
│   └── .gitkeep         # preserve empty directory in git
└── .gitignore           # node_modules, coverage
```

### Pattern 1: ESM Bin Entry
**What:** CLI entry point using ESM with proper shebang
**When to use:** Any Node.js CLI tool using ESM
**Example:**
```javascript
#!/usr/bin/env node
// src/cli.js — whootoc CLI entry point

const args = process.argv.slice(2);

if (args.length === 0) {
  process.stdout.write('Usage: whootoc --input <file> [--from-stdin] [--max-depth N]\n');
  process.exit(0);
}
```

### Pattern 2: Separation of I/O and Logic
**What:** CLI entry handles only I/O (argv parsing, stdin/stdout); pure functions live in `src/lib/`
**When to use:** Any CLI tool that needs testable business logic
**Example:** `cli.js` imports from `src/lib/`, calls pure functions, writes results to stdout

### Anti-Patterns to Avoid
- **Mixing I/O and logic in cli.js:** Makes testing difficult. Keep cli.js thin — it should only parse args, read input, call library functions, and write output.
- **Using `require()` in ESM:** Will throw `ERR_REQUIRE_ESM`. Use `import` statements exclusively.
- **Missing shebang:** Without `#!/usr/bin/env node`, the bin entry won't execute properly on Unix systems.
- **Forgetting executable permission:** On Unix, `src/cli.js` needs execute permission for `npx whootoc` to work. npm handles this during install, but for local dev, `chmod +x src/cli.js` may be needed.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| N/A for Phase 1 | Phase 1 is pure scaffolding — no hand-rolling risk | — | — |

**Key insight:** Phase 1 has no business logic — it's all configuration and structure. The hand-rolling risks come in Phase 2.

## Common Pitfalls

### Pitfall 1: Missing `"type": "module"`
**What goes wrong:** `.js` files default to CommonJS without this field, causing `import` statements to fail with syntax errors.
**Why it happens:** Forgetting the field or assuming ESM is the default.
**How to avoid:** Always include `"type": "module"` in package.json.
**Warning signs:** `SyntaxError: Cannot use import statement outside a module`

### Pitfall 2: Engine Floor Not Enforced
**What goes wrong:** `engines` field is advisory by default — npm won't block installs on older Node.js.
**Why it happens:** Missing `engine-strict=true` in `.npmrc` or relying solely on package.json.
**How to avoid:** Include `"engines": { "node": ">=22.0.0" }` in package.json. For strict enforcement, add `.npmrc` with `engine-strict=true` (optional for this project).
**Warning signs:** Users on Node.js <22 get cryptic runtime errors instead of clear install-time warnings.

### Pitfall 3: `process.exit()` Without Flushing stdout
**What goes wrong:** `process.stdout.write()` is async on some platforms. Calling `process.exit()` immediately after can truncate output.
**Why it happens:** `process.exit()` terminates before the write buffer flushes.
**How to avoid:** For the Phase 1 stub, the write is small enough that this is unlikely. In Phase 2, use `process.exitCode = 1` instead of `process.exit(1)` where possible, or ensure writes complete before exiting.
**Warning signs:** Truncated output on piped commands.

### Pitfall 4: Trailing Newline Convention (P-402)
**What goes wrong:** Missing trailing newline causes shell prompt to appear on the same line as output.
**Why it happens:** Using `process.stdout.write()` without `\n` at the end.
**How to avoid:** Always end stdout output with `\n`.
**Warning signs:** `$ whootoc --inputUsage: ...` (no newline before prompt).

## Code Examples

### package.json Template
```json
{
  "name": "whootoc",
  "version": "0.1.0",
  "description": "Generate GitHub-compatible table of contents from markdown headings",
  "type": "module",
  "bin": {
    "whootoc": "src/cli.js"
  },
  "scripts": {
    "test": "node --test"
  },
  "engines": {
    "node": ">=22.0.0"
  },
  "license": "MIT"
}
```

### Minimal cli.js Stub
```javascript
#!/usr/bin/env node
// src/cli.js — whootoc CLI entry point (I/O layer only)

const args = process.argv.slice(2);

if (args.length === 0) {
  process.stdout.write('Usage: whootoc --input <file> [--from-stdin] [--max-depth N]\n');
  process.exit(0);
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| CommonJS (`require`) | ESM (`import`) | Node.js 12+ (stable 16+) | ESM is the standard for new projects |
| `.mjs` extension | `"type": "module"` in package.json | Node.js 13+ | Cleaner — no extension gymnastics |
| jest/mocha for testing | `node:test` built-in | Node.js 18+ (stable 20+) | Zero-dep testing |

## Open Questions

1. **`.gitkeep` vs empty directories**
   - What we know: Git doesn't track empty directories. `.gitkeep` is a convention.
   - What's unclear: Whether the project already uses `.gitkeep` convention.
   - Recommendation: Use `.gitkeep` in `src/lib/` and `test/` to preserve structure. Remove when files are added in Phase 2.

## Sources

### Primary (HIGH confidence)
- Node.js v22 documentation — ESM modules, `"type": "module"`, `node:test` runner
- npm documentation — `bin` field, `engines` field, package.json spec

### Secondary (MEDIUM confidence)
- None needed — Phase 1 uses only stable, well-documented Node.js features

### Tertiary (LOW confidence)
- None

## Infrastructure Dependencies

None — unit tests only, no external infrastructure needed

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - Node.js ESM and package.json are extremely well-documented
- Architecture: HIGH - Directory structure follows Node.js conventions
- Pitfalls: HIGH - All listed pitfalls are well-known and documented

**Research date:** 2026-04-27
**Valid until:** 2026-05-27 (stable domain, 30-day validity)
