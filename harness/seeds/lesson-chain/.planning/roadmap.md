# Roadmap: Greetings library

## Overview

Two phases, one function each.

## Phases

- [ ] **Phase 1: Greet** - `greet(name)` with tests
- [ ] **Phase 2: Farewell** - `farewell(name)` with tests

## Phase Details

### Phase 1: Greet
**Goal:** Ship `greet(name)` with passing `node --test` coverage.
**Depends on:** Nothing (first phase)
**Requirements:** REQ-01, REQ-02
**Success Criteria** (what must be TRUE):
  1. `require('./src/greet.js').greet('Ada')` returns `Hello, Ada!`
  2. `greet` throws a `TypeError` when `name` is not a non-empty string
  3. `npm test` passes
**Plans:** 2 plans

Plans:
- [x] 01-01: Implement greet with its test
- [ ] 01-02: Gap closure: greet rejects a name that is not a non-empty string

### Phase 2: Farewell
**Goal:** Ship `farewell(name)` with passing `node --test` coverage.
**Depends on:** Phase 1
**Requirements:** REQ-03
**Success Criteria** (what must be TRUE):
  1. `require('./src/farewell.js').farewell('Ada')` returns `Goodbye, Ada.`
  2. `npm test` passes
**Plans:** 1 plan

Plans:
- [ ] 02-01: Implement farewell with its test
