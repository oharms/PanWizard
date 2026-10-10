# Phase Argument Parsing

Parse and normalize phase arguments for commands that operate on phases.

## Extraction

From `$ARGUMENTS`:
- Extract phase number (first numeric argument)
- Extract flags (prefixed with `--`)
- Remaining text is description (for insert/add commands)

## Using pan-tools

The `find-phase` command handles normalization and validation in one step:

```bash
PHASE_INFO=$(node ~/.claude/pan-wizard-core/bin/pan-tools.cjs find-phase "${PHASE}")
```

Returns JSON with:
- `found`: true/false
- `directory`: Phase directory, relative to the project root (e.g., ".planning/phases/06-foundation")
- `phase_number`: Normalized number (e.g., "06", "06.1")
- `phase_name`: Name portion (e.g., "foundation")
- `plans`: Array of plan file names (e.g., "06-01-plan.md")
- `summaries`: Array of summary file names (e.g., "06-01-summary.md")

## Manual Normalization (Legacy)

Zero-pad integer phases to 2 digits. Preserve decimal suffixes.

```bash
# Normalize phase number
if [[ "$PHASE" =~ ^[0-9]+$ ]]; then
  # Integer: 8 → 08
  PHASE=$(printf "%02d" "$((10#$PHASE))")
elif [[ "$PHASE" =~ ^([0-9]+)\.([0-9]+)$ ]]; then
  # Decimal: 2.1 → 02.1
  PHASE=$(printf "%02d.%s" "$((10#${BASH_REMATCH[1]}))" "${BASH_REMATCH[2]}")
fi
```

## Validation

Use `roadmap get-phase` to validate phase exists:

```bash
PHASE_SECTION=$(node ~/.claude/pan-wizard-core/bin/pan-tools.cjs roadmap get-phase "${PHASE}" --raw)   # empty when the phase is not in the roadmap
if [ -z "$PHASE_SECTION" ]; then
  echo "ERROR: Phase ${PHASE} not found in roadmap"
  exit 1
fi
```

## Directory Lookup

Use `find-phase` for directory lookup:

```bash
PHASE_DIR=$(node ~/.claude/pan-wizard-core/bin/pan-tools.cjs find-phase "${PHASE}" --raw)
```
