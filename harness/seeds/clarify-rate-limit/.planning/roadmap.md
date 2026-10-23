# Roadmap: Quotes API

## Overview

One phase: rate-limit the public API. The policy is not decided yet.

## Phases

- [ ] **Phase 1: Rate limiting** - Limit callers that send too many requests

## Phase Details

### Phase 1: Rate limiting
**Goal:** No single caller can starve the others.
**Depends on:** Nothing (first phase)
**Requirements:** REQ-01, REQ-02
**Success Criteria** (what must be TRUE):
  1. A caller over the limit is refused until it is back under it
  2. A refused caller learns it was limited and when it may retry
**Plans:** TBD

**Notes:** Open: the limit and its window, what identifies a caller (API key, user or address), the response a limited caller gets, whether some callers are exempt, where the counters live. Settled in context.md before planning.
