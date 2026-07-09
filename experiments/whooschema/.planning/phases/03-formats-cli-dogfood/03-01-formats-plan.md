---
phase: 03-formats-cli-dogfood
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/formats.js
  - src/keyword-handlers.js
autonomous: true
requirements: [FMT-01, FMT-02, FMT-03, FMT-04, FMT-05, FMT-06]
change_class: feature

must_haves:
  truths:
    - "validate({format:'email'}, 'not-an-email') returns { valid: false } with errors[0].rule === 'format' and errors[0].expected === 'email' (FMT-01)"
    - "validate({format:'email'}, 'a@b.io') returns { valid: true } (FMT-01 happy path)"
    - "validate({format:'uri'}, 'not a url') returns { valid: false }; validate({format:'uri'}, 'https://example.com/path') returns { valid: true } (FMT-02)"
    - "validate({format:'date'}, '2024-02-30') returns { valid: false } — calendar validation rejects the rolled-over date that new Date() silently accepts (FMT-03 + Pitfall 9a)"
    - "validate({format:'date'}, '2024-02-29') returns { valid: true } and validate({format:'date'}, '2023-02-29') returns { valid: false } — leap-year math is correct (FMT-03)"
    - "validate({format:'date-time'}, '2024-01-15T25:00:00Z') returns { valid: false } — hour out of range; validate({format:'date-time'}, '2024-01-15T12:00:00Z') returns { valid: true } (FMT-04)"
    - "validate({format:'uuid'}, '550e8400-e29b-41d4-a716-446655440000') returns { valid: true }; validate({format:'uuid'}, 'not-a-uuid') returns { valid: false } (FMT-05)"
    - "validate({format:'phone'}, 'whatever') returns { valid: true } — unknown formats are silently ignored per spec (FMT-06)"
    - "validate({format:'email'}, 42) returns { valid: true } — format applies only to strings (non-string is a no-op, format check is type-guarded)"
    - "All 61 existing Phase 1+2 tests still pass via `node --test` — Phase 3 adds zero regressions"
  artifacts:
    - path: "src/formats.js"
      provides: "FORMATS map (email/uri/date/date-time/uuid) + validateFormat dispatcher (FMT-01..06)"
      exports: ["FORMATS", "validateFormat"]
      contains: "EMAIL_RE"
      min_lines: 60
    - path: "src/keyword-handlers.js"
      provides: "validateString now calls validateFormat after pattern check (Phase 3 wire-up)"
      contains: "validateFormat"
      min_lines: 290
  key_links:
    - from: "src/keyword-handlers.js"
      to: "src/formats.js"
      via: "import { validateFormat } from './formats.js'"
      pattern: "from ['\"]\\./formats\\.js['\"]"
    - from: "src/formats.js"
      to: "src/error-utils.js"
      via: "import { makeError } from './error-utils.js'"
      pattern: "from ['\"]\\./error-utils\\.js['\"]"
---

<objective>
Add the five JSON Schema `format` validators (`email`, `uri`, `date`, `date-time`, `uuid`) as a pure pluggable map in `src/formats.js`, and wire them into `validateString` via a single `validateFormat` call. Unknown formats are silently ignored per Draft-07 spec.

Purpose: Phase 1+2 validation is feature-complete for type/composition/$ref. This plan closes the format-keyword half of Phase 3 with surgical, low-risk changes — one new file plus one one-line addition to an existing handler. The format dispatcher is intentionally pluggable (future formats can be added by appending to the FORMATS map without touching `keyword-handlers.js`). The five validators encode the "defensible pragmatic" formulas from `.planning/research/pitfalls.md` Pitfall 9 — anchored regex + manual calendar math, NOT the Date constructor (which silently rolls 2024-02-30 to March 1).

Output:
- `src/formats.js` (NEW) — exports `FORMATS` (map of validators) and `validateFormat` (dispatcher).
- `src/keyword-handlers.js` (MODIFIED) — adds `import { validateFormat } from './formats.js';` and a single `validateFormat(schema, data, path, errors);` call at the end of `validateString` (after the existing `pattern` check on line 100).
- All 61 existing Phase 1+2 tests still pass (`node --test`); no test files are modified or added in this plan — tests come in Plan 03-03.
</objective>

