# Seed: uat-with-failure

The two-plan-phase project after execution: both plans have summaries, the code exists,
and `01-uat.md` records one failed truth — `farewell` returns an exclamation mark where
the roadmap says a full stop (the defect is real and in `src/farewell.js`). Exercises the
diagnosis path: `/pan-diagnose-issues 1` (native, Claude Code) reads the Gaps section,
spawns a debugger per gap and writes root causes under `.planning/debug/`. Reality check
R17 (RC20).
