# Debugger: a failing command before any hypothesis

| | |
|---|---|
| Verdict | ENHANCE |
| Priority | P2 (this release cycle) |
| Size | S 2 points |
| Area | agents |
| Runtimes | all five (agent prompt only) |
| First seen | `2026-10-10` — [digest](../digests/2026-10-10.md) |
| Ledger | MI-105 |
| Status | FILED MI-105 |

## Source trail
- `2026-10-10` — Matt Pocock's `diagnosing-bugs` skill puts a hard gate first. The agent may not theorise until it has run one command that goes red on the user's exact symptom. That command must give the same verdict every run, finish in seconds, and run without a human. It is then shrunk until every remaining part is needed for the failure. Only after that does the agent list 3–5 ranked hypotheses. (source: `github.com/mattpocock/skills`, `skills/engineering/diagnosing-bugs/SKILL.md` at `49dd158`, `2026-10-09`, MIT)

## Why it matters for PAN
`pan-debugger` is spawned by `/pan:debug`, by exec-phase's UAT diagnosis and by the native `pan-diagnose-issues` script. Its job is a root cause the executor can act on.

A diagnosis built on a hypothesis that was never tested against a red command is the failure the skill names: the agent reads code, builds a story and "fixes" a neighbouring bug. PAN's verification pillar asks for evidence over assertion. A reproduction command the debugger has run is that evidence. It also hands the fix its regression test.

## Current state (evidence)
- **The hypothesis half is there.** Three or more independent hypotheses with priors, the top two investigated in parallel, and the tree recorded in the debug file (`agents/pan-debugger.md:131-139`). Generating several hypotheses before investigating is the anti-anchoring rule (`:76`). SOURCE.
- **Reproduction is only an end-of-session check.** "Reproduce reliably?" sits among the criteria for calling the root cause found (`:175`), not as a step before theorising. No rule says the session file must record the command that reproduces the symptom. Nothing asks for the repro to be minimised. SOURCE.

## Proposal
Add a first step to the debugger's investigation, before the hypothesis tree:
- **Build a reproduction command and run it.** The agent writes one command (a test, a CLI call with a fixture, a script) that fails on the symptom the user reported, and runs it. Command and output are recorded under a new `Reproduction` section of the debug session file, with secrets redacted.
- **It must catch this bug.** The command must assert the reported symptom, not merely "runs without error". It must give the same verdict across runs; for a flaky bug, record the reproduction rate instead.
- **Shrink it.** Cut inputs and steps one at a time while it stays red.
- **When no command can be built,** say so and list what was tried. In `find_root_cause_only` mode return a checkpoint asking for the missing access or artifact, rather than theorising.
- **The command becomes the fix's check.** In `find_and_fix` mode the fix is done only when the same command goes green. In diagnose mode the root-cause report names it, so the gap-closure plan can turn it into its test.

## Implementation sketch
| Layer | Change |
|---|---|
| Core module | none |
| Dispatcher | none |
| Installer / per-runtime | none |
| Commands / agents / workflows | `agents/pan-debugger.md`: the new first step and its completion criterion; the `Reproduction` section in its File Structure. `pan-wizard-core/templates/debug.md`: the same section. `pan-wizard-core/workflows/diagnose-issues.md` and `commands/pan/debug.md`: say the returned diagnosis names the reproduction command. |
| Hooks / MCP | none |
| Tests | a prompt-shape test that the debugger's investigation step names the reproduction gate before the hypothesis tree, and that the template and the agent's File Structure carry the same section (the existing debug template/agent agreement tests are the pattern) |
| Harness | optional tier-1 scenario: a seeded bug, `/pan:debug`, assert the session file records a command that fails on the seed and passes after the fix |
| Docs | `docs/AGENTS.md` pan-debugger section |

## Gate
The prompt-shape test, shown failing before the change. If the owner wants a behavioural check, the optional harness scenario: the debug file records a command that is red on the seeded bug.

## Effort & risk
- Small and prompt-only.
- A strict gate can stall on bugs that only reproduce in an environment the agent cannot reach. The checkpoint return keeps that honest instead of guessing.
- Session-file readers that parse sections must tolerate the new one: check the `debug.md` parsers before adding it.

## Open questions for the owner
- Hard gate (no hypotheses without a red command) or strong default (allowed with a recorded reason)?
