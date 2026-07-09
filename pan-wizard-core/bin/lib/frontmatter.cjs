/**
 * Frontmatter -- YAML frontmatter parsing, serialization, and CRUD commands
 */

const fs = require('fs');
const path = require('path');
const { safeReadFile, output, error } = require('./core.cjs');
const { FIELD_VALUE_RE, PRIORITY_LEVELS, EFFORT_SIZES } = require('./constants.cjs');

// --- Inline array rendering thresholds -------------------------------------------

/** Maximum number of items before switching from inline [a, b] to multi-line array */
const MAX_INLINE_ARRAY_ITEMS = 3;

/** Maximum character width of joined items before switching to multi-line array */
const MAX_INLINE_ARRAY_WIDTH = 60;

// --- Parsing engine --------------------------------------------------------------

/**
 * Process a single YAML line: detect key-value pairs, inline arrays, nested objects, or list items.
 * @param {string} line - The raw YAML line
 * @param {number} indent - Indentation level of this line
 * @param {Object} current - Current stack frame { obj, key, indent }
 * @param {Object[]} stack - Full parser stack
 */
function processYamlLine(line, indent, current, stack) {
  const keyMatch = line.match(/^(\s*)([a-zA-Z0-9_-]+):\s*(.*)/);
  if (keyMatch) {
    const key = keyMatch[2];
    const value = keyMatch[3].trim();

    if (value === '' || value === '[') {
      current.obj[key] = value === '[' ? [] : {};
      current.key = null;
      stack.push({ obj: current.obj[key], key: null, indent });
    } else if (value.startsWith('[') && value.endsWith(']')) {
      current.obj[key] = value.slice(1, -1).split(',').map(item => item.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
      current.key = null;
    } else {
      current.obj[key] = value.replace(/^["']|["']$/g, '');
      current.key = null;
    }
  } else if (line.trim().startsWith('- ')) {
    const itemValue = line.trim().slice(2).replace(/^["']|["']$/g, '');

    if (typeof current.obj === 'object' && !Array.isArray(current.obj) && Object.keys(current.obj).length === 0) {
      const parent = stack.length > 1 ? stack[stack.length - 2] : null;
      if (parent) {
        for (const parentKey of Object.keys(parent.obj)) {
          if (parent.obj[parentKey] === current.obj) {
            parent.obj[parentKey] = [itemValue];
            current.obj = parent.obj[parentKey];
            break;
          }
        }
      }
    } else if (Array.isArray(current.obj)) {
      current.obj.push(itemValue);
    }
  }
}

/**
 * Parse YAML frontmatter from markdown content into a plain object.
 * @param {string} content - Markdown content with optional ---delimited frontmatter
 * @returns {Object} Parsed frontmatter key-value pairs (empty object if none found)
 */
function extractFrontmatter(content) {
  /*
   * Stack-based parser that tracks nesting depth via indentation.
   * Each stack entry represents a nested object or array context.
   *
   * Algorithm overview:
   *   1. Extract the raw YAML between the opening and closing --- delimiters.
   *   2. Split into lines and iterate, tracking indentation level per line.
   *   3. Maintain a stack where each frame holds:
   *        - obj:    the current object or array being populated
   *        - key:    (unused reservation for future array grouping)
   *        - indent: the indentation level at which this frame was pushed
   *   4. On each line, pop stack frames whose indent is >= current indent,
   *      effectively "closing" nested contexts when de-indented.
   *   5. Detect key-value pairs, inline arrays, nested objects, and list items
   *      and insert them into the current stack frame's object.
   *   6. When a list item (- value) is found inside what was initialized as an
   *      empty object {}, convert that object to an array in the parent frame.
   */

  const frontmatter = {};

  // --- Frontmatter delimiter detection ---
  // Match the first YAML block bounded by opening "---\n" and closing "\n---"
  const match = content.match(/^---\n([\s\S]+?)\n---/);
  if (!match) return frontmatter;

  const yaml = match[1];
  const lines = yaml.split('\n');

  // Stack to track nested objects: [{obj, key, indent}]
  // obj = object to write to, key = current key collecting array items, indent = indentation level
  let stack = [{ obj: frontmatter, key: null, indent: -1 }];

  for (const line of lines) {
    // Skip empty lines -- they carry no YAML data
    if (line.trim() === '') continue;

    // --- Indentation-based stack pop logic ---
    // Calculate indentation as the count of leading whitespace characters.
    // This determines which nesting level the current line belongs to.
    const indentMatch = line.match(/^(\s*)/);
    const indent = indentMatch ? indentMatch[1].length : 0;

    // Pop stack frames until we find one whose indent is strictly less than
    // the current line's indent. This "closes" any nested contexts that have
    // ended due to de-indentation (e.g., returning from a nested object back
    // to the parent level).
    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) {
      stack.pop();
    }

    const current = stack[stack.length - 1];
    processYamlLine(line, indent, current, stack);
  }

  return frontmatter;
}

/**
 * Serialize a plain object back into YAML frontmatter string (without --- delimiters).
 *
 * Serialization strategy:
 *   - Short string arrays (at most MAX_INLINE_ARRAY_ITEMS items whose joined width
 *     is under MAX_INLINE_ARRAY_WIDTH characters) render inline: key: [a, b, c]
 *   - Longer or non-string arrays render multi-line with "- item" syntax
 *   - Nested objects recurse up to 3 levels deep (top > sub > subsub)
 *   - Scalar values containing colons, hashes, or leading brackets are quoted
 *
 * @param {Object} obj - Key-value pairs to serialize as YAML
 * @returns {string} YAML-formatted string
 */
function reconstructFrontmatter(obj) {
  const lines = [];
  for (const [key, value] of Object.entries(obj)) {
    renderYamlEntry(lines, key, value, 0);
  }
  return lines.join('\n');
}

/**
 * Render a single key-value pair as YAML lines at the given indent depth.
 * Handles scalars, arrays (inline or multi-line), and nested objects recursively.
 */
function renderYamlEntry(lines, key, value, depth) {
  if (value === null || value === undefined) return;
  const indent = '  '.repeat(depth);

  if (Array.isArray(value)) {
    if (value.length === 0) {
      lines.push(`${indent}${key}: []`);
    } else if (value.every(item => typeof item === 'string') && value.length <= MAX_INLINE_ARRAY_ITEMS && value.join(', ').length < MAX_INLINE_ARRAY_WIDTH) {
      lines.push(`${indent}${key}: [${value.join(', ')}]`);
    } else {
      lines.push(`${indent}${key}:`);
      const itemIndent = '  '.repeat(depth + 1);
      for (const item of value) {
        lines.push(`${itemIndent}- ${quoteIfNeeded(item)}`);
      }
    }
  } else if (typeof value === 'object') {
    lines.push(`${indent}${key}:`);
    for (const [childKey, childVal] of Object.entries(value)) {
      renderYamlEntry(lines, childKey, childVal, depth + 1);
    }
  } else {
    lines.push(`${indent}${key}: ${quoteIfNeeded(value)}`);
  }
}

/**
 * Quote a value if it contains YAML-special characters.
 */
function quoteIfNeeded(value) {
  const str = String(value);
  if (str.includes(':') || str.includes('#') || str.startsWith('[') || str.startsWith('{')) {
    return `"${str}"`;
  }
  return str;
}

/**
 * Replace or insert frontmatter in markdown content with a new object.
 * @param {string} content - Original markdown content
 * @param {Object} newObj - New frontmatter key-value pairs
 * @returns {string} Content with updated frontmatter block
 */
function spliceFrontmatter(content, newObj) {
  const yamlStr = reconstructFrontmatter(newObj);
  const match = content.match(/^---\n[\s\S]+?\n---/);
  if (match) {
    return `---\n${yamlStr}\n---` + content.slice(match[0].length);
  }
  return `---\n${yamlStr}\n---\n\n` + content;
}

/**
 * Parse a specific block (artifacts, key_links, truths) from must_haves in raw YAML frontmatter.
 *
 * Block structure being parsed:
 *   The must_haves section is a 3-level nested YAML structure:
 *     must_haves:           (level 1 -- 2-space indent)
 *       artifacts:          (level 2 -- 4-space indent, the blockName)
 *         - path: foo       (level 3 -- 6-space indent, list items)
 *           provides: bar   (level 3+ -- 8-space indent, continuation k-v pairs)
 *
 *   This function finds the named block at the 4-space level, then parses
 *   its list items (at 6-space indent) and their nested key-value pairs
 *   (at 8+ space indent) into an array of objects or strings.
 *
 * @param {string} content - Full markdown content with frontmatter
 * @param {string} blockName - Block name to extract (e.g., "artifacts", "key_links")
 * @returns {Array} Parsed array of block items (objects or strings)
 */
function parseMustHavesBlock(content, blockName) {
  // Extract raw YAML between --- delimiters
  const fmMatch = content.match(/^---\n([\s\S]+?)\n---/);
  if (!fmMatch) return [];

  const yaml = fmMatch[1];

  // Locate the block header at exactly 4-space indent (must_haves child level)
  const blockPattern = new RegExp(`^\\s{4}${blockName}:\\s*$`, 'm');
  const blockStart = yaml.search(blockPattern);
  if (blockStart === -1) return [];

  const afterBlock = yaml.slice(blockStart);
  // Skip the header line itself, then process remaining lines
  const blockLines = afterBlock.split('\n').slice(1);

  const items = [];
  let currentItem = null;

  for (const line of blockLines) {
    // Skip blank lines within the block
    if (line.trim() === '') continue;

    // --- Indentation-based grouping ---
    // Measure indent to detect when we've left the block (indent <= 4
    // means we've returned to must_haves level or a sibling block)
    const indent = line.match(/^(\s*)/)[1].length;
    if (indent <= 4 && line.trim() !== '') break;

    if (line.match(/^\s{6}-\s+/)) {
      // New list item at 6-space indent (direct child of the block)
      if (currentItem) items.push(currentItem);
      currentItem = {};

      // Check if it is a simple string item (no colon means not key-value)
      const simpleMatch = line.match(/^\s{6}-\s+"?([^"]+)"?\s*$/);
      if (simpleMatch && !line.includes(':')) {
        currentItem = simpleMatch[1];
      } else {
        // Key-value on same line as dash: "- path: value"
        const kvMatch = line.match(/^\s{6}-\s+(\w+):\s*"?([^"]*)"?\s*$/);
        if (kvMatch) {
          currentItem = {};
          currentItem[kvMatch[1]] = kvMatch[2];
        }
      }
    } else if (currentItem && typeof currentItem === 'object') {
      // Continuation key-value at 8+ space indent (properties of current list item)
      const kvMatch = line.match(/^\s{8,}(\w+):\s*"?([^"]*)"?\s*$/);
      if (kvMatch) {
        const val = kvMatch[2];
        // Coerce pure-integer strings to numbers for convenience
        currentItem[kvMatch[1]] = /^\d+$/.test(val) ? parseInt(val, 10) : val;
      }
      // Array items nested under a property at 10+ space indent
      const arrMatch = line.match(/^\s{10,}-\s+"?([^"]+)"?\s*$/);
      if (arrMatch) {
        // Convert the most recently added key's scalar value into an array,
        // then append this item to that array
        const keys = Object.keys(currentItem);
        const lastKey = keys[keys.length - 1];
        if (lastKey && !Array.isArray(currentItem[lastKey])) {
          currentItem[lastKey] = currentItem[lastKey] ? [currentItem[lastKey]] : [];
        }
        if (lastKey) currentItem[lastKey].push(arrMatch[1]);
      }
    }
  }
  // Push the final item if one was being accumulated
  if (currentItem) items.push(currentItem);

  return items;
}

