'use strict';
/**
 * frontmatter.js — minimal YAML-ish frontmatter parser.
 *
 * Supports the subset documented in DESIGN_SPEC.md §"YAML subset":
 *   - Scalars: strings (quoted or bare), numbers, booleans, null
 *   - Flow lists: [a, b, c]
 *   - Block maps: key: value (one per line)
 *   - Comments: # ... (skipped)
 *
 * Anything beyond this subset → error code 'frontmatter-malformed'.
 *
 * Returns: {data, bodyStart, errors}
 *   data       — parsed object (empty {} if no frontmatter)
 *   bodyStart  — line number (1-indexed) where the body starts (after closing ---)
 *                Used for line-number arithmetic in violation reports.
 *   errors     — array of {line, message} for parse problems (NOT validation —
 *                that's validate.js's job)
 */

const FENCE = '---';

function parseFrontmatter(text) {
  if (text == null) return { data: {}, bodyStart: 1, errors: [] };

  const lines = text.split(/\r?\n/);
  if (lines.length === 0 || lines[0] !== FENCE) {
    // No frontmatter. Body starts at line 1.
    return { data: {}, bodyStart: 1, errors: [], hasFrontmatter: false };
  }

  // Find closing fence
  let closingIndex = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === FENCE) {
      closingIndex = i;
      break;
    }
  }

  if (closingIndex === -1) {
    return {
      data: {},
      bodyStart: 1,
      errors: [{ line: 1, message: 'frontmatter opening --- has no matching closing ---' }],
      hasFrontmatter: true,
    };
  }

  const fmLines = lines.slice(1, closingIndex);
  const result = parseFrontmatterBlock(fmLines);

  return {
    data: result.data,
    bodyStart: closingIndex + 2, // 1-indexed line AFTER the closing ---
    errors: result.errors,
    hasFrontmatter: true,
  };
}

function parseFrontmatterBlock(lines) {
  const data = {};
  const errors = [];

  // Extended after dogfood gate (see .planning/optimization/traces/.../trace.jsonl event 2026-04-27T11:50:00Z):
  // Block-style lists are the dominant real-world format. The DESIGN_SPEC originally
  // scoped them out — that decision was wrong. Block-list support added per deviation R1.

  for (let i = 0; i < lines.length; i++) {
    const lineNum = i + 2; // 1-indexed in source file (line 1 is opening ---)
    let line = lines[i];

    // Strip trailing comments
    line = stripTrailingComment(line);

    // Skip blank/comment-only lines
    if (line.trim() === '') continue;

    // Match `key:` (no value) — start of a block list or block map
    const blockKeyMatch = line.match(/^([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*$/);
    if (blockKeyMatch) {
      const key = blockKeyMatch[1];

      // Look ahead: collect subsequent lines that are list items ("  - x") or
      // sub-map entries ("  k: v") indented under this key. Stop at next top-level
      // key (no leading whitespace) or end of block.
      const childLines = [];
      let j = i + 1;
      while (j < lines.length) {
        const next = lines[j];
        if (next.trim() === '' || next.trim().startsWith('#')) { j++; continue; }
        // Top-level key (no indent) ends the child block
        if (/^[A-Za-z_]/.test(next)) break;
        // Indented line — accumulate
        childLines.push({ raw: next, line: j + 2 });
        j++;
      }

      // Detect: is this a block list (- items) or a block map (key: val)?
      const looksList = childLines.length > 0 && childLines.every(c => /^\s+-\s+/.test(c.raw));
      if (looksList) {
        const items = [];
        for (const cl of childLines) {
          const itemMatch = cl.raw.match(/^\s+-\s+(.*)$/);
          if (!itemMatch) {
            errors.push({ line: cl.line, message: `expected "- value" in block list, got: ${JSON.stringify(cl.raw)}` });
            continue;
          }
          const itemRaw = stripTrailingComment(itemMatch[1]).trim();
          const parsed = parseScalarOrList(itemRaw, cl.line);
          if (parsed.error) {
            errors.push({ line: cl.line, message: `in list item: ${parsed.error}` });
            continue;
          }
          items.push(parsed.value);
        }
        if (key in data) {
          errors.push({ line: lineNum, message: `duplicate key "${key}"` });
        } else {
          data[key] = items;
        }
        i = j - 1; // resume after the block
        continue;
      }
      // Block map shape: not supported in v0.1, but don't error — treat the
      // key as null-valued and let validation handle it.
      if (childLines.length > 0) {
        // Block-style maps are out of scope per DESIGN_SPEC. Surface a warning
        // rather than a crash so the rest of the file still validates.
        errors.push({ line: lineNum, message: `block-map values not supported in v0.1 for key "${key}" (use a flow map or scalar)` });
        i = j - 1;
        continue;
      }
      // No child lines → just an empty value
      if (key in data) {
        errors.push({ line: lineNum, message: `duplicate key "${key}"` });
      } else {
        data[key] = null;
      }
      continue;
    }

    // Match `key: value` (scalar / flow list / etc.)
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(.*)$/);
    if (!m) {
      errors.push({ line: lineNum, message: `expected "key: value", got: ${JSON.stringify(line)}` });
      continue;
    }

    const key = m[1];
    const rawValue = m[2];

    if (key in data) {
      errors.push({ line: lineNum, message: `duplicate key "${key}"` });
      continue;
    }

    const parsed = parseScalarOrList(rawValue, lineNum);
    if (parsed.error) {
      errors.push({ line: lineNum, message: parsed.error });
      continue;
    }
    data[key] = parsed.value;
  }

  return { data, errors };
}

function stripTrailingComment(line) {
  // Naive: strip from first # not inside quotes. PAN frontmatter doesn't put
  // # in values, so this is safe for our subset. If a user does, they'll see
  // a frontmatter-malformed error and can quote it.
  const inSingle = (s, idx) => {
    let q = 0;
    for (let j = 0; j < idx; j++) if (s[j] === "'") q++;
    return q % 2 === 1;
  };
  const inDouble = (s, idx) => {
    let q = 0;
    for (let j = 0; j < idx; j++) if (s[j] === '"') q++;
    return q % 2 === 1;
  };
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '#' && !inSingle(line, i) && !inDouble(line, i)) {
      return line.slice(0, i).trimEnd();
    }
  }
  return line;
}

