---
name: pan:assumptions
group: Phase Management
description: Surface Claude's assumptions about a phase approach before planning
argument-hint: "[phase]"
allowed-tools:
  - Read
  - Bash
  - Grep
  - Glob
---

<objective>
Analyze a phase and present Claude's assumptions about technical approach, implementation order, scope boundaries, risk areas, and dependencies.

Purpose: Help users see what Claude thinks BEFORE planning begins - enabling course correction early when assumptions are wrong.
Output: Conversational output only (no file creation) - ends with "What do you think?" prompt
</objective>

<execution_context>
@~/.claude/pan-wizard-core/workflows/assumptions.md
</execution_context>

<context>
Phase number: $ARGUMENTS (required)

Project state and roadmap are loaded in-workflow using targeted reads.
</context>

<investigate_before_claiming>
Before surfacing any assumption, read the actual codebase first.
- Read existing source files related to the phase's domain
- Grep for relevant function names, imports, patterns
- Base assumptions on what the code actually shows, not speculation
Do not claim "the project uses X" without verifying it in the files.
</investigate_before_claiming>

<citation_requirement>
Every assumption MUST cite the evidence that supports it.

**Before presenting assumptions to the user, scan your draft for unsourced claims.** Any assumption without file:line evidence is speculation, not a grounded assumption.

**Format:** "Assumption: [claim] — Evidence: [file:line or grep result]"

**Grounding rules:**
- Technical approach assumptions require: file:line showing the current pattern/framework in use
- Dependency assumptions require: import/require evidence from the relevant module
- Scope boundary assumptions require: file paths showing what exists vs what doesn't
- Risk assumptions require: file:line showing the fragile pattern or grep showing the coupling

**Anti-pattern:**
```
BAD:  "Assumption: The project uses Express for routing"
      → Did you check? Maybe it uses Fastify, or has no server at all.
GOOD: "Assumption: The project uses Express for routing — Evidence: require('express')
       at src/server.ts:3, route definitions at src/routes/index.ts:12-45"
```
</citation_requirement>

<process>
1. Validate phase number argument (error if missing or invalid)
2. Check if phase exists in roadmap
3. Read relevant source files to ground assumptions in evidence
4. For each assumption, follow observe-think-conclude:
   - OBSERVE: What does the code show?
   - THINK: What does this imply for the phase approach?
   - CONCLUDE: State the assumption with file:line evidence
5. Follow assumptions.md workflow:
   - Analyze roadmap description
   - Surface assumptions about: technical approach, implementation order, scope, risks, dependencies
   - Present assumptions clearly with file:line references where applicable
   - Prompt "What do you think?"
5. Gather feedback and offer next steps
</process>

<success_criteria>

- Phase validated against roadmap
- Assumptions surfaced across five areas
- User prompted for feedback
- User knows next steps (discuss context, plan phase, or correct assumptions)
  </success_criteria>
