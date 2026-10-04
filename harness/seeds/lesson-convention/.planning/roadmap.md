# Roadmap: Greetings library

## Phases

- [ ] **Phase 1: Greet** - `greet(name)` with a test that `npm test` runs
- [ ] **Phase 2: Farewell** - `farewell(name)` with a test that `npm test` runs

## Phase Details

### Phase 1: Greet
**Goal:** Ship `greet(name)` with a test that the project's `npm test` runs.
**Depends on:** Nothing (first phase)
**Requirements:** REQ-01
**Success Criteria** (what must be TRUE):
  1. `require('./src/greet.js').greet('Ada')` returns `Hello, Ada!`
  2. `npm test` runs a test of `greet`, and it passes
**Plans:** 2 plans

Plans:
- [x] 01-01: Implement greet with its test
- [ ] 01-02: Gap closure: npm test runs greet's test

### Phase 2: Farewell
**Goal:** Ship `farewell(name)` with a test that the project's `npm test` runs.
**Depends on:** Phase 1
**Requirements:** REQ-02
**Success Criteria** (what must be TRUE):
  1. `require('./src/farewell.js').farewell('Ada')` returns `Goodbye, Ada.`
  2. `npm test` runs a test of `farewell`, and it passes
**Plans:** 1 plan

Plans:
- [ ] 02-01: Implement farewell with its test
