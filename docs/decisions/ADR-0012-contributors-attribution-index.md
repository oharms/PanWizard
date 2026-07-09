# ADR-0012: Contributors List & Attribution Index

## Status
Accepted

## Context
PAN Wizard is a public open-source project on npm and GitHub with 37 commands, 11 agents, 15 core modules, 11 ADRs, and 11 feature specs. The project references 6 strategic methodologies (Blue Ocean, Wardley, STRIDE, TOGAF, Spec-Driven Dev, ADRs), 12 industry standards (OWASP, NIST, ISO, WCAG, etc.), 8 competing tools (Aider, Cursor, Cline, etc.), and multiple research findings — but has no centralized attribution.

The LICENSE and package.json say "PAN Wizard Contributors" without naming anyone. Git history shows a single human author (oharms), an AI co-author (Claude Opus 4.6), and a bot (dependabot). No CONTRIBUTORS.md or AUTHORS file exists.

Open-source norms expect transparent attribution. New contributors cannot easily discover who built the project or where design ideas originated.

## Decision
Create two new documentation files:

1. **CONTRIBUTORS.md** — Names every contributor (human, AI, bot) with role and contribution type
2. **ATTRIBUTION.md** — Indexes every methodology, standard, tool, and research source that influenced the project, cross-referenced to the specific ADR/spec/file where each is used

Additionally update package.json with a contributors array and link both files from README.md.

## Consequences

### Positive
- Transparent attribution for all contributors including AI co-authors
- Centralized influence index eliminates tribal knowledge
- New contributors can understand design lineage without reading 11 ADRs
- Follows open-source community norms

### Negative
- Two more files to maintain manually (low burden for a small contributor base)

### Neutral
- No code changes, no runtime impact, no test impact

## Options Considered
1. **Single CREDITS.md** — Mixes people and ideas in one file. Rejected: different audiences.
2. **CONTRIBUTORS.md + ATTRIBUTION.md (chosen)** — Clean separation of people vs. ideas.
3. **Auto-generated from git + CI** — Over-engineering for 1 human contributor. Deferred to v2.

## Links
- Related spec: `docs/specs/contributors_attribution_index_featureai.md`
- Related files: CONTRIBUTORS.md, ATTRIBUTION.md, package.json, README.md
