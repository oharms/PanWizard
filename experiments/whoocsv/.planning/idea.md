---
title: "whoocsv — CSV parse + write with proper quoting"
budget: 15
---

# whoocsv

Parses and writes RFC-4180-ish CSV. Handles quoted fields, embedded commas, embedded newlines (within quotes), escaped quotes (doubled). Symmetric: `parse(text) → rows`, `write(rows) → text`.

## SC

- SC-1: Round-trip (parse→write) preserves data for all tested inputs
- SC-2: Embedded comma in quoted field handled
- SC-3: Embedded newline in quoted field handled
- SC-4: Escaped quote (`""`) within quoted field decoded correctly
- SC-5: ≥7 tests
- SC-6: Apply P-401, P-402, P-403, P-602
