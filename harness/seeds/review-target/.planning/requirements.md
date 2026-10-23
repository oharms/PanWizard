# Requirements

## v1.0 Requirements

- **REQ-01** — `cartTotal(items, code)` returns the sum of unit price × quantity over the items, rounded to two decimals. `items` is an array of `{sku, qty}`; a quantity that is not a positive integer throws an Error.
- **REQ-02** — A cart with ten or more items in total (the sum of the quantities) gets 5% off.
- **REQ-03** — A discount code applies its percentage after the bulk discount: `SAVE10` is 10% off, `HALF` is 50% off. An unknown code throws an Error that names the code.
