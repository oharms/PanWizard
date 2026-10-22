# Roadmap: Tasks

## Overview

Two phases: a persistent task store, then reports built on it.

## Phases

- [ ] **Phase 1: Store** - A task store persisted to a JSON file
- [ ] **Phase 2: Reports** - Overdue, by-priority and CSV reports over the stored tasks

## Phase Details

### Phase 1: Store
**Goal:** Tasks can be added, completed, removed and listed, and survive a restart.
**Depends on:** Nothing (first phase)
**Requirements:** STORE-01, STORE-02, STORE-03, STORE-04
**Success Criteria** (what must be TRUE):
  1. A task added in one process is listed by a store reopened on the same file
  2. Ids are never reused, after a remove or a reopen
  3. `npm test` passes with tests for every requirement
**Plans:** 0 plans

### Phase 2: Reports
**Goal:** Reports over the tasks the store keeps.
**Depends on:** Phase 1
**Requirements:** REPORT-01, REPORT-02, REPORT-03
**Success Criteria** (what must be TRUE):
  1. A task due today is not overdue
  2. Tasks with no due date come last within their priority
  3. CSV fields with commas, quotes or line breaks round-trip through a CSV parser
**Plans:** 0 plans
