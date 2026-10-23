---
name: evolve-prompt
description: Guarded prompt evolution (program S4) — evolve one section of one PAN judge prompt against training scenarios, accept it only on held-out data, with a deletion arm always run. Development only; paid.
argument-hint: "<agents/pan-x.md#Section> [--repeat N] [--heldout-repeat N] [--approve-usd N] [--smoke]"
---

# /evolve-prompt — guarded prompt evolution

Evolve one section of one judge prompt (the verifier, reviewer or plan-checker) and keep the change only if it holds on scenarios it was never shown. $ARGUMENTS

## Rules that make it safe

- **The evaluator is out of reach.** The evolver writes only under `harness/variants/` (`guardedWrite` in `harness/src/evolve.cjs`). It never edits the scorer (`harness/src/`), the corpus, the scenarios, the cassettes or the split (`harness/evolve/split.json`). A generation aborts if any of them changes while it runs. Do not edit them yourself during a run either. The split changes only by hand, in a reviewed commit, between runs.
- **Held-out stays held out.** Reflection sees only the training scenarios' failing steps. The held-out scenarios decide acceptance and nothing else.
- **A deletion arm always runs.** If removing the section scores the same as keeping it, the section is decorative: say so, and propose deleting it instead of evolving it.
- **The owner approves the spend.** Reflection and scoring run a real model. Nothing runs without `--approve-usd` given by the owner for this run, and the caps of every spend add up to no more than that.

## Steps

1. **Plan.** Print the plan and the cost estimate, and show them to the owner:

   ```bash
   node harness/src/evolve.cjs --target <agents/pan-x.md>#<Section> [--repeat N] [--heldout-repeat N]
   ```

   It refuses a section the agent does not have (and lists the headings it has), and a judge no training or no held-out scenario spawns (`exercises` in the split; the design-checker has none at tier 2). It prints the scenarios that will run (only those that spawn the target), the arms, the acceptance rule (non-inferior on held-out data at δ 0.05, no worse on training), `estimate.expected` and `estimate.ceiling` in dollars, and `estimate.deciding`: the held-out reps and dollars at which acceptance becomes possible at all. Fewer held-out reps than that is a **smoke run**: it proves the pipeline and measures cost, and it cannot accept a candidate. Say which one this is, and ask for the dollar cap.

2. **Run one generation.** With the owner's cap (at least `estimate.expected`):

   ```bash
   node harness/src/evolve.cjs --target <file>#<Section> --run --approve-usd <N> [--repeat N] [--heldout-repeat N] [--smoke]
   ```

   It runs, in order: the baseline arm on training (`run.cjs --tier 2`, whose failing steps are the reflection's only input) → one `claude -p` reflection, capped at $1 → the candidate and deletion arms on training → all three arms on held-out. Each arm is a whole agent file in installed form under `harness/variants/.evolve-<id>/`, applied with `run.cjs --variant .claude/agents/<agent>.md=<file>`; each `run.cjs` call has its own `--max-usd`, and those caps plus the reflection's add up to no more than `--approve-usd`. `--smoke` is required when the held-out reps cannot reach a decision. The arm files and run state are deleted afterwards.

3. **Report.** Show the result: rates per arm on training and held-out, the held-out interval, `section_matters` (the deletion arm), accepted or the reason, `spent_usd` against `approved_usd`, and the per-run caps. A rep stopped by its budget is no verdict, and a generation with any such rep is not accepted.

4. **Keep or drop.** An accepted section stays as `harness/variants/<agent>.<section>.g<N>.md`. It is a proposal: show the diff of the section and the numbers. The owner decides whether to copy it into the agent and open a PR. Further generations are separate runs, each with its own approval (`--generation N`); rank accepted variants with `paretoFront` (pass rate, cost, turns).
