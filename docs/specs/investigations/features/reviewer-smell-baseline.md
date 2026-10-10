# Reviewer: a fixed code-smell baseline, each reported as a judgement call

| | |
|---|---|
| Verdict | ENHANCE |
| Priority | P3 (backlog) |
| Size | S 2 points |
| Area | agents |
| Runtimes | all five (agent prompt only) |
| First seen | `2026-10-10` — [digest](../digests/2026-10-10.md) |
| Ledger | MI-106 |
| Status | FILED MI-106 |

## Source trail
- `2026-10-10` — Matt Pocock's `code-review` skill always adds a fixed baseline of twelve smells from Fowler's *Refactoring* to whatever standards the repository documents. The smells are Mysterious Name, Duplicated Code, Feature Envy, Data Clumps, Primitive Obsession, Repeated Switches, Shotgun Surgery, Divergent Change, Speculative Generality, Message Chains, Middle Man and Refused Bequest. Two rules bind the baseline. A documented repository standard always overrides it. And each smell is reported as a labelled heuristic ("possible Feature Envy"), never a hard violation, and is skipped where tooling already enforces it. (source: `github.com/mattpocock/skills`, `skills/engineering/code-review/SKILL.md` at `49dd158`, `2026-10-09`, MIT)

## Why it matters for PAN
`pan-reviewer` reviews every phase's diff after execution. In a project that documents no standards, its quality checks reduce to a few size thresholds. The baseline gives it a stable, named vocabulary for design problems that thresholds miss.

Several smells map onto failures PAN already guards against elsewhere:
- **Speculative Generality** is the code-level form of the unrequested-work class (MI-031 lineage, `verify scope`).
- **Shotgun Surgery** and **Divergent Change** are visible in a phase's diff and nowhere else.

Reporting them as judgement calls keeps them below the verdict-changing tiers, so the meta-reviewer and the dispositions ledger handle them like any INFO finding.

## Current state (evidence)
- **The quality table is size-only.** It holds function length, nesting depth, dead imports, duplicate code (">10 identical lines across files", INFO) and new TODOs (`agents/pan-reviewer.md:63-70`). SOURCE.
- **Conventions are discovered, never assumed.** The reviewer reads project instructions, `.agents/skills/` and existing code patterns, and is told not to assume any (`:39-44`). The baseline must keep that priority: the repository wins. SOURCE.
- **The Spec axis is already separate.** The reviewer's Scope section covers unrequested work (`:72`), and `pan-verifier` checks the result against the phase goal. That is the skill's two-axis split, already in PAN's structure. SOURCE.

## Proposal
- **Add a "Design smells (baseline)" table** to the reviewer: the twelve smells, each with one line on what it is and one on the usual fix.
- **Rules:**
  - Always INFO and phrased "possible <smell>".
  - Suppressed where a documented project standard endorses the pattern.
  - Only for code the phase changed.
  - Never a cause for a non-PASS verdict on its own.
- **Speculative Generality defers to Scope.** It points at the Scope section, so the same code is not reported twice: unrequested behaviour stays `Unrequested`, and an unused abstraction is the smell.

## Implementation sketch
| Layer | Change |
|---|---|
| Core module / dispatcher / installer | none |
| Commands / agents / workflows | `agents/pan-reviewer.md`: the table and its rules. `agents/pan-meta-reviewer.md`: one line saying baseline smells are judgement calls to downgrade or dismiss, never to escalate. |
| Hooks / MCP | none |
| Tests | a prompt-shape test that the reviewer carries the baseline as INFO with the "repository standard wins" rule, shown failing before the change |
| Docs | `docs/AGENTS.md` pan-reviewer section |

## Gate
The prompt-shape test. A behavioural check is not worth paid runs for an INFO-only change.

## Effort & risk
- More INFO findings mean more noise in review reports. The meta-reviewer dedupes, and dispositions record dismissals.
- The real risk is a smell creeping up to WARNING. The test pins INFO.

## Open questions for the owner
- All twelve, or only the ones visible in a diff?
