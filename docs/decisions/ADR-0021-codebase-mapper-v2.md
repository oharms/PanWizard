---
require-code-mention: true
---

# ADR-0021: Codebase Mapper v2 — Advanced Codebase Import & Analysis

## Status
Proposed

## Context

`/pan:map-codebase` is the gateway command for brownfield projects — the first experience users have when importing an existing codebase into PAN. The current implementation (v1, ADR-0008) spawns 4 parallel agents that produce 7 template-driven documents using bash grep patterns. This approach has three critical limitations:

1. **No relationship awareness** — No module dependency graph, no circular dependency detection, no understanding of which modules depend on which. Users must manually trace imports across hundreds of files.

2. **No best-practices assessment** — No detection of which patterns the codebase follows (error handling, testing, naming, security). Users discover convention violations during execution, not during planning.

3. **Shallow analysis** — Hardcoded bash grep patterns (`grep -r "import.*stripe"`) are language-agnostic but fragile. They miss most real-world import patterns and provide no structural understanding.

Competitors like Aider (tree-sitter AST repo-maps) and DeepWiki (auto-generated wikis) set user expectations for deep codebase analysis. PAN must match this depth while maintaining its zero-dependency constraint.

Additionally, the user requests lowercase output filenames (stack.md not STACK.md) to align with PAN's existing `.planning/` lowercase convention.

## Decision

Redesign the codebase mapper with:

1. **New `codebase.cjs` core module** — Language-aware import/export parsing using regex patterns (not AST) for JS/TS (v0), Python, Go, Rust, Java, C# (v1). Builds in-memory dependency graphs, detects circular dependencies, finds entry points and orphan modules.

2. **6 focus areas** (was 4) — Add `relationships` (module dependency graph) and `practices` (best-practices detection) agents, producing `relationships.md` and `best-practices.md`.

3. **9 output documents** (was 7) — All with lowercase filenames.

4. **Pre-computed analysis** — Core module runs import analysis and language detection BEFORE agents spawn. Results passed to agents as structured data, avoiding expensive LLM re-scanning.

5. **3 new CLI commands** — `codebase analyze-imports`, `codebase detect-languages`, `codebase best-practices` for standalone use and debugging.

6. **Backward-compatible migration** — Consumers check lowercase first, fallback to UPPERCASE.

## Consequences

### Positive
- Dependency graphs give users immediate architectural understanding of brownfield codebases
- Best-practices assessment enables prioritized technical debt cleanup in roadmaps
- Pre-computed analysis means agents start with facts, not discovery — higher quality output
- Lowercase filenames align with PAN's existing convention
- Zero runtime dependencies maintained (regex-only analysis)
- Same command, richer output — zero learning curve

### Negative
- Regex-based parsing misses some complex patterns (re-exports, dynamic imports, computed requires)
- 6 agents instead of 4 increases token cost per mapping run
- Migration period where both UPPERCASE and lowercase filenames must be supported
- New `codebase.cjs` module adds maintenance surface

### Neutral
- Template structure remains the same (enhanced, not replaced)
- Agent architecture remains the same (parallel agents writing directly)
- Workflow pattern remains the same (orchestrator spawns agents, collects confirmations)

## Options Considered

1. **tree-sitter AST parsing** (Aider approach) — Most accurate, supports 30+ languages. Rejected: adds ~5MB WASM runtime dependency, violates zero-dep constraint.

2. **LLM-only analysis** (DeepWiki approach) — Let agents discover everything themselves. Rejected: expensive, slow, inconsistent results, agents re-scan the same files.

3. **Regex-based analysis with pre-computation** (chosen) — Core module does fast regex parsing, passes structured data to agents. Best balance of accuracy, speed, and zero dependencies.

4. **Embedding-based indexing** (Cursor/Continue.dev approach) — Semantic search with vector embeddings. Rejected: requires embedding model (runtime dep), accuracy issues documented in Continue.dev community.

## Links
- Supersedes: ADR-0008 (Mermaid/TOGAF enhancement — incorporated into v2)
- Spec: `docs/specs/codebase_mapper_v2_featureai.md`
- Related: `pan-wizard-core/bin/lib/codebase.cjs` (new module)
- Related: `agents/pan-document_code.md` (rewritten agent)
- Related: `pan-wizard-core/workflows/map-codebase.md` (updated workflow)
