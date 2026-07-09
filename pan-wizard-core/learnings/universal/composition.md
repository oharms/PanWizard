---
topic: composition
last_updated: 2026-04-27T10:28:48.497Z
patterns:
  - id: P-602
    summary: Design experiment-built CLIs to compose via stdin/stdout pipes (Unix philosophy)
    promoted_at: 2026-04-27T10:22:49.212Z
    source_experiments: [whoograph]
  - id: P-802
    summary: Cross-tool composition emerges naturally when each tool independently applies P-401 (sync stdin), P-402 (trailing newline), and structured stdout
    promoted_at: 2026-04-27T10:28:48.497Z
    source_experiments: [whoorun]
---

# Composition (AI-derived)

> Auto-maintained by `pan-tools learn promote`. Each pattern was extracted from one or more experiment runs (see source_experiments). Patterns are **advisory** — orchestrators should weight them against current context.

## P-602 — Design experiment-built CLIs to compose via stdin/stdout pipes (Unix philosophy)

**Evidence:** whoograph sess_20260427T133500 13:42Z surprise (critical): piped 'whoolen --format json | jq | whoograph' produced a real chart of PAN's 10 wordiest commands. Cross-tool composition emerged from independent application of P-401 (sync stdin) + P-402 (trailing newline) + structured stdout formats. No coordination required between tools.

**Rule:** When building CLI tools as part of a self-improvement experiment series, design each tool's I/O for stdin/stdout pipe composition: read structured input from stdin, emit structured output to stdout, use stable line shapes that downstream tools can parse. Cross-tool emergent value (whoolen | whoograph) is greater than the sum of parts, even when neither tool was designed for the other. Patterns P-401 + P-402 + JSON-on-stdout get you composition by default.

**Applies in:** plan-phase (CLI design), exec-phase (I/O contract decisions)

## P-802 — Cross-tool composition emerges naturally when each tool independently applies P-401 (sync stdin), P-402 (trailing newline), and structured stdout

**Evidence:** whoorun 14:13Z surprise (critical): composition.taskfile.md ran whoosort + whoolen as subprocesses, total 128ms, both succeeded. Combined with prior whoolen|whoograph pipe, all 5 whoo* experiments now compose as a real toolchain. None of the 5 was designed for composition with the others — it emerged from each independently applying the same I/O patterns.

**Rule:** Cross-tool composition is a CONSEQUENCE of consistent patterns, not a design goal. If every experiment-built CLI applies P-401 (sync stdin via fs.readFileSync(0)), P-402 (trailing newline), JSON-on-stdout when --format json, structured (parseable) human output otherwise, AND consistent exit codes (0 ok, 1 logical fail, 2 fatal), then they pipe together by default. Promote P-401+P-402+exit-code-discipline as a bundle: applying any one in isolation has marginal value; applying all three is what produces the emergent composition.

**Applies in:** plan-phase (CLI design), exec-phase (I/O contract decisions), retrospectives
