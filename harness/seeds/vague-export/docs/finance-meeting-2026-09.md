# Finance sync — 2026-09-17

**Present:** Thandi (Finance lead), Pieter (Accounts payable), Sipho (Engineering), Lerato (Ops)

## 1. Office move

Lerato confirmed the move to the second floor is on 3 October. Desks to be packed by the
Thursday before. No action for engineering.

## 2. Expense export

Thandi: finance reconciles expenses once a month against the bank statements, and at the
moment Pieter retypes everything from screenshots. They want an export they can open
straight in Excel.

What was agreed:

- **How finance will call it.** Sipho will add `src/export.js` with two functions, and
  finance's reconciliation script will call exactly these:
  - `exportExpenses(store, { from, to })` returns the CSV text as a string. `from` and `to`
    are `YYYY-MM-DD` dates and **both ends are included** — Pieter asks for "the 1st to the
    30th" and expects claims dated the 30th to be in it.
  - `writeMonthlyExport(store, month, dir)` takes a month as `YYYY-MM`, writes that whole
    calendar month's export under `dir` (folder and file naming are in the ops runbook,
    `docs/ops.md`),
    and returns the full path of the file it wrote.
- **Delimiter.** The finance laptops run Excel with the South African regional settings,
  where a comma-separated file opens as one long column. The file must use a **semicolon**
  (`;`) between fields. Pieter tried a comma file last year and gave up.
- **Amounts.** The system keeps amounts in integer cents; finance wants rands: a plain
  decimal with **exactly two decimal places and a full stop** as the separator (Thandi's
  Excel is set to a full stop), no currency symbol, no thousands separator. So 125000 cents
  is `1250.00`, 1250 cents is `12.50`. Refunds stay negative: -5 cents is `-0.05`.
- **Order.** Rows oldest first by claim date; claims on the same date in id order.
- **Cost centre.** Pieter needs the cost centre on every row to post the journal. Column
  names, their order and the cost centre codes are in `docs/data-dictionary.md` — use those
  exactly, the reconciliation script matches on the header.

Sipho asked whether finance wants totals at the bottom. Thandi: no, Excel does that.

## 3. Travel policy

Pieter to circulate the updated per-diem rates. Not an engineering item.

## Actions

| Who | What |
|---|---|
| Sipho | Build the export as above |
| Lerato | Confirm deleted claims are handled per the ops runbook |
| Pieter | Per-diem rates |
