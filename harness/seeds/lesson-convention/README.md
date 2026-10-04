# Lesson convention (harness seed)

A tiny library used by the PAN Harness to measure whether agent memory changes behaviour (memory optimisation O6).

Its test runner, `npm test` (`scripts/test.cjs`), runs only the test files `test/manifest.json` lists. Phase 1 wrote `tests/greet.test.js` but never listed it, so `npm test` never ran it, and verification found the gap. A gap-closure plan is ready. Phase 2 (farewell) is planned, and its plan says nothing about the manifest.
