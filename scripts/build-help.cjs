#!/usr/bin/env node
'use strict';
/**
 * Generate /pan:help's command index from command frontmatter (program L5).
 *
 *   node scripts/build-help.cjs            # print the block
 *   node scripts/build-help.cjs --write    # rewrite the block in pan-wizard-core/workflows/help.md
 *   node scripts/build-help.cjs --check    # exit 1 when the committed block is stale
 *
 * The block between GENERATED_START and GENERATED_END in help.md lists every
 * commands/pan/*.md by its frontmatter `group` and `description`, so help cannot leave
 * a command out. tests/help-generated.test.cjs fails when it is stale.
 */
const fs = require('fs');
const path = require('path');
const { extractFrontmatter } = require('../pan-wizard-core/bin/lib/frontmatter.cjs');

const ROOT = path.join(__dirname, '..');
const HELP_REL = path.join('pan-wizard-core', 'workflows', 'help.md');
const GENERATED_START = '<!-- generated:command-index:start (scripts/build-help.cjs --write) -->';
const GENERATED_END = '<!-- generated:command-index:end -->';

// The order a new user reads the groups in; groups not listed follow, alphabetically.
const GROUP_ORDER = [
  'Getting Started', 'Phase Lifecycle', 'Phase Management', 'Session & Progress',
  'Milestone', 'Milestone Lifecycle', 'Focus', 'Foresight', 'Review', 'Validation',
  'Observability', 'Knowledge', 'Self-Improvement', 'Git Workflow', 'Army',
  'External tools', 'System', 'Community',
];

/** Every shipped command as {name, group, description}, sorted by name. */
function readCommands(root = ROOT) {
  const dir = path.join(root, 'commands', 'pan');
  return fs.readdirSync(dir).filter((f) => f.endsWith('.md')).sort().map((f) => {
    const fm = extractFrontmatter(fs.readFileSync(path.join(dir, f), 'utf-8')) || {};
    return {
      // The file name is the command (`/pan:<file>`); some frontmatter names omit the prefix.
      name: `pan:${f.replace(/\.md$/, '')}`,
      group: String(fm.group || '').trim(),
      description: String(fm.description || '').replace(/\s+/g, ' ').trim(),
    };
  });
}

const cell = (s) => s.replace(/\|/g, '\\|');

/** The markdown command index, grouped. Throws on a command with no group or description. */
function renderCommandIndex(commands) {
  const groups = new Map();
  for (const c of commands) {
    if (!c.group) throw new Error(`${c.name} has no group in its frontmatter`);
    if (!c.description) throw new Error(`${c.name} has no description in its frontmatter`);
    if (!groups.has(c.group)) groups.set(c.group, []);
    groups.get(c.group).push(c);
  }
  const rank = (g) => { const i = GROUP_ORDER.indexOf(g); return i === -1 ? GROUP_ORDER.length : i; };
  const order = [...groups.keys()].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
  const out = [];
  for (const g of order) {
    out.push(`### ${g}`, '| Command | Description |', '|---------|-------------|');
    for (const c of groups.get(g).sort((a, b) => a.name.localeCompare(b.name))) out.push(`| \`/${c.name}\` | ${cell(c.description)} |`);
    out.push('');
  }
  return out.join('\n').trimEnd();
}

/** The generated block's content in a help.md text, or null when the markers are missing. */
function extractBlock(text) {
  const t = String(text).replace(/\r\n/g, '\n');
  const a = t.indexOf(GENERATED_START);
  const b = t.indexOf(GENERATED_END);
  if (a === -1 || b === -1 || b < a) return null;
  return t.slice(a + GENERATED_START.length, b).trim();
}

/** help.md with its block replaced by `block`. Throws when the markers are missing. */
function replaceBlock(text, block) {
  const t = String(text).replace(/\r\n/g, '\n');
  const a = t.indexOf(GENERATED_START);
  const b = t.indexOf(GENERATED_END);
  if (a === -1 || b === -1 || b < a) throw new Error(`${HELP_REL} has no generated command-index markers`);
  return t.slice(0, a + GENERATED_START.length) + '\n' + block + '\n' + t.slice(b);
}

function main(argv) {
  const file = path.join(ROOT, HELP_REL);
  const block = renderCommandIndex(readCommands(ROOT));
  if (argv.includes('--write')) {
    fs.writeFileSync(file, replaceBlock(fs.readFileSync(file, 'utf-8'), block));
    process.stdout.write(`wrote the command index into ${HELP_REL}\n`);
  } else if (argv.includes('--check')) {
    if (extractBlock(fs.readFileSync(file, 'utf-8')) !== block) {
      process.stderr.write(`${HELP_REL}'s command index is stale: run node scripts/build-help.cjs --write\n`);
      process.exitCode = 1;
    } else {
      process.stdout.write(`${HELP_REL}'s command index is up to date\n`);
    }
  } else {
    process.stdout.write(block + '\n');
  }
}

if (require.main === module) main(process.argv.slice(2));

module.exports = { GROUP_ORDER, GENERATED_START, GENERATED_END, readCommands, renderCommandIndex, extractBlock, replaceBlock };