// --- Focus field helpers ---------------------------------------------------------

/**
 * Extract priority and effort from frontmatter with validation and defaults.
 * @param {Object} fm - Parsed frontmatter object from extractFrontmatter()
 * @returns {{ priority: string, effort: string, priorityValid: boolean, effortValid: boolean }}
 */
function extractPriorityEffort(fm) {
  const rawPriority = fm.priority ? String(fm.priority).toUpperCase() : null;
  const rawEffort = fm.effort ? String(fm.effort).toUpperCase() : null;
  return {
    priority: PRIORITY_LEVELS.includes(rawPriority) ? rawPriority : 'P3',
    effort: EFFORT_SIZES.includes(rawEffort) ? rawEffort : 'M',
    priorityValid: rawPriority === null || PRIORITY_LEVELS.includes(rawPriority),
    effortValid: rawEffort === null || EFFORT_SIZES.includes(rawEffort),
  };
}

// --- Frontmatter CRUD commands ---------------------------------------------------

const FRONTMATTER_SCHEMAS = {
  plan: { required: ['phase', 'plan', 'type', 'wave', 'depends_on', 'files_modified', 'autonomous', 'must_haves'] },
  summary: { required: ['phase', 'plan', 'subsystem', 'tags', 'duration', 'completed'] },
  verification: { required: ['phase', 'verified', 'status', 'score'] },
};

