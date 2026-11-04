# Decimal Phase Calculation

Calculate the next decimal phase number for urgent insertions.

## Using pan-tools

```bash
# Get next decimal phase after phase 6
node ~/.claude/pan-wizard-core/bin/pan-tools.cjs phase next-decimal 6
```

Output:
```json
{
  "found": true,
  "base_phase": "06",
  "next": "06.1",
  "existing": []
}
```

With existing decimals:
```json
{
  "found": true,
  "base_phase": "06",
  "next": "06.3",
  "existing": ["06.1", "06.2"]
}
```

## Extract Values

```bash
DECIMAL_PHASE=$(node ~/.claude/pan-wizard-core/bin/pan-tools.cjs phase next-decimal "${AFTER_PHASE}" --raw)
BASE_PHASE="${DECIMAL_PHASE%.*}"
```

Or with --raw flag:
```bash
DECIMAL_PHASE=$(node ~/.claude/pan-wizard-core/bin/pan-tools.cjs phase next-decimal "${AFTER_PHASE}" --raw)
# Returns just: 06.1
```

## Examples

| Existing Phases | After | Next Phase |
|-----------------|-------|------------|
| 06 only | 06 | 06.1 |
| 06, 06.1 | 06 | 06.2 |
| 06, 06.1, 06.2 | 06 | 06.3 |
| 06, 06.1, 06.3 (gap) | 06 | 06.4 |
| 29, 29.4 | 29.4 | 29.5 (the next sibling) |
| 29, 29.4, 29.5 | 29.4 | 29.4.1 (`nested: true`: 29.5 is taken) |

Numbers already used by a phase directory or by a `### Phase N` heading in roadmap.md are never handed out again.

## Inserting the phase

Insert with `phase insert`, not by creating the directory yourself. It picks the same number `next-decimal` reports, creates `.planning/phases/<number>-<slug>/`, and writes the roadmap's detail section, checklist entry and Progress row, with the phase depending on the one before it:

```bash
node ~/.claude/pan-wizard-core/bin/pan-tools.cjs phase insert "${AFTER_PHASE}" "$DESCRIPTION"
```

Example: `.planning/phases/06.1-fix-critical-auth-bug/`. Do not create phase directories by hand: a directory with no roadmap section, Progress row or dependency is a phase the rest of PAN cannot see.
