---
title: "whoonum — sum two numbers"
runtime_preference: claude
budget: 5
---

# whoonum

Trivial CLI that takes two numeric args and prints their sum. Built to validate v3.7.3 patches end-to-end via runner.cjs (P-1304 shell-quote, P-1401 lightweight-phase bypass).

## SC

- SC-1: `whoonum 2 3` writes `5` to stdout
- SC-2: ≥2 tests
- SC-3: One phase only (lightweight bypass should trigger)