/**
 * Get frontmatter from a file, optionally filtered to a single field.
 * @param {string} cwd - Working directory path
 * @param {string} filePath - Path to the markdown file
 * @param {string} field - Optional specific field to extract
 * @param {boolean} raw - If true, output raw value instead of JSON
 * @returns {void}
 */
function cmdFrontmatterGet(cwd, filePath, field, raw) {
  if (!filePath) { error('file path required'); }
  const fullPath = path.isAbsolute(filePath) ? filePath : path.join(cwd, filePath);
  const content = safeReadFile(fullPath);
  if (!content) { output({ error: 'File not found', path: filePath }, raw); return; }
  const fm = extractFrontmatter(content);
  if (field) {
    const value = fm[field];
    if (value === undefined) { output({ error: 'Field not found', field }, raw); return; }
    output({ [field]: value }, raw, JSON.stringify(value));
  } else {
    output(fm, raw);
  }
}

/**
 * Set a single frontmatter field value in a markdown file.
 * @param {string} cwd - Working directory path
 * @param {string} filePath - Path to the markdown file
 * @param {string} field - Field name to set
 * @param {string} value - Value to set (JSON-parsed if valid)
 * @param {boolean} raw - If true, output raw value instead of JSON
 * @returns {void}
 */
function cmdFrontmatterSet(cwd, filePath, field, value, raw) {
  if (!filePath || !field || value === undefined) { error('file, field, and value required'); }
  const fullPath = path.isAbsolute(filePath) ? filePath : path.join(cwd, filePath);
  let content;
  try {
    content = fs.readFileSync(fullPath, 'utf-8');
  } catch {
    output({ error: 'File not found', path: filePath }, raw); return;
  }
  const fm = extractFrontmatter(content);
  let parsedValue;
  // Attempt JSON parse so callers can pass structured values (arrays, objects);
  // fall back to raw string if the value is not valid JSON
  try { parsedValue = JSON.parse(value); } catch { parsedValue = value; }
  fm[field] = parsedValue;
  const newContent = spliceFrontmatter(content, fm);
  try {
    fs.writeFileSync(fullPath, newContent, 'utf-8');
  } catch (err) {
    output({ error: 'Failed to write file: ' + err.message, path: filePath }, raw); return;
  }
  output({ updated: true, field, value: parsedValue }, raw, 'true');
}

