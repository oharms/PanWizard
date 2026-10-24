# Requirements

## v1.0 Requirements

Amounts in the public API are numbers in currency units with at most two decimal places:
negative is an expense, positive is income. Dates are `YYYY-MM-DD` strings, months `YYYY-MM`.

### Ledger (phase 1)

- **LEDGER-01** — `src/ledger.js` exports `openLedger(file)`. `add({ date, amount, payee, memo, category })` returns the new entry `{ id, date, amount, payee, memo, category }`. `date` must be a real calendar date in `YYYY-MM-DD` form; `amount` a finite number with at most two decimal places (`0.29`, `19.99` and `-4.35` are valid, `1.005` is not); `payee` a non-empty string; `memo` defaults to `''`, `category` to `null`. Anything invalid throws.
- **LEDGER-02** — Every change is written to `file` at once, and a new `openLedger(file)` on the same file sees the same entries. A file that does not exist is an empty ledger. Until phase 5 the file is JSON of the form `{ "nextId": 3, "entries": [{ "id": 1, "date": "2026-01-05", "amount": -12.5, "payee": "Corner Shop", "memo": "", "category": null }] }`.
- **LEDGER-03** — Ids are integers starting at 1 and are never reused: not after `remove(id)`, and not after the ledger is reopened from its file (the file keeps `nextId`).
- **LEDGER-04** — `remove(id)` deletes an entry and throws for an unknown id. `list({ from, to })` returns the entries whose date is in the inclusive range (either bound may be omitted), ordered by date, then id.

### CSV import (phase 2)

- **IMPORT-01** — `src/import.js` exports `importCSV(ledger, text)`, which adds each data row through the ledger and returns `{ added, skipped, errors }`. The first line is a header naming the columns `date`, `payee`, `amount` and optionally `memo`, in any order and any letter case. Fields may be wrapped in double quotes; a quoted field may contain commas and doubled double quotes (`""` is one `"`). Lines may end in `\n` or `\r\n`; blank lines are ignored.
- **IMPORT-02** — An amount may carry a leading `-` and, inside a quoted field, thousands separators (`"1,234.56"` is `1234.56`). A row with an invalid date, an invalid amount (more than two decimals, not a number) or an empty payee is not added; it is reported in `errors` as `{ line, reason }`, where `line` is the 1-based line number in `text` (the header is line 1, blank lines count). The other rows are still added.
- **IMPORT-03** — A row whose date, amount and payee all equal those of an entry that was already in the ledger before this import is skipped and counted in `skipped`. Two equal rows in the same file are both added (two coffees on one day are two entries).

### Categories (phase 3)

- **CAT-01** — `src/categories.js` exports `categoryFor(rules, payee)`: the `category` of the first rule, in order, whose `payeeContains` occurs in `payee` ignoring letter case, else `null`. Rules are `{ payeeContains, category }`.
- **CAT-02** — `ledger.addRule({ payeeContains, category })` appends a rule (both non-empty strings, else it throws) and `ledger.rules()` returns the rules in order. Rules are stored in the ledger file under `rules`; a file written before phase 3 has no `rules` and loads with none.
- **CAT-03** — `add` (and so `importCSV`) gives an entry with no category the category `categoryFor(ledger.rules(), payee)`; an explicit `category` wins over the rules.
- **CAT-04** — `ledger.setCategory(id, category)` sets an entry's category (a string, or `null` to clear it), persists it and returns the entry; it throws for an unknown id. `ledger.applyRules()` gives every entry whose category is `null` the category from the rules, leaves entries that have one alone, and returns how many it changed.

### Monthly reports (phase 4)

- **REPORT-01** — `src/report.js` exports `monthly(entries, month)`: `{ month, income, expenses, net, byCategory }` over the entries dated in `month`. `income` is the sum of the positive amounts, `expenses` the sum of the negative amounts as a positive number, `net` is `income - expenses`. Every total is exact to the cent: amounts `0.1` and `0.2` give `0.3`, never `0.30000000000000004`.
- **REPORT-02** — `byCategory` maps each category that occurs in the month to the net sum of its amounts (spending is negative), exact to the cent; entries with no category are summed under the key `uncategorized`.
- **REPORT-03** — `trend(entries, fromMonth, toMonth)` returns `[{ month, net }]` for every month from `fromMonth` to `toMonth` inclusive, in order, across year boundaries; a month with no entries has `net` `0`.

