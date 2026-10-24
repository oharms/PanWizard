# Roadmap: Ledger

## Overview

Six phases of one household budget ledger: a persistent ledger, CSV import, categories,
monthly reports, a storage format change to integer cents that migrates existing files, and
budgets built on the categories and reports.

## Phases

- [ ] **Phase 1: Ledger** - Entries persisted to a JSON file
- [ ] **Phase 2: CSV import** - Bank CSV files imported into the ledger
- [ ] **Phase 3: Categories** - Payee rules and manual categories
- [ ] **Phase 4: Monthly reports** - Income, expenses, net, by category, and a trend
- [ ] **Phase 5: Integer cents** - A versioned file in integer cents, migrating older files
- [ ] **Phase 6: Budgets** - Monthly budgets per category, with alerts

## Phase Details

### Phase 1: Ledger
**Goal:** Entries can be added, removed and listed, and survive a restart.
**Depends on:** Nothing (first phase)
**Requirements:** LEDGER-01, LEDGER-02, LEDGER-03, LEDGER-04
**Success Criteria** (what must be TRUE):
  1. An entry added in one process is listed by a ledger reopened on the same file
  2. Ids are never reused, after a remove or a reopen
  3. `npm test` passes with tests for every requirement
**Plans:** 0 plans

### Phase 2: CSV import
**Goal:** A bank's CSV export can be imported, with bad rows reported and re-imports not duplicated.
**Depends on:** Phase 1
**Requirements:** IMPORT-01, IMPORT-02, IMPORT-03
**Success Criteria** (what must be TRUE):
  1. Quoted fields with commas and doubled quotes import correctly
  2. Invalid rows are reported by line number and the rest are added
  3. Importing the same file twice adds nothing the second time
**Plans:** 0 plans

### Phase 3: Categories
**Goal:** Entries are categorised by payee rules or by hand.
**Depends on:** Phase 2
**Requirements:** CAT-01, CAT-02, CAT-03, CAT-04
**Success Criteria** (what must be TRUE):
  1. The first matching rule wins, ignoring letter case
  2. Imported entries are categorised by the rules
  3. A ledger file from phase 1 or 2 still opens
**Plans:** 0 plans

### Phase 4: Monthly reports
**Goal:** Monthly income, expenses, net and spending by category, and a net trend over months.
**Depends on:** Phase 3
**Requirements:** REPORT-01, REPORT-02, REPORT-03
**Success Criteria** (what must be TRUE):
  1. Totals are exact to the cent
  2. Uncategorised entries are reported under `uncategorized`
  3. The trend covers empty months and year boundaries
**Plans:** 0 plans

### Phase 5: Integer cents
**Goal:** The ledger stores integer cents in a versioned file, and every existing ledger file keeps working.
**Depends on:** Phase 4
**Requirements:** CENTS-01, CENTS-02, CENTS-03, CENTS-04
**Success Criteria** (what must be TRUE):
  1. `data/sample-ledger.json` opens with every amount exact and its reports unchanged
  2. Import, categories and reports work on new and on migrated ledgers
  3. A file from a newer version is refused, not overwritten
**Plans:** 0 plans

### Phase 6: Budgets
**Goal:** Monthly budgets per category, with status and alerts computed from the phase 4 reports.
**Depends on:** Phase 5
**Requirements:** BUDGET-01, BUDGET-02, BUDGET-03
**Success Criteria** (what must be TRUE):
  1. A budget's spending equals the category's spending in the monthly report
  2. Exactly 80% is a warning and exactly 100% is not over
  3. Budgets work on a migrated ledger
**Plans:** 0 plans