/**
 * Merge multiple fields into existing frontmatter from a JSON data string.
 * @param {string} cwd - Working directory path
 * @param {string} filePath - Path to the markdown file
 * @param {string} data - JSON string of key-value pairs to merge
 * @param {boolean} raw - If true, output raw value instead of JSON
 * @returns {void}
 */
function cmdFrontmatterMerge(cwd, filePath, data, raw) {
  if (!filePath || !data) { error('file and data required'); }
  const fullPath = path.isAbsolute(filePath) ? filePath : path.join(cwd, filePath);
  let content;
  try {
    content = fs.readFileSync(fullPath, 'utf-8');
  } catch {
    output({ error: 'File not found', path: filePath }, raw); return;
  }
  const fm = extractFrontmatter(content);
  let mergeData;
  // Parse the JSON data string; abort with error if the caller passed invalid JSON
  try { mergeData = JSON.parse(data); } catch { error('Invalid JSON for --data'); return; }
  Object.assign(fm, mergeData);
  const newContent = spliceFrontmatter(content, fm);
  try {
    fs.writeFileSync(fullPath, newContent, 'utf-8');
  } catch (err) {
    output({ error: 'Failed to write file: ' + err.message, path: filePath }, raw); return;
  }
  output({ merged: true, fields: Object.keys(mergeData) }, raw, 'true');
}

/**
 * Validate frontmatter against a named schema (plan, summary, or verification).
 * @param {string} cwd - Working directory path
 * @param {string} filePath - Path to the markdown file
 * @param {string} schemaName - Schema name: "plan", "summary", or "verification"
 * @param {boolean} raw - If true, output raw value instead of JSON
 * @returns {void}
 */
function cmdFrontmatterValidate(cwd, filePath, schemaName, raw) {
  if (!filePath || !schemaName) { error('file and schema required'); }
  const schema = FRONTMATTER_SCHEMAS[schemaName];
  if (!schema) { error(`Unknown schema: ${schemaName}. Available: ${Object.keys(FRONTMATTER_SCHEMAS).join(', ')}`); }
  const fullPath = path.isAbsolute(filePath) ? filePath : path.join(cwd, filePath);
  const content = safeReadFile(fullPath);
  if (!content) { output({ error: 'File not found', path: filePath }, raw); return; }
  const fm = extractFrontmatter(content);
  const missing = schema.required.filter(field => fm[field] === undefined);
  const present = schema.required.filter(field => fm[field] !== undefined);
  output({ valid: missing.length === 0, missing, present, schema: schemaName }, raw, missing.length === 0 ? 'valid' : 'invalid');
}

module.exports = {
  extractFrontmatter,
  reconstructFrontmatter,
  spliceFrontmatter,
  parseMustHavesBlock,
  extractPriorityEffort,
  FRONTMATTER_SCHEMAS,
  cmdFrontmatterGet,
  cmdFrontmatterSet,
  cmdFrontmatterMerge,
  cmdFrontmatterValidate,
};
