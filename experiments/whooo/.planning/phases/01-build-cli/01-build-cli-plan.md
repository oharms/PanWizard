---
phase: 1
slug: build-cli
wave: 1
must_haves:
  truths:
    - whooo lint walks a dir and validates each .md frontmatter against the schema
    - whooo lint emits human OR json output based on --format
    - whooo schema check validates a schema file
    - All 8+ test cases pass
    - Running whooo against PAN's commands/pan/ produces a non-empty real-world report
  artifacts:
    - bin/whooo.js
    - lib/frontmatter.js
    - lib/schema.js
    - lib/validate.js
    - lib/walk.js
    - lib/reporter.js
    - test/frontmatter.test.js
    - test/validate.test.js
    - test/cli.test.js
    - test/fixtures/basic.schema.yml
    - package.json
  key_links:
    - bin/whooo.js → lib/walk.js (calls walkMarkdownFiles)
    - bin/whooo.js → lib/frontmatter.js (calls parseFrontmatter)
    - bin/whooo.js → lib/schema.js (calls parseSchema)
    - bin/whooo.js → lib/validate.js (calls validateAgainstSchema)
    - bin/whooo.js → lib/reporter.js (calls formatViolations)
---

# Phase 1 Plan: build-cli

## Wave 1: Core library (sequential, single agent)

### Task 1.1: Frontmatter parser
- Create `lib/frontmatter.js` exporting `parseFrontmatter(text)` returning `{data, bodyStart, errors}`
- Handle: missing frontmatter, malformed frontmatter, valid frontmatter with scalars/lists/maps
- Per DESIGN_SPEC §YAML subset

### Task 1.2: Schema parser
- Create `lib/schema.js` exporting `parseSchema(text)` and `checkSchema(parsed)` returning normalized schema or errors
- Handle: missing `fields:`, unknown type, invalid regex pattern, conflicting required+default

### Task 1.3: Validator
- Create `lib/validate.js` exporting `validateAgainstSchema(data, schema, sourceFile)` returning array of violations
- Implement all 8 error codes from DESIGN_SPEC §Error codes

### Task 1.4: File walker
- Create `lib/walk.js` exporting `walkMarkdownFiles(dir, {exclude})` async iterator yielding {path, content}
- Cross-platform: emit POSIX paths via internal toPosix helper
- Exclude glob: simple match (e.g., `**/node_modules/**`, `*.draft.md`)

### Task 1.5: Reporter
- Create `lib/reporter.js` exporting `formatHuman(violations)` and `formatJson(violations)`
- Human format: `<file>:<line> — <code> — <message>`
- JSON format: NDJSON (one violation per line)

## Wave 2: CLI dispatcher (depends on Wave 1)

### Task 2.1: bin/whooo.js
- argv parser (no deps; just inspect process.argv)
- Subcommands: `lint`, `schema check`, `--help`, `--version`
- Wire to lib/ modules
- Exit code semantics per DESIGN_SPEC

## Wave 3: Tests (depends on Wave 2 — fixtures need real CLI to test against)

### Task 3.1-3.5: One test file per lib/ module
- frontmatter.test.js (4+ cases)
- schema.test.js (3+ cases)
- validate.test.js (5+ cases for the 8 error codes — combine where natural)
- walk.test.js (2+ cases)
- cli.test.js (3+ cases via execFileSync)

### Task 3.6: Fixtures
- 7 fixture .md files under test/fixtures/
- 1 fixture schema basic.schema.yml
- 1 fixture pan-cmd.schema.yml (rough mirror of PAN's command frontmatter shape)

## Wave 4: Dogfood gate (depends on Waves 1-3)

### Task 4.1: Self-apply
- Create `test/fixtures/pan-cmd.schema.yml` describing PAN's `commands/pan/*.md` frontmatter (name, group, description, allowed-tools)
- Run `node bin/whooo.js lint --dir <PAN-source>/commands/pan --schema test/fixtures/pan-cmd.schema.yml`
- Capture output (don't fail if errors found — finding errors IS the dogfood)
- Document the report in summary.md

## Verification (before phase complete)

- All 10 requirements satisfied per requirements.md
- `npm test` passes
- Dogfood gate produced a real report
- DESIGN_SPEC.md error code contract honored in implementation
