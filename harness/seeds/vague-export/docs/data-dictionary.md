# Data dictionary

## Expense (store record)

| Field | Type | Notes |
|---|---|---|
| `id` | integer | Assigned by the store, starts at 1 |
| `date` | `YYYY-MM-DD` | The claim date |
| `amountCents` | integer | In cents; a refund is negative |
| `description` | text | Free text typed by staff. It can contain semicolons, commas and double quotes |
| `costCentre` | code or `null` | See *Cost centres* |
| `submittedBy` | text | The claimant's username |
| `deletedAt` | ISO timestamp or `null` | Set by a soft delete |

## Finance export (CSV)

The header row is required and uses exactly these column names, in this order:

| # | Column | From |
|---|---|---|
| 1 | `id` | `id` |
| 2 | `date` | `date`, as stored |
| 3 | `cost_centre` | `costCentre` — see *Cost centres* |
| 4 | `description` | `description` |
| 5 | `amount` | `amountCents` in rands (format agreed with finance, see the 2026-09 meeting notes) |
| 6 | `submitted_by` | `submittedBy` |

No other columns. A field that contains the delimiter, a double quote or a line break is
wrapped in double quotes, and each double quote inside it is doubled (`Lunch; "Acme"`
becomes `"Lunch; ""Acme"""`).

## Cost centres

| Code | Name |
|---|---|
| `FIN-100` | Finance |
| `OPS-200` | Operations |
| `ENG-300` | Engineering |
| `SAL-400` | Sales |

A claim with no cost centre (`costCentre` is `null`) is exported with the code
`UNALLOCATED`, never an empty field: the journal import rejects an empty cost centre.
