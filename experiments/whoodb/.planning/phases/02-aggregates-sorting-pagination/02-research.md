# Phase 2: Aggregates + Sorting + Pagination - Research

**Researched:** 2026-05-02
**Domain:** GROUP BY aggregation accumulator, multi-key stable ORDER BY, LIMIT/OFFSET with streaming early-termination — built on top of Phase 1's streaming evaluator
**Confidence:** HIGH — all techniques are textbook patterns and the project-level research already covers them; this file emits Phase-2-specific deltas.

> **No `context.md` exists for Phase 2.** Auto-mode synthesis applies: the locked decisions come from `idea.md` / `project.md` / `roadmap.md` / project-level research, not user dialogue.

> **Project-level research is the source of truth.** This file points back to it and surfaces only the items the Phase 2 planner needs at hand.
>
> Source files read:
> - `.planning/research/summary.md`
> - `.planning/research/architecture.md`
> - `.planning/research/pitfalls.md`
> - `.planning/research/stack.md`
> - `.planning/research/features.md`
> - `.planning/idea.md`, `.planning/project.md`, `.planning/requirements.md`, `.planning/roadmap.md`, `.planning/state.md`, `.planning/standards.md`
> - `.planning/phases/01-lexer-parser-core-evaluator/{01-context,01-research,01-01-plan,01-02-plan,01-01-summary,01-02-summary,01-verification}.md`
> - Phase 1 source: `src/{ast,lexer,parser,analyze,where,project,evaluator}.js`
>
> **NOT re-derived here:** stack choices, NULL semantics, LIKE anchoring, lexer column tracking, recursive-descent parser pattern, readline streaming, JSONL malformed-line policy, zero-deps constraint. All locked in Phase 1 research and source.

## Summary

Phase 2 adds three buffered execution paths on top of Phase 1's pure-streaming WHERE pipeline:

1. **GROUP BY accumulator** — an in-memory `Map<keyString, Bucket>` keyed by a **type-tagged** group tuple (so integer `1` and string `"1"` are DISTINCT groups, per AGGR-06 and pitfalls.md Pitfall 3). Each bucket holds running aggregate state for COUNT(*), COUNT(field), SUM, AVG (as `{sum, count}`), MIN, MAX. Finalize on stream-exhaust. Type-mismatch policy: SUM/AVG/MIN/MAX of a non-numeric value emits a stderr warning and the row's contribution is skipped (AGGR-08); AVG with zero numeric inputs returns `null` (AGGR-09).

2. **ORDER BY stable multi-key sort** — collect post-projection rows into an array, sort with `Array.prototype.sort` (stable since Node 12 / V8 7.0 / ECMAScript 2019), comparator built from `OrderByItem[]` (each item: `{ key, dir }`, dir ∈ `{ASC, DESC}`). Sort keys reference **post-projection names including aliases** (SORT-03, project.md Anti-Pattern 5). Stability guarantees identical-keyed rows retain input order (SORT-04).

3. **LIMIT/OFFSET** — two execution modes:
   - **Streaming mode (no GROUP BY, no ORDER BY)** — early-terminate by `break`-ing out of the `for await` loop after `OFFSET + LIMIT` rows have passed WHERE; this triggers async-iterator `return()` which closes the readline stream, satisfying PAGE-03's "stops reading after the row cap is reached" requirement.
   - **Buffered mode (GROUP BY or ORDER BY present)** — apply slice(`offset`, `offset + limit`) after sort/finalize; cannot early-terminate because we need to see all rows first.

The Phase 1 evaluator currently has guards `if (plan.groupBy !== null) throw` etc. Those guards must be **replaced** with the buffered execution paths, not simply removed — the streaming path remains the default, and `plan.groupBy / plan.sort / plan.limit` flags route into the buffered path.

