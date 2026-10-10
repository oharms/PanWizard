# Seed: phase-needs-plan

The two-plan-phase project with phase 1 **unplanned**: roadmap, requirements, project and
state exist, `.planning/phases/01-greetings/` is empty. Exercises `/pan:plan-phase 1` —
research (if the workflow decides it is needed), planner, plan-checker revision loop —
and asserts plan files appear. Reality check R17 (RC20).

The roadmap and requirements are those of a long project: twenty-four more phases follow phase 1, each with a full detail section and two requirements (~23 KB of roadmap, ~9 KB of requirements). Phase 1's roadmap slice is about a tenth of the two files, so an agent that reads either whole instead of the slice costs what it would on a real project, and `context-reads.cjs` catches it (memory optimisation O2). Phase 1 depends on nothing after it.
