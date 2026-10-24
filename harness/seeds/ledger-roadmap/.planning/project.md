# Ledger

## What This Is

A small Node.js library for a household budget: a ledger of income and expense entries
persisted to a JSON file, CSV import, categories with payee rules, monthly reports, a
storage format change to integer cents, and monthly budgets with alerts. Used as the seed
for the PAN Harness H10 large-project pair.

## Core Value

Each phase builds on the ones before it. Phase 5 changes the storage format under every
earlier feature and must migrate files written by phases 1-4 (`data/sample-ledger.json` is
one); phase 6 must reuse the categories of phase 3 and the reports of phase 4.

## Constraints

- Zero dependencies. Tests use `node --test` only.
- Plain CommonJS. Every module lives in `src/`.
- The public API of an earlier phase does not change in a later one unless a requirement says so.
