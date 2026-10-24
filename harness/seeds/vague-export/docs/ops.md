# Ops runbook

## Backups

The store is snapshotted nightly at 02:00. Restores go through Lerato.

## Deleting claims

Staff "delete" a claim through a soft delete (`deletedAt` is set); the record stays in the
store for the audit trail. **A soft-deleted claim must never appear in anything that
leaves the system** — reports, exports, emails. Audit reads the store directly.

## Exports

- Every export file lives under an `exports/` folder: `<dir>/exports/`.
- The monthly finance export is named `expenses-YYYY-MM.csv` after the month it covers,
  for example `exports/expenses-2026-09.csv`. The file covers the whole calendar month,
  first to last day.
- Create the `exports/` folder when it is missing; overwrite a file of the same name.

## On-call

Pager rotation is in the shared calendar.
