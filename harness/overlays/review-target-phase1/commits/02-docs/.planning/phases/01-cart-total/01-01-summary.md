---
phase: 01-cart-total
plan: 01
subsystem: pricing
requirements-completed: [REQ-01, REQ-02, REQ-03]
key-files:
  created: [src/cart.js, tests/cart.test.js]
  modified: []
completed: 2026-10-23
one-liner: cartTotal(items, code) with a bulk discount and discount codes, with node:test tests
---

# Phase 1 Plan 01: Cart total Summary

`src/cart.js` exports `cartTotal(items, code)`: unit price × quantity, 5% off a bulk cart,
then the code's percentage, rounded to two decimals. `tests/cart.test.js` covers the plain
total, `SAVE10` and a bad quantity; `npm test` passes.

## Deviations

None.
