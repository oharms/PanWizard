---
title: "whoojson — stable-key JSON pretty-printer"
budget: 15
---

# whoojson

Pretty-prints JSON with sorted keys (recursive). Useful for canonical-form comparison and diffing. Round-trip preserves data.

## SC

- SC-1: `whoojson < input.json` writes pretty-printed JSON with all object keys sorted recursively
- SC-2: Arrays NOT sorted (order matters)
- SC-3: `--indent N` controls indent width (default 2)
- SC-4: Round-trip: parse(pretty(parse(x))) === parse(x)
- SC-5: ≥6 tests; apply P-901 round-trip
