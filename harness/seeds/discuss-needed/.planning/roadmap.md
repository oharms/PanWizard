# Roadmap: Greeting CLI

## Overview

One phase: a `greet` command. Its style, letter case and missing-name behaviour are open
questions, settled in this phase's context.md before planning.

## Phases

- [ ] **Phase 1: Greeting CLI** - A `greet <name>` command

## Phase Details

### Phase 1: Greeting CLI
**Goal:** Ship a `greet <name>` command whose output the user has decided.
**Depends on:** Nothing (first phase)
**Requirements:** REQ-01, REQ-02
**Success Criteria** (what must be TRUE):
  1. `greet Ada` prints a greeting in the chosen style and letter case
  2. `greet` with no name exits with the chosen code
**Plans:** TBD

**Notes:** Open questions (greeting style, letter case, exit code on a missing name) are settled in context.md before planning.