**Primary recommendation:** Extend the existing `src/evaluator.js` with three additional helpers (`runGrouped`, `runOrdered`, plus a `applyLimitOffset` slicer) and add two new modules — `src/accumulator.js` and `src/sort.js`. Add `Aggregate` / `OrderByItem` / `LimitOffset` AST nodes to `src/ast.js`. Extend the parser to emit them. Extend the analyzer to populate `plan.groupBy / plan.sort / plan.limit`. Do NOT introduce a query-plan IR — the architecture is already AST-direct (architecture.md Pattern 5).

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| AGGR-01 | `COUNT(*)` (row count, including NULLs) | Accumulator increments `count_star` for every WHERE-passing row regardless of any field value; see "Accumulator Bucket Shape" below. Aggregate AST node with `func: 'COUNT', arg: 'STAR'`. |
| AGGR-02 | `COUNT(field)` (non-null-value count) | Aggregate AST node `func: 'COUNT', arg: ColumnRef`. Bucket increments only when `resolvePath(row, path) != null` (covers null AND undefined per Phase 1 nullish convention). |
| AGGR-03 | `SUM(field) / AVG(field) / MIN(field) / MAX(field)` | Per-aggregate state per bucket. SUM accumulates a running number. AVG accumulates `{sum, count}` and finalizes as `sum/count`. MIN/MAX track the running extreme using `<` / `>` JS comparison after the type-mismatch guard. |
| AGGR-04 | GROUP BY single field | `parseGroupBy` already emits `ColumnRef[]` (Phase 1 wired this in for PARSE-09 — confirmed in `src/parser.js`). The accumulator just needs to read `plan.groupBy.map(c => resolvePath(row, c.path))`. |
| AGGR-05 | GROUP BY multi-field tuple | Same path as AGGR-04 — `plan.groupBy` is already an array. Group key is the array of resolved values. |
| AGGR-06 | Type-tagged group keys (int `1` vs string `"1"` distinct) | LOCKED key formula: `JSON.stringify(vals.map(v => [typeof v, v]))`. Pitfalls.md Pitfall 3. Test: feed rows `{a:1}` and `{a:"1"}`, assert two distinct buckets. |
| AGGR-07 | GROUP BY emission order deterministic (lex sort of group keys) | `roadmap.md` and `architecture.md` say "group keys sorted lexicographically". After accumulator finalize, sort the result array by `JSON.stringify(groupKeyValues)` (or by each group key field in declared order) **before** any user-supplied ORDER BY runs — actually: when there is no ORDER BY, sort by group key. When there IS an ORDER BY, the user's ORDER BY wins. **Decision below in Open Questions.** |
| AGGR-08 | SUM/AVG/MIN/MAX of non-numeric value warns to stderr and skips that row's contribution | Per-aggregate guard: `if (typeof v !== 'number' || Number.isNaN(v)) { warn; continue; }`. Idea.md constraint section locks this. The `whoodb: ` prefix matches the malformed-JSONL warning format already in `evaluator.js`. |
| AGGR-09 | AVG over zero numeric inputs returns `null` | After finalize: `bucket.avg.count === 0 ? null : bucket.avg.sum / bucket.avg.count`. Idea.md constraint locks this. |
| SORT-01 | ORDER BY single field with optional ASC/DESC (default ASC) | `OrderByItem { type: 'OrderByItem', key: string, dir: 'ASC'|'DESC' }`. Default ASC if direction keyword absent. |
| SORT-02 | ORDER BY multiple keys, each with own direction | `plan.sort` is an array of OrderByItem. Comparator iterates keys; first non-zero result wins. |
| SORT-03 | ORDER BY operates on projected (post-projection) names including aliases | Sort happens **after** projection — comparator reads `row[key]` from projected rows, not from raw rows. Architecture.md Anti-Pattern 5 + idea.md SC-4. **Critical pipeline ordering:** `WHERE → group/finalize → project → sort → slice`. |
| SORT-04 | Sort is stable (equal-key rows retain input order) | `Array.prototype.sort` is stable in Node ≥ 12 / V8 ≥ 7.0 / ECMAScript 2019. Project's Node ≥ 22.17.0 floor guarantees this. No tiebreaker-index workaround needed (architecture.md Anti-Pattern 3). |
| PAGE-01 | LIMIT non-negative integer caps result rows | Parser accepts `LIMIT N` where N is a NUMBER literal; analyzer rejects negative. Buffered: `result.slice(offset, offset + limit)`. Streaming: `if (++emitted >= offsetPlusLimit) break`. |
| PAGE-02 | OFFSET non-negative integer skips rows before LIMIT applies | `LIMIT N OFFSET M` parses both. Buffered: same `slice(offset, offset + limit)` formula. Streaming: count `passed` rows; emit only when `passed > offset && emitted < limit`. |
| PAGE-03 | LIMIT present, no ORDER BY/GROUP BY → streaming pipeline halts after row cap | `for await ... break` triggers async-iterator `return()`, which propagates to the readline async iterator and closes the underlying file descriptor. Verifiable by spying on a "lines read" counter. |

## Standard Stack

**No new dependencies.** Phase 2 uses only Node builtins already in use (zero-deps constraint per project.md). Specifically:

| Builtin | Used For | Notes |
|---------|----------|-------|
| `Array.prototype.sort` (native) | ORDER BY stable sort | Stable since Node 12 / V8 7.0 (ECMAScript 2019). Node ≥ 22.17.0 floor guarantees stability. — **HIGH confidence** (architecture.md, V8 release notes) |
| `Map` (native) | GROUP BY accumulator (key → bucket) | O(1) insert/lookup; preserves insertion order which gives deterministic output when sort is unspecified. — **HIGH confidence** |
| `JSON.stringify` (native) | Group-key string identity | Used with type-tagged input `[typeof v, v][]` to disambiguate `1` vs `"1"`. — **HIGH confidence** (pitfalls.md Pitfall 3) |
| `Number.isNaN`, `typeof === 'number'` | Numeric-aggregate type guard | Standard JS — `NaN` is a number under `typeof` so a separate `Number.isNaN` check is required. — **HIGH confidence** |
| `process.stderr.write` | Type-mismatch warnings (AGGR-08) | Same channel already used in `src/evaluator.js` for SRC-05 malformed-line warnings. — **HIGH confidence** |

**No external libraries.** Specifically NOT:
- `lodash.sortBy` / `lodash.groupBy` — runtime dep, violates zero-deps. Vanilla `Array.sort` and `Map` cover everything.
- `fast-sort` / `natural-sort` — same reason.
- Streaming-aggregation packages (`miss`, `through2`-derived) — Node 22 readline + plain `for await` is sufficient.

## Architecture Patterns

### Recommended Module Layout (Phase 2 deltas)

```
src/
├── ast.js          # +Aggregate, +OrderByItem nodes (extend, do not rewrite)
├── parser.js       # +parseAggregate, +parseOrderBy, +parseLimit (extend)
├── analyze.js      # populate plan.groupBy/sort/limit (extend; the GROUP BY rule already runs)
├── accumulator.js  # NEW — Map-keyed group accumulator with per-aggregate finalize
├── sort.js         # NEW — comparator builder for OrderByItem[]
├── evaluator.js    # +runGrouped(), +runOrdered(), +applyLimitOffset() (extend)
├── where.js        # unchanged (pure WHERE evaluator)
├── project.js      # unchanged (pure projector)
└── lexer.js        # NO change — ORDER, BY, GROUP, LIMIT, OFFSET, ASC, DESC are already in the KEYWORDS set
```

Test files mirror this:
- `test/parser.test.js` — extend with aggregate / ORDER BY / LIMIT cases
- `test/analyze.test.js` — extend with sort/limit population checks
- `test/accumulator.test.js` — NEW — bucket arithmetic, type-mismatch warns, type-tagged keys, AVG empty-input null
- `test/sort.test.js` — NEW — multi-key, ASC/DESC, stability gate
- `test/evaluator.test.js` — extend with the four Phase 2 success criteria + early-termination spy

### Pattern 1: Accumulator Bucket Shape

**What:** Per group, hold one bucket. Bucket stores enough state to finalize ALL aggregate functions for that bucket without revisiting the input.

**When to use:** Always for GROUP BY queries. Required when SELECT contains an aggregate even without GROUP BY (single-bucket case — see Open Question 1).