<execution_context>
@./.claude/pan-wizard-core/workflows/execute-plan.md
@./.claude/pan-wizard-core/templates/summary.md
</execution_context>

<context>
@.planning/project.md
@.planning/roadmap.md
@.planning/state.md
@.planning/requirements.md
@.planning/phases/03-formats-cli-dogfood/03-research.md
@.planning/research/pitfalls.md
@.planning/research/architecture.md
@src/keyword-handlers.js
@src/error-utils.js
@src/schema-loader.js

<interfaces>
<!-- Phase 1+2 contract (already shipped — DO NOT change anything outside this plan's files_modified) -->

makeError signature (from src/error-utils.js):
```js
export function makeError(path, rule, message, value, expected?) -> ValidationError
// ValidationError: { path, rule, message, value, expected? }
```

validateString current shape (src/keyword-handlers.js lines 62-101):
```js
export function validateString(schema, data, path, errors) {
  if (typeof data !== 'string') return;
  // ... existing minLength / maxLength / pattern checks (lines 64-100, unchanged) ...
  // Phase 3 inserts validateFormat call HERE, just before the closing brace.
}
```

KNOWN_KEYWORDS already includes 'format' (src/schema-loader.js line 23) — no schema-loader changes needed.

<!-- Phase 3 target contract (this plan establishes) -->

src/formats.js exports:
```js
export const FORMATS = { email, uri, date, 'date-time', uuid };  // five string-keyed validators
export function validateFormat(schema, data, path, errors) -> void;
//   - Returns immediately if schema.format is not a string (no-op for non-string-typed schemas).
//   - Returns immediately if data is not a string (format is string-only per spec).
//   - Returns immediately if FORMATS[schema.format] is undefined (FMT-06: unknown format silent-pass).
//   - Otherwise calls the validator and pushes a single { rule:'format', expected: schema.format } error on failure.
```

<!-- Pitfall 9 mitigations encoded here -->
- email: pragmatic regex (no quoted local parts, no IP literals) — RFC-perfect is not the goal.
- uri:   `new URL(v)` constructor inside try/catch — accepts mailto/ftp/https; rejects 'not a url' and bare relative paths.
- date:  anchored regex YYYY-MM-DD + per-field range + LEAP YEAR math — Date constructor rolls over silently.
- date-time: anchored RFC 3339 regex + calendar+time range — toISOString round-trip is unreliable.
- uuid:  case-insensitive RFC 4122 v1-v5 (any version digit, NOT v4-only).

<!-- Performance constraint (PERF-01 sets the budget) -->
All format regexes (EMAIL_RE, UUID_RE, DATE_RE, DATE_TIME_RE) MUST be module-level `const` so they compile once per process. Per-call regex compilation is a known performance trap (.planning/research/pitfalls.md Performance Traps).
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Create src/formats.js with FORMATS map + validateFormat dispatcher</name>
  <files>src/formats.js</files>
  <action>
Create the new file `src/formats.js` exactly as specified below. This is a self-contained module with one external dependency: `makeError` from `src/error-utils.js`. No tests are written here — Plan 03-03 covers tests.

Five validators are encoded with the "defensible pragmatic" formulas from `.planning/research/pitfalls.md` Pitfall 9. Read pitfalls.md Pitfall 9 if you need rationale for any individual validator's shape — do NOT add RFC-compliance complexity beyond what is below.

Reference implementation (from 03-research.md §"Pattern 1: Format Table" — write this file with light edits OK, but the regex literals, leap-year math, and FORMATS keys MUST match exactly):

```js
// src/formats.js
//
// Format validators per JSON Schema Draft-07 § 7.3.
// FMT-01..05: five validators (email, uri, date, date-time, uuid).
// FMT-06:     unknown formats no-op silently per spec.
// All validators receive a string and return true on valid, false on invalid.
// Non-string values cause format to be skipped — validateString already type-guards
// before reaching us, but validateFormat below also type-guards defensively.
//
// Pitfall 9 mitigations encoded here (.planning/research/pitfalls.md):
//   - email:     pragmatic regex (no quoted local parts, no IP literals).
//   - uri:       `new URL()` constructor (catches malformed; mailto:/ftp:/https: all pass).
//   - date:      regex anchors + numeric range + LEAP YEAR check (Date constructor
//                silently rolls 2024-02-30 to March 1 — verified locally).
//   - date-time: regex with capture groups + per-field range check.
//   - uuid:      case-insensitive RFC 4122 v1-v5 (any version digit).
//
// Performance: All regex literals are module-level const so they compile ONCE per
// process. Per-call recompilation is a known perf trap.

import { makeError } from './error-utils.js';

// Pragmatic email — RFC 5322 "simple form": local@domain.tld
// Rejects whitespace, requires @ and at least one dot in the domain.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// UUID — RFC 4122 v1-v5 (any version digit, case-insensitive).
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ISO 8601 calendar date YYYY-MM-DD — anchored.
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

// RFC 3339 date-time: YYYY-MM-DDTHH:MM:SS(.sss)?(Z|±HH:MM)
const DATE_TIME_RE =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-]\d{2}:\d{2})$/i;

function isValidCalendarDate(y, m, d) {
  // Month: 1-12. Day: 1-31, with month-specific limits and leap year for Feb.
  if (m < 1 || m > 12) return false;
  if (d < 1 || d > 31) return false;
  const daysInMonth = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  let max = daysInMonth[m - 1];
  if (m === 2) {
    const isLeap = (y % 4 === 0 && y % 100 !== 0) || (y % 400 === 0);
    if (isLeap) max = 29;
  }
  return d <= max;
}

export const FORMATS = {
  email: (v) => EMAIL_RE.test(v),
  uri: (v) => {
    try { new URL(v); return true; } catch { return false; }
  },
  uuid: (v) => UUID_RE.test(v),
  date: (v) => {
    const m = DATE_RE.exec(v);
    if (!m) return false;
    return isValidCalendarDate(Number(m[1]), Number(m[2]), Number(m[3]));
  },
  'date-time': (v) => {
    const m = DATE_TIME_RE.exec(v);
    if (!m) return false;
    const [, y, mo, d, hh, mm, ss] = m;
    if (!isValidCalendarDate(Number(y), Number(mo), Number(d))) return false;
    const H = Number(hh), M = Number(mm), S = Number(ss);
    // Allow leap second :60 per RFC 3339 §5.6.
    return H <= 23 && M <= 59 && S <= 60;
  }
};

/**
 * Apply a `format` constraint to a string value.
 *
 * Pre-conditions:
 *   - schema.format must be a string. Otherwise: no-op.
 *   - data must be a string. Otherwise: no-op (format only applies to strings per spec).
 *   - FORMATS[schema.format] must be defined. If not: no-op (FMT-06: unknown format silent-pass).
 *
 * On failure, pushes a single { rule:'format', expected: schema.format } error
 * onto the shared `errors` array.
 *
 * Closes FMT-01..06.
 */
export function validateFormat(schema, data, path, errors) {
  if (typeof schema.format !== 'string') return;
  if (typeof data !== 'string') return;          // format applies only to strings
  const checker = FORMATS[schema.format];
  if (!checker) return;                          // FMT-06: unknown format is silent
  if (!checker(data)) {
    errors.push(
      makeError(
        path,
        'format',
        `value does not match format "${schema.format}"`,
        data,
        schema.format
      )
    );
  }
}
```

Implementation notes:
- The five FORMATS keys MUST be exactly: `email`, `uri`, `uuid`, `date`, `'date-time'` (note: `date-time` is hyphenated and string-quoted because it is not a valid JS identifier).
- `EMAIL_RE`, `UUID_RE`, `DATE_RE`, `DATE_TIME_RE` MUST be `const` at module scope. Do NOT inline-construct `new RegExp(...)` inside the validator functions — that would recompile per call (perf trap).
- The leap-year formula is `(y % 4 === 0 && y % 100 !== 0) || (y % 400 === 0)` — do NOT simplify to `y % 4 === 0` (would falsely accept 1900-02-29).
- The UUID regex uses the `/i` case-insensitive flag — that is fine because format regexes are author-written, not user-supplied. (Phase 1 forbids `/i` etc on user-supplied `pattern` only.)
- The `uri` validator uses try/catch around `new URL(v)`. Do NOT also try to parse the result — `new URL('mailto:a@b')` succeeds and that is correct per spec.
- File expected size: ~70-90 lines including header comment. Aim under 100.
- Do NOT export `EMAIL_RE` / `UUID_RE` / etc. — they are implementation details.
- Do NOT import anything from `validator-core.js` (would create a circular dep).

DO NOT modify `src/keyword-handlers.js` in this task — Task 2 wires it up. Keeping these as two atomic commits makes the diff trivially auditable.

Commit message: `feat(phase-03-01): add src/formats.js with email/uri/date/date-time/uuid validators (FMT-01..06)`
  </action>
  <verify>
    <automated tier="T1">node -e "import('./src/formats.js').then((m) => { if (typeof m.validateFormat !== 'function') throw new Error('validateFormat not exported'); if (!m.FORMATS || typeof m.FORMATS !== 'object') throw new Error('FORMATS not exported'); const required = ['email','uri','uuid','date','date-time']; for (const k of required) { if (typeof m.FORMATS[k] !== 'function') throw new Error('missing FORMATS[' + k + ']'); } if (m.FORMATS.email('a@b.io') !== true) throw new Error('email happy-path failed'); if (m.FORMATS.email('not-an-email') !== false) throw new Error('email reject failed'); if (m.FORMATS.uri('https://example.com/x') !== true) throw new Error('uri happy-path failed'); if (m.FORMATS.uri('not a url') !== false) throw new Error('uri reject failed'); if (m.FORMATS.date('2024-01-15') !== true) throw new Error('date happy-path failed'); if (m.FORMATS.date('2024-02-30') !== false) throw new Error('date 2024-02-30 calendar reject failed (Pitfall 9a)'); if (m.FORMATS.date('2024-02-29') !== true) throw new Error('date leap-year accept failed'); if (m.FORMATS.date('2023-02-29') !== false) throw new Error('date non-leap-year reject failed'); if (m.FORMATS['date-time']('2024-01-15T12:00:00Z') !== true) throw new Error('date-time happy-path failed'); if (m.FORMATS['date-time']('2024-01-15T25:00:00Z') !== false) throw new Error('date-time hour-OOR reject failed'); if (m.FORMATS.uuid('550e8400-e29b-41d4-a716-446655440000') !== true) throw new Error('uuid happy-path failed'); if (m.FORMATS.uuid('not-a-uuid') !== false) throw new Error('uuid reject failed'); /* unknown format silent-pass via dispatcher */ const errs = []; m.validateFormat({format:'phone'}, 'whatever', '$', errs); if (errs.length !== 0) throw new Error('FMT-06 failed: unknown format "phone" produced errors: ' + JSON.stringify(errs)); /* dispatcher non-string is no-op */ const errs2 = []; m.validateFormat({format:'email'}, 42, '$', errs2); if (errs2.length !== 0) throw new Error('non-string data should be no-op'); /* dispatcher pushes one error on failure */ const errs3 = []; m.validateFormat({format:'email'}, 'not-an-email', '$', errs3); if (errs3.length !== 1 || errs3[0].rule !== 'format' || errs3[0].expected !== 'email') throw new Error('failure error shape wrong: ' + JSON.stringify(errs3)); console.log('OK src/formats.js — 5 validators + dispatcher behave correctly'); })"</automated>
  </verify>
  <done>`src/formats.js` exists and exports `FORMATS` (with all 5 keys) and `validateFormat`. Each of the 5 validators returns `true` on a happy-path string and `false` on the deliberate reject case. Calendar validation rejects 2024-02-30 (Pitfall 9a). Leap-year math accepts 2024-02-29 and rejects 2023-02-29. `validateFormat({format:'phone'}, 'x', '$', [])` returns silently with no error pushed (FMT-06). `validateFormat({format:'email'}, 'not-an-email', '$', errs)` pushes exactly one error with `rule:'format'` and `expected:'email'`. The verify command above passes. The file is committed as one atomic commit.</done>
</task>

<task type="auto">
  <name>Task 2: Wire validateFormat into validateString in src/keyword-handlers.js</name>
  <files>src/keyword-handlers.js</files>
  <action>
Make a surgical, two-line change to `src/keyword-handlers.js` to call `validateFormat` from inside `validateString`. NO OTHER CHANGES to this file.

Step 1: Add the import. Near the top (around line 18-19, with the other imports), add:

```js
import { validateFormat } from './formats.js';
```

The full top-of-file import block AFTER this change should read:

```js
import { makeError, appendKey, appendIndex } from './error-utils.js';
import { validateNode } from './validator-core.js';
import { validateFormat } from './formats.js';
```

Step 2: Add the validateFormat call at the END of validateString. Locate the closing `}` of `validateString` (currently line 101 — the closing brace of the function body, after the final `}` of the `if (typeof schema.pattern === 'string')` block). Insert ONE call line, just before the function's closing brace:

```js
  // Phase 3: format check after pattern. Last in validateString so any pattern
  // error emits before any format error (deterministic order via path lex sort).
  validateFormat(schema, data, path, errors);
}
```

After this change, validateString should look like:

```js
export function validateString(schema, data, path, errors) {
  if (typeof data !== 'string') return;
  if (typeof schema.minLength === 'number' && [...data].length < schema.minLength) {
    // ... unchanged ...
  }
  if (typeof schema.maxLength === 'number' && [...data].length > schema.maxLength) {
    // ... unchanged ...
  }
  if (typeof schema.pattern === 'string') {
    // ... unchanged ...
  }
  // Phase 3: format check after pattern.
  validateFormat(schema, data, path, errors);
}
```

DO NOT change:
- Any other function in `keyword-handlers.js` (validateType, validateEnum, validateNumber, validateArray, validateObject, canonicalize).
- The Phase 1 pitfall comments at the top of the file (lines 1-17). You MAY add a single line documenting the Phase 3 addition at the top comment (e.g. add `//   #9  format over/under-engineering (validateFormat dispatcher in formats.js)` to the pitfall list around line 16) — this is optional.
- The function signatures or any export names.
- The order of the existing minLength / maxLength / pattern checks.

Verification step (run before committing):
1. `node --test` — must report 61 passing tests, 0 failures (Phase 1: 40 + Phase 2: 21 = 61).
2. The format dispatcher must now wire end-to-end via the public `validate()` API (verify command below).

Commit message: `feat(phase-03-01): wire validateFormat into validateString (FMT-01..06 end-to-end)`
  </action>
  <verify>
    <automated tier="T1">node --test &amp;&amp; node -e "import('./src/validate.js').then(({ validate }) => { /* end-to-end via public API */ const cases = [[{format:'email'}, 'not-an-email', false, 'email'], [{format:'email'}, 'a@b.io', true, null], [{format:'uri'}, 'not a url', false, 'uri'], [{format:'uri'}, 'https://example.com/x', true, null], [{format:'date'}, '2024-02-30', false, 'date'], [{format:'date'}, '2024-02-29', true, null], [{format:'date'}, '2023-02-29', false, 'date'], [{format:'date-time'}, '2024-01-15T25:00:00Z', false, 'date-time'], [{format:'date-time'}, '2024-01-15T12:00:00Z', true, null], [{format:'uuid'}, '550e8400-e29b-41d4-a716-446655440000', true, null], [{format:'uuid'}, 'not-a-uuid', false, 'uuid'], [{format:'phone'}, 'anything', true, null], [{format:'email'}, 42, true, null]]; for (const [schema, data, expectValid, expectExpected] of cases) { const r = validate(schema, data); if (r.valid !== expectValid) throw new Error('validate(' + JSON.stringify(schema) + ', ' + JSON.stringify(data) + ').valid expected ' + expectValid + ' got ' + r.valid + ' errors=' + JSON.stringify(r.errors)); if (!expectValid) { if (r.errors[0].rule !== 'format') throw new Error('rule expected format, got ' + r.errors[0].rule); if (r.errors[0].expected !== expectExpected) throw new Error('expected field expected ' + expectExpected + ', got ' + r.errors[0].expected); } } /* SC-1 explicit assertion: rule is 'format', not 'pattern' or anything else */ const r = validate({format:'email'}, 'not-an-email'); if (r.errors.length !== 1) throw new Error('expected exactly 1 error from format failure, got: ' + r.errors.length); console.log('OK end-to-end format dispatch: 13 cases passed'); })"</automated>
  </verify>
  <done>`src/keyword-handlers.js` imports `validateFormat` from `./formats.js` and calls it once at the end of `validateString`. The full test suite passes via `node --test` (61 tests, 0 failures — no regressions in Phase 1 or 2). The end-to-end public API verify command above passes all 13 cases including SC-1 (email rejects "not-an-email"), Pitfall 9a (date rejects "2024-02-30"), and FMT-06 (unknown format "phone" silently passes). The change is committed as one atomic commit.</done>
</task>

</tasks>

<verification>
After both tasks:

1. `node --test` from project root: 61 passing tests, 0 failures (Phase 1: 40, Phase 2: 21 — no Phase 3 tests yet).
2. End-to-end format dispatch via public API works for all 5 formats:
   - `validate({format:'email'}, 'not-an-email').valid === false` (FMT-01, SC-1)
   - `validate({format:'uri'}, 'not a url').valid === false` (FMT-02, SC-1)
   - `validate({format:'date'}, '2024-02-30').valid === false` (FMT-03, SC-1, Pitfall 9a)
   - `validate({format:'date-time'}, '2024-01-15T25:00:00Z').valid === false` (FMT-04, SC-1)
   - `validate({format:'uuid'}, 'not-a-uuid').valid === false` (FMT-05, SC-1)
3. Unknown format silently ignored: `validate({format:'phone'}, 'anything').valid === true` (FMT-06).
4. Format on non-string is a no-op: `validate({format:'email'}, 42).valid === true` (type-guard correct).
5. Format error shape: `errors[0].rule === 'format'`, `errors[0].expected` is the format name (e.g. `'email'`).
6. No regressions: all 61 Phase 1+2 tests still pass.
7. Two atomic commits — `feat(phase-03-01): add src/formats.js ...` and `feat(phase-03-01): wire validateFormat ...`.
</verification>

<success_criteria>
- [ ] `src/formats.js` exists, exports `FORMATS` and `validateFormat`, has the five FORMATS keys
- [ ] `EMAIL_RE`, `UUID_RE`, `DATE_RE`, `DATE_TIME_RE` are module-level `const` (not constructed per call)
- [ ] Leap-year math is correct: 2024-02-29 valid, 2023-02-29 invalid, 1900-02-29 invalid, 2000-02-29 valid
- [ ] `validateFormat` no-ops when schema.format is not a string, when data is not a string, or when format is unknown (FMT-06)
- [ ] On failure, `validateFormat` pushes exactly one error with `rule:'format'` and `expected:` = format name
- [ ] `src/keyword-handlers.js` imports `validateFormat` and calls it once at the end of `validateString`
- [ ] No other changes to `src/keyword-handlers.js` (validateType, validateEnum, validateNumber, validateArray, validateObject unchanged)
- [ ] All 61 Phase 1+2 tests still pass: `node --test`
- [ ] FMT-01..06 are demonstrably closed end-to-end via the public `validate()` API
- [ ] Two atomic commits (one per task)
</success_criteria>

<output>
After completion, create `.planning/phases/03-formats-cli-dogfood/03-01-summary.md` documenting:
- New file `src/formats.js`: exports `FORMATS` map and `validateFormat` dispatcher; five formats; locked regex literals; leap-year formula.
- One-line wire-up in `src/keyword-handlers.js`: `validateFormat(schema, data, path, errors)` at end of `validateString`; new import.
- Confirmation that all 61 Phase 1+2 tests still pass (no regressions).
- Confirmation that FMT-01..06 are demonstrably closed end-to-end via public API (smoke test results from the verify command).
- Note for Plan 03-02: the CLI's dogfood smoke test can now use `format: uri` / etc. in `dogfood/config.schema.json` if needed — but for the actual `.planning/config.json` shape, formats are NOT required (the schema is type/enum/required/additionalProperties only). The format infrastructure is in place if Plan 03-02 chooses to use it; otherwise it stands ready for the test suite in Plan 03-03.
- Note for Plan 03-03: the format test file (`test/format.test.js`) should cover all 5 happy-paths, all 5 deliberate rejects, the leap-year corner cases, the FMT-06 unknown-format case, and the non-string no-op case. Reference the test list in `03-research.md` §"Test pattern for FMT-01..06".
</output>
