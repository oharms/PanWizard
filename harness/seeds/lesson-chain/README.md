# Lesson chain (harness seed)

A tiny library used by the PAN Harness to measure agent memory (memory optimisation O6).

- **Phase 1 (greet)** shipped `greet(name)`, and its verification found a gap: `greet` accepts a name that is not a string. A gap-closure plan (`01-02`) is ready.
- **Phase 2 (farewell)** is planned. Its plan asks for `farewell(name)` and nothing about checking the argument.

The scenario runs the fix round, lets PAN record what it learned, then runs phase 2 and checks whether the lesson reached phase 2's executors and changed what they built. Tests run with `npm test` (`node --test`).