**Bucket shape (proposed):**
```js
// One bucket per unique group-key string
// All aggregates from the SELECT projection get one slot in the bucket;
// the slot key is a stable identifier — recommended: the projection index
// or the alias name (they're the user-visible name for the result column).
const bucket = {
  groupValues: [/* the raw group-key field values, used to emit the GROUP BY columns in the output row */],
  aggregates: {
    // Example for: SELECT agent, COUNT(*) AS calls, SUM(usage.output_tokens) AS out
    // After projection-aware finalize, this becomes { agent: <key>, calls: N, out: M }
    'calls':  { kind: 'COUNT_STAR', count: 0 },
    'out':    { kind: 'SUM',         sum: 0 },
    // For AVG: { kind: 'AVG', sum: 0, count: 0 }
    // For MIN: { kind: 'MIN', value: undefined, hasValue: false }
    // For MAX: { kind: 'MAX', value: undefined, hasValue: false }
    // For COUNT(field): { kind: 'COUNT_FIELD', count: 0 }
  }
};
```

**Source pattern reference (architecture.md Pattern 4 + research/architecture.md component table):**
```js
// src/accumulator.js  (sketch)
function groupKey(row, groupByCols) {
  const vals = groupByCols.map(c => resolvePath(row, c.path));
  // Type-tag: [typeof v, v] makes 1 vs "1" distinct
  return { vals, key: JSON.stringify(vals.map(v => [typeof v, v])) };
}

function updateBucket(bucket, row, aggDefs) {
  for (const [outKey, agg] of Object.entries(aggDefs)) {
    const slot = bucket.aggregates[outKey];
    switch (slot.kind) {
      case 'COUNT_STAR':
        slot.count++;
        break;
      case 'COUNT_FIELD': {
        const v = resolvePath(row, agg.path);
        if (v != null) slot.count++;
        break;
      }
      case 'SUM': {
        const v = resolvePath(row, agg.path);
        if (typeof v !== 'number' || Number.isNaN(v)) {
          if (v != null) warnNonNumeric('SUM', agg.path.join('.'), v);
          break;
        }
        slot.sum += v;
        break;
      }
      // AVG, MIN, MAX similarly with their own type-guards.
    }
  }
}
```

### Pattern 2: Type-Tagged Group Key (LOCKED)

**What:** The group-key string MUST distinguish JS types so `1` and `"1"` produce two distinct buckets.

**Implementation (LOCKED — same formula as pitfalls.md Pitfall 3 mitigation):**
```js
JSON.stringify(groupValues.map(v => [typeof v, v]))
```

