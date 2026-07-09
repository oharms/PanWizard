---
title: "whooo — markdown frontmatter linter"
created: "2026-04-27T11:30:00Z"
created_by: oharms
runtime_preference: claude
budget: 60
priority: medium
---

# Idea: whooo — markdown frontmatter linter

A zero-dependency Node.js CLI that walks a directory of markdown files, extracts each file's YAML-style frontmatter, and validates it against a declarative schema. Reports problems with `file:line` precision in either human-readable or JSON output.

## Problem

PAN Wizard ships 100+ markdown files across `commands/pan/`, `agents/`, `pan-wizard-core/workflows/`, `pan-wizard-core/templates/`, and `docs/specs/` — most of them carry frontmatter that follows informal conventions. There's no enforcement: a typo'd field, a missing `description`, or an enum value outside the allowed set silently breaks runtime tooling that reads the frontmatter (e.g., the install script, the dispatcher, the agent registry). A linter that reports "agents/foo.md:3 — field `tools` must be an array, got string" would catch these at author time instead of at install time.

This is also a **structurally meaningful experiment** for the v3.7.0 self-improvement loop. Building it exercises:
- Multi-file design (parser, validator, reporter, CLI)
- File walking with exclusion globs
- Cross-platform path handling
- Real test suite (≥8 cases covering valid + every error class)
- Subprocess-tested CLI
- Eating our own dogfood — the resulting tool can lint PAN's own `.md` files

The findings from this build (decisions, gaps, errors, surprises) become real promotable patterns, in contrast to a trivial greeter that produces no insight.

## Success Criteria

- **SC-1:** `whooo lint --dir <path> --schema <path>` walks the dir, validates each `.md` file's frontmatter against the schema, prints `file:line — code — message` for each violation; exits 0 if clean, 1 if any errors.
- **SC-2:** `--format json` outputs newline-delimited JSON instead of human-readable. Each line is `{file, line, field, code, message, severity}`.
- **SC-3:** `whooo schema check <schema-path>` validates the schema itself is well-formed (catches user errors in the schema before they cause cascading lint failures).
- **SC-4:** Test suite of ≥8 cases covering: valid file, missing required field, wrong type (string vs array), enum violation, regex pattern mismatch, multiple files aggregate, exclude glob, file with no frontmatter (configurable: skip vs error), schema check passes/fails.
- **SC-5:** `npm test` exits 0; ≥8/8 tests pass.
- **SC-6:** **Dogfood:** running `whooo lint --dir <PAN's commands/pan/> --schema <pan-frontmatter.schema.yml>` produces a non-empty report against PAN's actual files (proves the linter sees real-world data correctly).
- **SC-7:** Zero runtime dependencies. `node --test` only (no Mocha, Jest, etc.).

## Scope

| In Scope | Out of Scope |
|----------|--------------|
| Recursive directory walk with `--exclude` globs | Watching mode (`--watch`) |
| YAML-ish frontmatter parser (subset: scalars, simple lists, simple maps) | Full YAML 1.2 spec (no anchors, no flow sequences, no multi-doc) |
| Schema features: `required`, `type` (string/number/boolean/enum/array), `pattern` (regex), `values` (enum), `default` | Cross-field constraints, conditional schemas, `$ref` |
| Human + JSON output formats | XML, TOML, csv, etc. output |
| `schema check` (validates schema files) | `schema generate` (infer schema from existing files) — defer if time |
| Cross-platform paths (Windows + Unix) | Symlink following |
| Error codes that callers can switch on | Localized error messages |

## Constraints

- **Tech stack:** Node.js >= 16, zero runtime deps. Pure built-in modules (`fs`, `path`, `node:test`, `node:assert/strict`, `node:child_process` for CLI tests).
- **Performance:** lint a 100-file directory in <1 second on commodity hardware
- **Output stability:** Error codes are part of the CLI contract (callers grep/parse them). Document them.
- **Cross-platform:** All path output uses forward slashes (PAN convention via `toPosix()`).
- **Behavior on parse errors:** If a file's frontmatter is malformed YAML, that's a lint error too (code: `frontmatter-malformed`), not a crash.

## Reference material

- PAN's `pan-wizard-core/bin/lib/frontmatter.cjs` — proven frontmatter parsing in CommonJS, no deps
- PAN's `commands/pan/*.md` — real-world frontmatter shapes to validate against
- PAN's `pan-wizard-core/bin/lib/utils.cjs` `toPosix()` — path normalization pattern

## Notes

- **Decision principle:** when ambiguity arises between "fully featured" and "shipping a working tool", choose shipping. The point is to surface findings about the *PAN loop*, not to write a perfect linter.
- **Eat-our-own-dogfood marker:** the build is "done" when we've successfully run the linter against PAN's `commands/pan/` and gotten a real report (clean OR errors). That validates SC-6 and proves the loop produces something useful.
- **Promote-worthy findings expected:** YAML parsing edge cases, file-walking error handling, regex pattern testing, fixture organization, and test-file-vs-CLI-process integration patterns.