function parseScalarOrList(raw, lineNum) {
  const trimmed = raw.trim();

  if (trimmed === '') return { value: null };

  // Flow list: [a, b, c]
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    const inner = trimmed.slice(1, -1).trim();
    if (inner === '') return { value: [] };
    const items = splitFlowItems(inner);
    const parsedItems = [];
    for (const item of items) {
      const sub = parseScalarOrList(item, lineNum);
      if (sub.error) return { error: `in list: ${sub.error}` };
      parsedItems.push(sub.value);
    }
    return { value: parsedItems };
  }

  if (trimmed.startsWith('{')) {
    return { error: `inline maps not supported in v0.1 (got ${JSON.stringify(trimmed)})` };
  }

  // Quoted strings
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    if (trimmed.length < 2) return { error: 'unterminated quoted string' };
    return { value: trimmed.slice(1, -1) };
  }

  // Bare keywords
  if (trimmed === 'true') return { value: true };
  if (trimmed === 'false') return { value: false };
  if (trimmed === 'null' || trimmed === '~') return { value: null };

  // Numbers
  if (/^-?\d+$/.test(trimmed)) return { value: parseInt(trimmed, 10) };
  if (/^-?\d+\.\d+$/.test(trimmed)) return { value: parseFloat(trimmed) };

  // Bare string (catch-all)
  return { value: trimmed };
}

function splitFlowItems(inner) {
  // Simple comma-split that respects quoted strings and nested brackets.
  const items = [];
  let depth = 0;
  let inSingle = false;
  let inDouble = false;
  let current = '';

  for (const ch of inner) {
    if (inSingle) {
      current += ch;
      if (ch === "'") inSingle = false;
      continue;
    }
    if (inDouble) {
      current += ch;
      if (ch === '"') inDouble = false;
      continue;
    }
    if (ch === "'") { inSingle = true; current += ch; continue; }
    if (ch === '"') { inDouble = true; current += ch; continue; }
    if (ch === '[' || ch === '{') { depth++; current += ch; continue; }
    if (ch === ']' || ch === '}') { depth--; current += ch; continue; }
    if (ch === ',' && depth === 0) {
      items.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim() !== '') items.push(current.trim());
  return items;
}

module.exports = { parseFrontmatter };