### Integer cents (phase 5)

- **CENTS-01** — The ledger file becomes version 2: `{ "version": 2, "nextId": n, "entries": [{ "id", "date", "cents", "payee", "memo", "category" }], "rules": [...] }`, where `cents` is an integer number of cents and entries carry no `amount` field. Every write writes version 2. The public API is unchanged: entries still have `amount` in currency units.
- **CENTS-02** — `openLedger` on a file with no `version` (written by phases 1-4, like `data/sample-ledger.json`) migrates it: each amount becomes exactly its cents (`19.99` is `1999`, `-1.15` is `-115`, `0.29` is `29`); ids, `nextId`, memos, categories and rules are kept (a missing `rules` is `[]`, a missing `nextId` is the largest id plus 1). Before writing the version 2 file it copies the original file, byte for byte, to `<file>.v1.bak`.
- **CENTS-03** — `openLedger` on a file whose `version` is greater than 2 throws an error whose message contains `unsupported`, and leaves the file untouched.
- **CENTS-04** — `monthly` and `trend` in `src/report.js` and `importCSV` in `src/import.js` compute in integer cents, and every earlier requirement still holds, on new ledgers and on migrated ones: for example the `2026-03` report of `data/sample-ledger.json` is the same before and after the migration.

### Budgets (phase 6)

- **BUDGET-01** — `ledger.setBudget(category, amount)` sets the monthly budget of a category (a positive amount with at most two decimals, else it throws); `0` removes it. `ledger.budgets()` returns `{ category: amount }`. Budgets are stored in the version 2 file under `budgets`, in cents; a version 2 file without `budgets` has none.
- **BUDGET-02** — `src/budget.js` exports `budgetStatus(ledger, month)`: one `{ category, budget, spent, remaining, status }` per budgeted category, ordered by category name. `spent` is the negation of that category's `byCategory` net from `monthly` (phase 4) for the month, or `0` when it has none, so refunds reduce it; the category of an entry is the one stored on it (rules or `setCategory`), never recomputed. `remaining` is `budget - spent`. `status` is `ok` when `spent` is under 80% of the budget, `warning` from 80% up to and including 100%, `over` above 100%. All amounts exact to the cent.
- **BUDGET-03** — `alerts(ledger, month)` returns one string per budget whose status is `warning` or `over`, `over` ones first, then by category name, each `<category>: <spent> of <budget> (<pct>%)` with both amounts to two decimals and `pct` the percentage rounded down (`groceries: 412.50 of 400.00 (103%)`).

## Traceability

| Requirement | Phase | Plan | Status |
|---|---|---|---|
| LEDGER-01 | 1 | — | Pending |
| LEDGER-02 | 1 | — | Pending |
| LEDGER-03 | 1 | — | Pending |
| LEDGER-04 | 1 | — | Pending |
| IMPORT-01 | 2 | — | Pending |
| IMPORT-02 | 2 | — | Pending |
| IMPORT-03 | 2 | — | Pending |
| CAT-01 | 3 | — | Pending |
| CAT-02 | 3 | — | Pending |
| CAT-03 | 3 | — | Pending |
| CAT-04 | 3 | — | Pending |
| REPORT-01 | 4 | — | Pending |
| REPORT-02 | 4 | — | Pending |
| REPORT-03 | 4 | — | Pending |
| CENTS-01 | 5 | — | Pending |
| CENTS-02 | 5 | — | Pending |
| CENTS-03 | 5 | — | Pending |
| CENTS-04 | 5 | — | Pending |
| BUDGET-01 | 6 | — | Pending |
| BUDGET-02 | 6 | — | Pending |
| BUDGET-03 | 6 | — | Pending |
