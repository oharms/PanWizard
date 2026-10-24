# Ledger

A household budget ledger library: entries persisted to a JSON file, CSV import, categories, monthly reports, integer-cent storage and budgets. The roadmap is in `.planning/roadmap.md`. Zero dependencies; tests use `node --test`.

`data/sample-ledger.json` is a ledger file as the app writes it after phase 4 (amounts as decimals, no `version`). Phase 5 must open it.
