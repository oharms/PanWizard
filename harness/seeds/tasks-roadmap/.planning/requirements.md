# Requirements

## v1.0 Requirements

### Store (phase 1)

- **STORE-01** — `src/store.js` exports `createStore(file)`. `add(title, { priority, due })` returns the new task `{ id, title, priority, due, done }`; `priority` is `low`, `medium` (the default) or `high`, anything else throws; `due` is a `YYYY-MM-DD` string or `null` (the default); `done` starts `false`.
- **STORE-02** — Every change is written to `file` (JSON) at once, and a new `createStore(file)` on the same file sees the same tasks.
- **STORE-03** — Ids are integers starting at 1 and are never reused: not after `remove(id)`, and not after the store is reopened from its file.
- **STORE-04** — `complete(id)` marks a task done and returns it; `remove(id)` deletes it; both throw for an unknown id. `list({ status })` returns tasks ordered by id, with `status` `all` (the default), `open` or `done`.

### Reports (phase 2)

- **REPORT-01** — `src/report.js` exports `overdue(tasks, today)`: the open tasks whose due date is before `today` (a `YYYY-MM-DD` string); a task due today is not overdue. Sorted by due date, then id.
- **REPORT-02** — `byPriority(tasks)`: the open tasks, high first, then medium, then low; within a priority by due date ascending, tasks with no due date last, then by id.
- **REPORT-03** — `toCSV(tasks)`: a header line `id,title,priority,due,done`, then one line per task in the order given, lines joined with `\n`. A field that contains a comma, a double quote or a line break is wrapped in double quotes, with each double quote inside it doubled. A missing due date is an empty field; `done` is `true` or `false`.

## Traceability

| Requirement | Phase | Plan | Status |
|---|---|---|---|
| STORE-01 | 1 | — | Pending |
| STORE-02 | 1 | — | Pending |
| STORE-03 | 1 | — | Pending |
| STORE-04 | 1 | — | Pending |
| REPORT-01 | 2 | — | Pending |
| REPORT-02 | 2 | — | Pending |
| REPORT-03 | 2 | — | Pending |
