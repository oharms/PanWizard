# Expense Export

## What This Is

A small Node.js library that keeps a team's expense records in `data/expenses.json`, used as
a fixed seed for PAN's behavioural harness. Its one phase adds a CSV export and leaves most of
the format to the user on purpose, so `/pan:discuss-phase` has something to clarify.

## Core Value

Finance can open the export in their spreadsheet and reconcile it without fixing anything by hand.
