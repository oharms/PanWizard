# Phase 1: Project Setup - Context

**Gathered:** 2026-04-27
**Status:** Ready for planning

<domain>
## Phase Boundary

Scaffold a runnable package skeleton with correct Node.js v22+ engine floor, ESM module format, zero runtime dependencies, and a `whootoc` bin entry. No implementation logic — just the project structure that Phase 2 builds on.

</domain>

<decisions>
## Implementation Decisions

### Module format
- ESM (`"type": "module"`) — research confirmed this is the 2025/2026 standard for new Node.js projects
- Node.js v22+ engine floor (Active LTS through April 2027)
- Shebang line in bin entry: `#!/usr/bin/env node`

### Directory structure
- `src/cli.js` — bin entry point (I/O layer only)
- `src/lib/` — pure function modules (parser, slugger, renderer) — created empty, populated in Phase 2
- `test/` — test directory for `node:test` suite

### Package configuration
- `bin.whootoc` points to `src/cli.js`
- `engines.node` set to `>=22.0.0`
- Zero `dependencies` — only `devDependencies` if any
- `scripts.test` set to `node --test`
- `process.stdout.write` convention (PAN P-402) — CLI entry should stub a minimal "no args" message on startup

### Claude's Discretion
- Exact package.json metadata (description, license, author)
- Whether to include a `.gitignore` or `.editorconfig`
- Exact startup message when run with no arguments

</decisions>

<specifics>
## Specific Ideas

- The bin entry should not crash on startup — it should print a usage hint if no arguments are provided
- Follow PAN conventions: P-401 (sync stdin), P-402 (trailing newline), P-403 (data-driven dispatcher if needed)
- Research recommended isolating the slug algorithm in its own module (`src/lib/slugify.js`) for independent unit testing

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 01-project-setup*
*Context gathered: 2026-04-27*
