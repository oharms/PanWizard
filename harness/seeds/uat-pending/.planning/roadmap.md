# Roadmap: Greetings

## Overview

One phase, two plans, two functions. The seed for PAN's behavioural harness: the whole
project is complete when both functions exist with passing tests and the phase is verified.

## Phases

- [ ] **Phase 1: Greetings** - Implement `greet` and `farewell` with tests

## Phase Details

### Phase 1: Greetings
**Goal:** Ship the two library functions with passing `node --test` coverage.
**Depends on:** Nothing (first phase)
**Requirements:** REQ-01, REQ-02
**Success Criteria** (what must be TRUE):
  1. `require('./src/greet.js').greet('Ada')` returns `Hello, Ada!`
  2. `require('./src/farewell.js').farewell('Ada')` returns `Goodbye, Ada.`
  3. `npm test` passes with a test for each function
**Plans:** 2 plans

Plans:
- [ ] 01-01: Implement greet with its test
- [ ] 01-02: Implement farewell with its test, exported alongside greet
