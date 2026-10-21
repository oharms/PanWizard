---
name: evolve-prompt
description: Guarded prompt evolution (program S4) — evolve one section of one PAN judge prompt against training scenarios, accept it only on held-out data, with a deletion arm always run. Development only; paid.
argument-hint: "<agents/pan-x.md#Section> [--generations N] [--approve-usd N]"
---

# /evolve-prompt — guarded prompt evolution

Evolve one section of one judge prompt (the verifier, reviewer, plan-checker or design-checker) and keep the change only if it holds on scenarios it was never shown. $ARGUMENTS

## Rules that make it safe

- **The evaluator is out of reach.** The evolver writes only under `harness/variants/` (`guardedWrite` in `harness/src/evolve.cjs`). It never edits the scorer (`harness/src/`), the corpus, the scenarios, the cassettes or the split (`harness/evolve/split.json`). A generation aborts if any of them changes while it runs. Do not edit them yourself during a run either.
- **Held-out stays held out.** Reflection sees only the training scenarios' failing transcripts. The held-out scenarios decide acceptance and nothing else.
- **A deletion arm always runs.** If removing the section scores the same as keeping it, the section is decorative: say so, and propose deleting it instead of evolving it.
- **The owner approves the spend.** Reflection and scoring run a real model. Nothing runs without `--approve-usd` given by the owner for this run.

## Steps

1. **Plan.** Print the plan and show it to the owner:

   ```bash
   node harness/src/evolve.cjs --target <file>#<Section>
   ```

   It names the arms (baseline, candidate, deletion), the split, the acceptance rule (non-inferior on held-out data at δ 0.05, no worse on training) and that only `harness/variants/` is written. Ask for the dollar cap.

2. **Baseline transcripts.** Run the training scenarios once at tier 1 with the approved cap (`node harness/src/run.cjs --tier 1 --max-usd <part of the cap> --scenario <each training id> --repeat 3`) and collect the failing steps from `report.json`.

3. **Reflect.** Write one candidate section from those failures only: what the judge missed, and the smallest change to the section that would have caught it. Save it with `guardedWrite` as `harness/variants/<agent>.<section>.g<N>.md`.

4. **Score.** Run each arm on training, then on held-out, paired, with `--variant <installed agent path>=<variant file>` for the candidate, the section removed for the deletion arm, and nothing for the baseline. Feed the counts to `runGeneration` (or read them off the reports) and report its result: rates per arm, the held-out interval, `section_matters`, accepted or the reason.

5. **Keep or drop.** An accepted variant is a proposal: show the diff of the section and the numbers. The owner decides whether to copy it into the agent and open a PR. Repeat up to `--generations`, ranking accepted variants with `paretoFront` (pass rate, cost, turns).
