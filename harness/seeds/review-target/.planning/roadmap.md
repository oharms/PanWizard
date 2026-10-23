# Roadmap: Shop Cart

## Overview

One phase: price a cart, with a bulk discount and discount codes.

## Phases

- [ ] **Phase 1: Cart total** - `cartTotal(items, code)` with bulk and code discounts

## Phase Details

### Phase 1: Cart total
**Goal:** A cart is priced exactly as REQ-01 to REQ-03 say.
**Depends on:** Nothing (first phase)
**Requirements:** REQ-01, REQ-02, REQ-03
**Success Criteria** (what must be TRUE):
  1. `cartTotal([{sku: 'BREAD', qty: 2}])` is 36
  2. Ten items or more get 5% off; a code applies after it; an unknown code throws
**Plans:** 1 plan

Plans:
- [ ] 01-01: cartTotal with bulk and code discounts
