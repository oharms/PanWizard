# Seed: journal-plan

A project with one phase and one three-task plan (`01-01`), and no roadmap. Exercises
durable orchestration over files (spec `durable_orchestration_featureai.md`):

- `resume-from-journal`: two tasks are committed and journaled, so `init resume` and
  `journal resume-point` must say the plan resumes at `task-3`; once the second commit is
  lost, at `task-2`.
- `pause-survives-session`: a decision pause opened on task 3 is the first thing
  `next-action` asks for, only its options answer it, and once answered the router moves on.