**Example:**
- Row 1: `{a: 1}` → `groupValues = [1]` → key = `[["number",1]]`
- Row 2: `{a: "1"}` → `groupValues = ["1"]` → key = `[["string","1"]]`
- Row 3: `{a: null}` → `groupValues = [null]` → key = `[["object",null]]` (null reports as "object" — fine; null and undefined are both legitimate distinct group keys per the project's two-valued NULL policy applied to grouping context)
- Row 4: `{}` (a missing) → `groupValues = [undefined]` → key = `[["undefined",null]]` (after JSON.stringify; undefined → null in JSON serialization, but the type-tag `"undefined"` makes this distinct from a literal `null`)

**Test gate (AGGR-06 + Phase 2 SC #2):** feed `{agent: 1}` and `{agent: "1"}`, run `GROUP BY agent`, assert two buckets in the result.

### Pattern 3: Stable Multi-Key Comparator (Pre-Built)

**What:** Build the comparator function ONCE outside the `Array.prototype.sort` call. Closing over `OrderByItem[]` allocates one comparator; calling sort with it does not re-allocate.

**When to use:** Always for ORDER BY. Inline lambdas (`array.sort((a,b) => …)`) are fine for small N but allocate a new closure scope per sort call; pre-built is the canonical pattern (pitfalls.md Performance Trap "Sort comparator allocates closures per comparison").

**Implementation (sketch):**
```js
// src/sort.js
export function buildComparator(orderByItems) {
  // orderByItems: [{ key: 'out', dir: 'DESC' }, { key: 'agent', dir: 'ASC' }]
  return (rowA, rowB) => {
    for (const { key, dir } of orderByItems) {
      const a = rowA[key];
      const b = rowB[key];
      // Stable handling of nullish: treat null/undefined as smaller than any value
      // (document this — SQL standard is ambiguous; common practice is NULLS FIRST in ASC)
      const cmp = compareValues(a, b);
      if (cmp !== 0) return dir === 'DESC' ? -cmp : cmp;
    }
    return 0; // equal under all keys → stable sort preserves input order
  };
}

function compareValues(a, b) {
  if (a === b) return 0;
  if (a == null) return -1;        // null/undefined first
  if (b == null) return 1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (typeof a === 'string' && typeof b === 'string') return a < b ? -1 : 1;
  // Mixed types: coerce to string for stable lexicographic ordering
  return String(a) < String(b) ? -1 : 1;
}
```

**Stability guarantee:** When the comparator returns 0 for two rows, `Array.prototype.sort` keeps them in original order (Node 12+ / V8 7.0+ / ECMAScript 2019). The Node ≥ 22.17.0 floor satisfies this. **DO NOT** add a tiebreaker index field (architecture.md Anti-Pattern 3).

**Test gate (Phase 2 SC #1 stable tie-breaking):** input `[{out:5, agent:'a'}, {out:5, agent:'b'}]` ORDER BY `out DESC` returns the rows in input order — `'a'` first, then `'b'`.

### Pattern 4: Two-Mode LIMIT/OFFSET

**Mode A — Streaming (PAGE-03):** when `plan.groupBy === null && plan.sort === null && plan.limit !== null`:

```js
// src/evaluator.js — extends existing async generator
const { offset = 0, count: limit = Infinity } = plan.limit ?? {};
let passed = 0, emitted = 0;
for await (const rawLine of rl) {
  // ... parse, evalWhere, project as before ...
  passed++;
  if (passed <= offset) continue;
  yield projected;
  emitted++;
  if (emitted >= limit) break;   // ← triggers async-iterator return(), closes readline
}
```

**Mode B — Buffered:** when `plan.groupBy !== null || plan.sort !== null`:

```js
// After accumulator.finalize() OR after sort:
const offset = plan.limit?.offset ?? 0;
const count  = plan.limit?.count  ?? rows.length;
return rows.slice(offset, offset + count);
```

**Verification of PAGE-03 (Phase 2 SC #4):** wrap a fixture with N rows where N > LIMIT. Spy on a counter incremented per `JSON.parse` call (or per `for await` iteration). Assert the counter never exceeds `offset + limit`. Pitfalls.md "Streaming early termination on LIMIT" maps this exact test.

### Pattern 5: Pipeline Composition (Lock the Order)

**Locked pipeline (matches architecture.md and SC-4 of idea.md):**
```
WHERE filter
  → if (groupBy) accumulator.update(row); else collect(row, mode)
  ↓
[stream-exhaust]
  ↓
if (groupBy) accumulator.finalize() → result rows (one per bucket)
else         use collected rows
  ↓
project(plan.projection, row) — produces post-projection rows with alias keys
  ↓
if (sort) result.sort(comparator)
  ↓
if (limit) slice(offset, offset+count)
  ↓
yield each
```

**Why this order matters:**
- **Project before sort** — SORT-03 requires sorting on alias names. Aliases don't exist until projection runs. (Architecture.md Anti-Pattern 5.)
- **Finalize before project** — projection of an aggregate (e.g., `COUNT(*) AS calls`) reads from the bucket's aggregate slot, not from a raw row. The "row" feeding `project()` in the GROUP BY path is a synthesized row built from the bucket: group-key fields + finalized aggregate values.
- **Sort before slice** — LIMIT applies to the sorted view, not the unsorted view. Slicing first would return arbitrary rows.

### Anti-Patterns to Avoid

| Anti-pattern | Why bad | Do this instead |
|---|---|---|
| Plain `JSON.stringify(vals)` for group key | `[1]` and `["1"]` produce different strings — but `[null]` and `[undefined]` collapse to `[null]` and the `1` vs `"1"` distinction works only by accident on the CHARACTERS being different. Edge cases (booleans, numbers vs numeric strings with leading zeros) bite later. | Type-tag: `JSON.stringify(vals.map(v => [typeof v, v]))` |
| Tiebreaker index field on every row before sort | Wastes memory + adds noise to row shape. `Array.prototype.sort` IS stable on Node ≥ 12. | Use `Array.prototype.sort` directly. Document that stability is guaranteed by Node engine floor. |
| Inline lambda comparator in `arr.sort(...)` for hot path | Allocates closure per sort call. Marginal for 100K rows but sloppy. | Build the comparator once in `src/sort.js` and pass it. |
| Sort raw rows then project | Loses access to alias keys; produces wrong ORDER BY behavior for `SELECT SUM(x) AS total ... ORDER BY total DESC`. | Project FIRST, sort projected rows. |
| Apply LIMIT before ORDER BY | Returns arbitrary rows. | Sort, then slice. |
| Use `for await` to drain readline then break to early-terminate (already correct) but forget to also propagate the break in a wrapping `runGrouped`/`runOrdered` | If `runGrouped` is itself an async generator and the consumer breaks out, that's fine; but if it collects-then-yields, breaking the consumer doesn't help — the file was already fully read. | Reserve early-termination for the streaming path ONLY. Buffered paths inherently must scan the whole file. |
| Special-case `*` inside `COUNT(*)` at the lexer | The `*` in `COUNT(*)` is a function-arg, not a wildcard projection. Pitfalls.md "Looks Done But Isn't" item #7. | Handle in the parser: `parseAggregate` recognizes `COUNT` followed by `(`, and inside the parens accepts EITHER `*` (WILDCARD token) OR a ColumnRef. Other aggregates (SUM/AVG/MIN/MAX) accept only ColumnRef. |
| Throw on first non-numeric SUM input | Idea.md says: warn + skip. Throwing aborts the query — wrong. | `process.stderr.write` warning, `continue` to next aggregate / next row. |

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Stable sort | A merge-sort wrapped around `Array.prototype.sort` to "ensure" stability | `Array.prototype.sort` directly | Stable since V8 7.0 / Node 12 / ECMAScript 2019. Project's Node ≥ 22.17.0 floor guarantees this. Architecture.md Anti-Pattern 3. |
| Group-key collision avoidance | Concatenation with a separator string and hoping no value contains the separator | `JSON.stringify` over `[typeof v, v]` pairs | Pitfalls.md Pitfall 3. The type-tag is the canonical fix; concatenation has no safe separator for arbitrary strings. |
| Numeric type detection | A custom `isNumber()` that accepts numeric strings (`"42"` → true) | `typeof v === 'number' && !Number.isNaN(v)` | SQL semantics: SUM of `"42"` is non-numeric, NOT silently coerced. Pitfalls.md "Treat all JSON values as strings" tech-debt warning. |
| AVG arithmetic | A running-mean Welford-style accumulator | Plain `{sum, count}` and divide at finalize | Welford's algorithm is for numerical stability when mean changes drastically; log-token sums are bounded and float64 has plenty of precision. Don't import a stats library; don't reinvent one. |
| ORDER BY tie-breaking | Adding a row-index property to every row pre-sort | Stable native sort; comparator returns 0 on equal keys | Same as the stable-sort row above. Already covered. |
| LIMIT/OFFSET parsing | A bespoke regex over the query string post-parse | Extend the existing recursive-descent parser with `parseLimit()` consuming `LIMIT NUMBER` and optional `OFFSET NUMBER` | Phase 1 already wired up the parser pattern; adding two grammar rules is ~20 lines. |
| Numeric coercion across mixed types in MIN/MAX | Custom comparator that infers "intended" type | Document policy: MIN/MAX work only on rows where the field is `typeof === 'number' && !Number.isNaN`; non-numeric rows are skipped with a warning, same as SUM | Consistent with AGGR-08 idea.md constraint. **Note:** MIN/MAX over strings is a v2 feature (defer); Phase 2 explicitly handles only numeric MIN/MAX. |

**Key insight:** None of Phase 2's algorithms are novel. Every part — group accumulator, stable comparator, slice — has a one-line vanilla-JS implementation. The risks are correctness (type-tagged keys, NULL semantics propagated from Phase 1, projection-before-sort) not performance.

## Common Pitfalls

> All of these are documented in `.planning/research/pitfalls.md`. Phase 2 specifics below.

### Pitfall 1: GROUP BY key collision via plain JSON.stringify
**What goes wrong:** `{a: 1}` and `{a: "1"}` produce JSON-stringified keys `"[1]"` and `"["1"]"` — distinct, but only because of the quote characters. With `null` vs `undefined`, both stringify to `null` and collapse into one bucket — wrong.

**Why it happens:** `JSON.stringify(undefined)` returns the string `"null"` when nested in arrays/objects (see ECMA-404 / MDN). So `[null]` and `[undefined]` both stringify to `"[null]"`.

**How to avoid:** **LOCKED FORMULA** — `JSON.stringify(vals.map(v => [typeof v, v]))`. The `typeof` tag distinguishes `null` (`"object"`) from `undefined` (`"undefined"`) from `1` (`"number"`) from `"1"` (`"string"`).

**Warning signs:** GROUP BY counts are systematically off when input has mixed types in the grouping field.

**Test gate:** Phase 2 SC #2 covers this directly.

### Pitfall 2: AVG returns NaN instead of null on all-non-numeric input
**What goes wrong:** `AVG(price)` over rows where `price` is always a string → bucket stays at `{sum:0, count:0}` → finalize divides `0/0 = NaN`.

**Why it happens:** Naive finalize: `bucket.sum / bucket.count`.

**How to avoid:** Finalize with a guard: `bucket.count === 0 ? null : bucket.sum / bucket.count`. AGGR-09 + idea.md constraint.

**Warning signs:** `null` in JSONL output indicates the policy fired; `NaN` (becomes `null` only if you go through `JSON.stringify(NaN) === 'null'` which is technically the same wire-format result but the in-memory bucket reflects a bug).

**Test gate:** Phase 2 SC #3.

### Pitfall 3: Sort destabilized by an inline allocation
**What goes wrong:** A comparator that calls `String(a).toLowerCase()` inside the comparison can change behavior across V8 versions if the resulting string interning differs. Stability is a guarantee about EQUAL-keyed elements; if your comparator returns non-zero for elements you intended to be equal, stability doesn't help.

**Why it happens:** Comparator returns slightly-different float results due to floating-point comparison rather than typed comparison.

**How to avoid:** For numeric keys, use `a - b` (returns 0 exactly when `a === b`). For string keys, use `<` / `>` (returns 0 only on the `===` else branch). Don't compute derived keys (toLowerCase, normalize) inside the comparator unless required — and if required, derive once before sorting.

**Test gate:** input `[{x:5, _i:0}, {x:5, _i:1}, {x:5, _i:2}]` ORDER BY x — output must still be in `_i` order 0,1,2.

### Pitfall 4: PAGE-03 verification fails because we count "lines emitted" not "lines read"
**What goes wrong:** `LIMIT 5` on a 1000-row file. The test asserts that early termination happened, but the test only counts emitted rows — which is always 5 by definition. The test passes whether or not the file was fully read.

**Why it happens:** Easy to confuse "limit was respected" (always true) with "early termination happened" (the actual claim).

**How to avoid:** The test must spy on a *read* counter, not an emit counter. Two options:
1. **Counter-based:** instrument the evaluator to expose a `linesRead` counter (or a test-only hook). Assert `linesRead < fileTotal`.
2. **File-size-based:** use a fixture large enough that reading it all would take measurable time; assert the test completes in `< some threshold`.

**Recommendation:** Option 1 is cleaner. Add an optional `{onLineRead?: () => void}` callback to `execute()` for tests, OR have `execute()` track and expose the line counter via the generator's return value. The Phase 2 plan should pick one and lock it.

**Test gate:** Phase 2 SC #4 — but the test must be written to fail when early termination is missed.

### Pitfall 5: Aggregates without GROUP BY (single-bucket case)
**What goes wrong:** `SELECT COUNT(*) FROM f` — no GROUP BY. The current PARSE-09 analyzer rule says "every projected column must appear in GROUP BY OR be wrapped in an aggregate". With ALL-aggregate projection and no GROUP BY, what's the bucket key?

**Why it happens:** GROUP BY's degenerate case is "one global bucket". Most engines treat the absence of GROUP BY with an all-aggregate SELECT as `GROUP BY ()` — a single empty group.

**How to avoid:** If `plan.groupBy === null` AND the projection contains any aggregate, treat as a single-bucket implicit `GROUP BY ()`. Use `groupKey = "[]"` or skip key computation entirely. Emit ONE result row.

**Decision:** Phase 2 MUST handle this case. The analyzer should set a `plan.implicitGroupBy = true` flag when projection has aggregates but no GROUP BY clause. The accumulator path runs with a single bucket. **This is a Phase 2 design decision, not a deferred concern** — `SELECT COUNT(*)` is in idea.md SC-1 and is one of the most common queries.

**Test gate:** `SELECT COUNT(*) FROM 'fixture'` returns one row with the total count.

### Pitfall 6: ORDER BY references a non-projected, non-aliased name
**What goes wrong:** `SELECT a FROM f ORDER BY b` — `b` is not in the projected output. Should this work?

**SQL standard says:** ORDER BY can reference any column from the FROM table, not just the SELECT list. But idea.md SC-4 / SORT-03 / project.md says "ORDER BY operates on projected (post-projection) names, including aliases" — strict post-projection scope.

**Decision (LOCKED by SORT-03):** ORDER BY references must resolve to a projected name (column or alias). If `ORDER BY b` and `b` is not in the projection, the analyzer raises a parse-time error: `column "b" in ORDER BY not in SELECT list`.

**Test gate:** `SELECT a FROM f ORDER BY b` throws ParseError with that message.

### Pitfall 7: COUNT(*) parsing — `*` is not a wildcard projection here
**What goes wrong:** The lexer emits `*` as a `WILDCARD` token. Inside `COUNT(...)`, the parser must accept this `WILDCARD` as a valid argument. If `parseAggregate` only accepts `IDENT` for the function arg, `COUNT(*)` fails with a parse error.

**How to avoid:** `parseAggregate` recognizes `COUNT` `(` `WILDCARD` `)` as a special form, emitting `Aggregate { func: 'COUNT', arg: 'STAR' }`. Other aggregates (SUM/AVG/MIN/MAX) accept only IDENT (a column ref).

**Test gate:** `SELECT COUNT(*) FROM f` parses successfully (Phase 2 SC #1 starting query).

## Code Examples

### Example 1: Aggregate AST node (delta to `src/ast.js`)

```js
// Source: project's existing src/ast.js — ADD this factory.
//   Aggregate    { type: 'Aggregate', func: 'COUNT'|'SUM'|'AVG'|'MIN'|'MAX',
//                  arg: 'STAR' | ColumnRef }
//   OrderByItem  { type: 'OrderByItem', key: string, dir: 'ASC'|'DESC' }
//   LimitOffset  { type: 'LimitOffset', count: number, offset: number }
export function aggregate(func, arg) {
  return { type: 'Aggregate', func, arg };
}
export function orderByItem(key, dir) {
  return { type: 'OrderByItem', key, dir: dir ?? 'ASC' };
}
export function limitOffset(count, offset = 0) {
  return { type: 'LimitOffset', count, offset };
}
```

### Example 2: Parsing `COUNT(*)` and `SUM(field)` (delta to `src/parser.js`)

```js
// Source: extend parseProjectionItem() — when an IDENT matches an aggregate keyword,
// switch to parseAggregate; otherwise fall through to existing ColumnRef branch.
//
// AGGREGATES is recognised as a Set of IDENT *names*, NOT keywords (because they
// can be reused as identifiers in some SQL dialects; we keep them lower-priority
// than reserved KEYWORDs like FROM/WHERE).
const AGGREGATE_FUNCS = new Set(['COUNT', 'SUM', 'AVG', 'MIN', 'MAX']);

function parseAggregate(state) {
  const fnTok = consume(state); // IDENT — function name
  expect(state, 'PUNCT', '(');
  const next = peek(state);
  let arg;
  if (next.type === 'WILDCARD') {
    if (fnTok.value.toUpperCase() !== 'COUNT') {
      throw new ParseError(
        `${fnTok.value}(*) is not allowed; use ${fnTok.value}(<field>)`,
        next.col,
      );
    }
    consume(state);
    arg = 'STAR';
  } else {
    const idTok = expect(state, 'IDENT');
    arg = columnRef(idTok.value);
  }
  expect(state, 'PUNCT', ')');
  return aggregate(fnTok.value.toUpperCase(), arg);
}
```

### Example 3: Accumulator update (sketch for `src/accumulator.js`)

```js
// Source: derives from the bucket-shape pattern above + pitfalls.md Pitfall 3.
import { resolvePath } from './project.js'; // Phase 1 export

function groupKey(row, groupByCols) {
  const vals = groupByCols.map(c => resolvePath(row, c.path));
  return { vals, key: JSON.stringify(vals.map(v => [typeof v, v])) };
}

function newSlot(agg) {
  if (agg.func === 'COUNT' && agg.arg === 'STAR') return { kind: 'COUNT_STAR', count: 0 };
  if (agg.func === 'COUNT')                       return { kind: 'COUNT_FIELD', count: 0, path: agg.arg.path };
  if (agg.func === 'SUM')                         return { kind: 'SUM',  sum: 0, path: agg.arg.path };
  if (agg.func === 'AVG')                         return { kind: 'AVG',  sum: 0, count: 0, path: agg.arg.path };
  if (agg.func === 'MIN')                         return { kind: 'MIN',  value: undefined, hasValue: false, path: agg.arg.path };
  if (agg.func === 'MAX')                         return { kind: 'MAX',  value: undefined, hasValue: false, path: agg.arg.path };
  throw new Error(`unsupported aggregate: ${agg.func}`);
}

function warnNonNumeric(func, fieldName, value) {
  process.stderr.write(
    `whoodb: ${func} non-numeric value at field "${fieldName}" (got ${typeof value}), skipping row\n`
  );
}

function updateSlot(slot, row, fnName) {
  if (slot.kind === 'COUNT_STAR') { slot.count++; return; }
  const v = resolvePath(row, slot.path);
  if (v == null) return; // null/undefined treated identically; not counted
  if (slot.kind === 'COUNT_FIELD') { slot.count++; return; }
  if (typeof v !== 'number' || Number.isNaN(v)) {
    warnNonNumeric(fnName, slot.path.join('.'), v);
    return;
  }
  if (slot.kind === 'SUM') { slot.sum += v; return; }
  if (slot.kind === 'AVG') { slot.sum += v; slot.count++; return; }
  if (slot.kind === 'MIN') { if (!slot.hasValue || v < slot.value) { slot.value = v; slot.hasValue = true; } return; }
  if (slot.kind === 'MAX') { if (!slot.hasValue || v > slot.value) { slot.value = v; slot.hasValue = true; } return; }
}

function finalizeSlot(slot) {
  if (slot.kind === 'COUNT_STAR' || slot.kind === 'COUNT_FIELD') return slot.count;
  if (slot.kind === 'SUM')                                       return slot.sum;
  if (slot.kind === 'AVG')                                       return slot.count === 0 ? null : slot.sum / slot.count;
  if (slot.kind === 'MIN' || slot.kind === 'MAX')                return slot.hasValue ? slot.value : null;
}
```

### Example 4: Stable multi-key comparator (sketch for `src/sort.js`)

```js
// Source: pattern derived from architecture.md Pattern 4 + ECMAScript stable-sort guarantee.
export function buildComparator(orderByItems) {
  return (rowA, rowB) => {
    for (const { key, dir } of orderByItems) {
      const cmp = compareValues(rowA[key], rowB[key]);
      if (cmp !== 0) return dir === 'DESC' ? -cmp : cmp;
    }
    return 0; // equal under all keys → stable sort retains input order
  };
}

function compareValues(a, b) {
  if (a === b) return 0;
  if (a == null) return -1;     // nullish first (document this)
  if (b == null) return 1;
  if (typeof a === 'number' && typeof b === 'number') {
    if (Number.isNaN(a)) return Number.isNaN(b) ? 0 : -1;
    if (Number.isNaN(b)) return 1;
    return a - b;
  }
  if (typeof a === 'string' && typeof b === 'string') {
    return a < b ? -1 : 1;
  }
  // Mixed types: lex-compare string forms (rare in practice; document)
  const sa = String(a), sb = String(b);
  return sa === sb ? 0 : sa < sb ? -1 : 1;
}
```

### Example 5: Pipeline composition in `src/evaluator.js` (delta)

```js
// Source: extends the existing async generator. Replace the Phase 1 guards
// with route-on-flag dispatch.
export async function* execute(plan, filePath) {
  const useStream = plan.groupBy === null && plan.sort === null;
  if (useStream) {
    yield* runStreaming(plan, filePath);   // ← existing Phase 1 path + LIMIT/OFFSET early-term
    return;
  }
  // Buffered path
  const rows = await collectAfterWhere(plan, filePath); // raw rows that pass WHERE

  let result;
  if (plan.groupBy !== null || hasAggregates(plan.projection)) {
    result = finalizeBuckets(plan, accumulateGroups(plan, rows));
  } else {
    result = rows;
  }

  // Project AFTER finalize (so aliases exist for ORDER BY)
  result = result.map(r => project(plan.projection, r));

  if (plan.sort !== null) {
    result.sort(buildComparator(plan.sort));
  } else if (plan.groupBy !== null) {
    // AGGR-07 default: lex-sort by group keys when no user-supplied ORDER BY
    result.sort(buildGroupKeyComparator(plan.groupBy));
  }

  if (plan.limit !== null) {
    const { offset = 0, count } = plan.limit;
    result = result.slice(offset, offset + count);
  }

  for (const r of result) yield r;
}
```

## State of the Art

> Phase 2 doesn't introduce novel patterns. The only "currency check" worth flagging:

| Old approach | Current approach | When changed | Impact |
|---|---|---|---|
| `Array.prototype.sort` was historically unstable in V8 (pre-7.0) | Stable since V8 7.0 / Node 12 / ECMAScript 2019 | 2018–2019 (V8 7.0 in Chrome 70 / Node 12) | Project's Node ≥ 22.17.0 floor guarantees stability — DO NOT add tiebreaker indices (architecture.md Anti-Pattern 3) |
| Three-valued NULL logic in SQL standard (NULL = NULL → NULL) | This project uses two-valued logic (NULL comparisons → false) | Locked in Phase 1 (`src/where.js`) | Phase 2 inherits: SUM/MIN/MAX skip null inputs; group keys with null/undefined are kept distinct via type-tag, not collapsed to a single null bucket |

## Open Questions

### 1. Aggregate without GROUP BY — implicit `GROUP BY ()`?

**What we know:** Standard SQL treats `SELECT COUNT(*) FROM f` (no GROUP BY) as a single global bucket. Idea.md SC-1 includes `COUNT(*)` as a projection without requiring GROUP BY.

**What's unclear:** The current `analyze.js` PARSE-09 rule requires every projected column to be in GROUP BY OR wrapped in an aggregate. With ALL-aggregate projection and no GROUP BY clause, what does the analyzer set `plan.groupBy` to?

**Recommendation:** Add an `implicitGroupBy: true` flag to the ExecutionPlan when projection contains aggregates and no `GROUP BY` clause. The accumulator runs with a single bucket (groupKey `"[]"`). The single result row has only the aggregate values (no group columns). This is the standard-SQL semantics. **Phase 2 plan should bake this in from the start.**

**Test gate:** `SELECT COUNT(*) FROM 'fixture'` → 1 row with `{ 'COUNT(*)': N }` (or alias if AS is used).

### 2. Lexer treats AGGREGATE function names as IDENT, not KEYWORD — is that correct?

**What we know:** The Phase 1 lexer KEYWORDS set contains `SELECT, FROM, WHERE, AND, OR, NOT, IN, LIKE, BETWEEN, AS, GROUP, BY, ORDER, LIMIT, OFFSET, ASC, DESC, TRUE, FALSE, NULL`. It does NOT include `COUNT, SUM, AVG, MIN, MAX`.

**What's unclear:** Should aggregate function names be reserved keywords? If yes, lexer adds them; if no, parser must check IDENT values against an aggregate-function set.

**Recommendation:** Keep aggregates as IDENT. Aggregate names are not strictly reserved in SQL — `COUNT` is sometimes valid as a column name in dialects. Treat them as a parser-level set: when parsing a projection item, if it's an IDENT followed by `(`, check if the IDENT name matches `AGGREGATE_FUNCS` and route to `parseAggregate`; otherwise it's a regular ColumnRef.

**Test gate:** `SELECT count FROM f` (where `count` is a field name) parses as a regular ColumnRef.

### 3. AGGR-07 emission order vs user ORDER BY

**What we know:** roadmap.md / requirements.md say "GROUP BY emission order is deterministic (group keys sorted lexicographically)". idea.md SC-2 / project.md say the same. But what happens when the user supplies their own ORDER BY?

**Recommendation:** **User ORDER BY wins.** The "sorted lexicographically" rule is the DEFAULT when no ORDER BY is specified, ensuring deterministic output even without an explicit sort. When ORDER BY is present, `plan.sort` drives the order and the AGGR-07 default is bypassed.

**Test gate:** Phase 2 SC #1 query has `ORDER BY out DESC LIMIT 5` — the user's ORDER BY wins, and the test asserts `out` descending order. A separate test with no ORDER BY asserts lex-sorted group key order.

### 4. PAGE-03 verification — how to prove early termination

**What we know:** PAGE-03 says "the streaming pipeline halts after the row cap is reached" (SUCCESS CRITERION #4 + "does not scan the full file").

**What's unclear:** A test that simply asserts `out.length === LIMIT` does not prove the file wasn't fully read.

**Recommendation:** Add a test-only hook to `execute()` — accept an optional 3rd argument `{onLineRead?: (lineNo) => void}`. The test passes a counter callback, then asserts `counter < fileTotalLines`. Alternative: use a fixture file padded with garbage rows after the LIMIT-th valid row, so reading the full file would emit warnings the test can detect.

**Decision:** Phase 2 plan picks one. Recommend the callback hook — cleaner, no fixture pollution.

### 5. NUMBER literal in LIMIT/OFFSET — only positive integers?

**What we know:** PAGE-01 says "LIMIT accepts a non-negative integer". Lexer emits NUMBER tokens for both integers and floats.

**Recommendation:** Analyzer (or parser) checks: `Number.isInteger(value) && value >= 0`. If not, throw ParseError. **Defer the parse-vs-analyze choice to the planner** — the parser CAN do this check inline (`expect(state, 'NUMBER')` then validate), or the analyzer can check after AST construction.

**Test gate:** `LIMIT 1.5` and `LIMIT -3` both throw ParseError.

## Validation Architecture

> `workflow.nyquist_validation` is NOT set to `true` in `.planning/config.json` (the workflow keys present are `research`, `plan_check`, `verifier`, `auto_advance`). Skipping this section — but for the planner's reference:

**Test framework:** `node --test` (Node ≥ 22.17.0 builtin), no config file. Existing `package.json` script: `node --test test/*.js`.

**Quick run command:** `node --test test/accumulator.test.js test/sort.test.js test/parser.test.js test/analyze.test.js test/evaluator.test.js`

**Full suite:** `npm test` (alias for `node --test test/*.js`).

**Test infrastructure already exists** — Phase 1 delivered 6 test files and 58 passing tests. Phase 2 extends those existing files and adds 2 new ones. No Wave 0 framework setup needed.

## Phase 2 file impact summary

**Modify (extend, don't rewrite):**

- `src/ast.js` — ADD `aggregate()`, `orderByItem()`, `limitOffset()` factories. Update top-of-file comment to document new shapes.
- `src/parser.js` — ADD `parseAggregate()`, `parseOrderBy()`, `parseLimit()`. EXTEND `parseProjectionItem()` to detect aggregate function calls. REMOVE the Phase 1 throw on `ORDER` / `LIMIT` / `OFFSET` (currently rejects them; replace with parsing).
- `src/analyze.js` — POPULATE `plan.sort` and `plan.limit` (currently always null). EXTEND PARSE-09 rule to handle the implicit-GROUP-BY-() case. ADD ORDER BY post-projection scope check (Pitfall 6).
- `src/evaluator.js` — REPLACE the three Phase 1 guards (`groupBy/sort/limit !== null` throws) with dispatch to `runStreaming` (existing path + LIMIT early-term) vs `runBuffered` (new). ADD `runStreaming` LIMIT/OFFSET. CALL accumulator + sort + slice in the buffered path.

**Create:**

- `src/accumulator.js` — group-key, bucket creation, slot updates, finalize. ~150 lines.
- `src/sort.js` — `buildComparator()` for OrderByItem[], plus the value comparison helper. ~50 lines.
- `test/accumulator.test.js` — type-tagged keys, COUNT(*) vs COUNT(field), SUM with non-numeric warn+skip, AVG empty-input null, MIN/MAX. Phase 2 SC #2 + SC #3.
- `test/sort.test.js` — single-key ASC/DESC, multi-key, stability gate, nullish handling.

**Touch fixtures:**

- `fixtures/sample.jsonl` — Phase 1 fixture has 12 rows. May need additional rows to exercise Phase 2 SC #2 (mixed-type group key) and SC #4 (file longer than LIMIT). **Recommend a separate fixture: `fixtures/aggregates.jsonl`** with shapes designed for Phase 2 (agent column with mixed-type values, usage.output_tokens for SUM, deliberately longer than 50 rows for early-termination verification).

## Sources

### Primary (HIGH confidence)
- `.planning/research/architecture.md` — full system architecture, Pattern 4 (Group Accumulator), Pattern 3 (Streaming), Anti-Pattern 3 (no tiebreaker), Anti-Pattern 5 (project before sort) — local file, HIGH
- `.planning/research/pitfalls.md` — Pitfall 3 (GROUP BY type-tagged keys), Pitfall 7 (NOT precedence — already done in Phase 1, but applies if we add HAVING), Performance Trap (sort comparator allocation), "Looks Done But Isn't" gates — local file, HIGH
- `.planning/research/stack.md` — Node ≥ 22.17.0 floor, builtin-only — local file, HIGH
- `.planning/idea.md` — locked behavior: SUM warn+skip, AVG-all-NaN null, stable ORDER BY, deterministic group order, in-memory aggregation, no streaming GROUP BY — local file, HIGH
- `.planning/requirements.md` — AGGR-01..09, SORT-01..04, PAGE-01..03 — local file, HIGH
- `.planning/phases/01-lexer-parser-core-evaluator/*` — Phase 1 contracts (AST, ExecutionPlan, evaluator guards, NULL policy) — local files, HIGH
- Phase 1 source code (`src/{ast,parser,analyze,evaluator,where,project,lexer}.js`) — direct read, HIGH
- ECMAScript stable-sort guarantee — Node 12+ / V8 7.0+ / ES2019 — referenced in architecture.md, HIGH

### Secondary (MEDIUM confidence)
- None new for Phase 2. All claims trace back to either project-level research, idea.md, or first-principles JS semantics (typeof, JSON.stringify, Number.isNaN).

### Tertiary (LOW confidence — flagged for validation)
- The exact JSON.stringify behavior for `[null]` vs `[undefined]` — confidently MEDIUM (well-documented JSON behavior, undefined → null in array context per ECMA-404). The type-tag formula side-steps this entirely so the open question is resolved by design.
- PAGE-03 verification approach (callback vs file-size) — implementation choice, not a knowledge gap.

## Infrastructure Dependencies

**None.** Phase 2 is pure-Node with no external services or Docker. All tests run against in-process JSONL fixtures, same as Phase 1.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — zero new deps, all builtins. Locked by Phase 1.
- Architecture: HIGH — extends existing AST-direct evaluator, no IR introduced. Patterns lifted from `.planning/research/architecture.md`.
- Pitfalls: HIGH — type-tagged group keys, AVG empty-input null, stable sort, project-before-sort, COUNT(*) parsing — all explicit in upstream research and SQL standard.
- Phase 1 integration: HIGH — Phase 1 source read directly, integration points verified (the three `if (plan.X !== null) throw` guards in `evaluator.js` are the explicit replacement seam).

**Research date:** 2026-05-02
**Valid until:** 2026-06-02 (30 days — Node engine and builtins are stable; no fast-moving deps)

---

*Phase 2 research complete: 2026-05-02 — emits deltas over project-level research; defers to `.planning/research/*` for broad-territory material.*
