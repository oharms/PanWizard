/**
 * /pan:help is generated from command frontmatter (program L5).
 *
 * The "All Commands" block of pan-wizard-core/workflows/help.md is written by
 * scripts/build-help.cjs from each commands/pan/*.md file's `group` and `description`,
 * so help cannot leave a command out (it omitted seventeen before). The committed block
 * must match a fresh render; `node scripts/build-help.cjs --write` refreshes it.
 */

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const H = require('../scripts/build-help.cjs');

const ROOT = path.join(__dirname, '..');
const HELP = path.join(ROOT, 'pan-wizard-core', 'workflows', 'help.md');
const help = () => fs.readFileSync(HELP, 'utf-8').replace(/\r\n/g, '\n');

describe('generated /pan:help', () => {
  test('every shipped command appears in help, with its own description', () => {
    const text = help();
    for (const c of H.readCommands(ROOT)) {
      assert.ok(text.includes(`| \`/${c.name}\` | ${c.description} |`), `/${c.name} is not in help.md's command index`);
    }
  });

  test('the committed block is what the generator writes now', () => {
    const block = H.extractBlock(help());
    assert.ok(block !== null, 'help.md has no generated command block');
    assert.equal(block, H.renderCommandIndex(H.readCommands(ROOT)));
  });

  test('groups come in the reading order, unknown groups after them alphabetically, commands sorted within a group', () => {
    const out = H.renderCommandIndex([
      { name: 'pan:zeta', group: 'Zed', description: 'z' },
      { name: 'pan:b', group: 'Getting Started', description: 'b' },
      { name: 'pan:a', group: 'Getting Started', description: 'a' },
      { name: 'pan:sys', group: 'System', description: 's' },
      { name: 'pan:alp', group: 'Alpha', description: 'x' },
    ]);
    const heads = out.split('\n').filter((l) => l.startsWith('### ')).map((l) => l.slice(4));
    assert.deepEqual(heads, ['Getting Started', 'System', 'Alpha', 'Zed']);
    assert.ok(out.indexOf('`/pan:a`') < out.indexOf('`/pan:b`'));
  });

  test('a command without a group or description is refused, and a pipe in a description is escaped', () => {
    assert.throws(() => H.renderCommandIndex([{ name: 'pan:x', group: '', description: 'd' }]), /pan:x has no group/);
    assert.throws(() => H.renderCommandIndex([{ name: 'pan:x', group: 'G', description: '' }]), /pan:x has no description/);
    assert.match(H.renderCommandIndex([{ name: 'pan:x', group: 'G', description: 'a | b' }]), /a \\\| b/);
  });

  test('a backslash in a description is escaped too, so it cannot unescape the pipe after it', () => {
    const out = H.renderCommandIndex([{ name: 'pan:x', group: 'G', description: 'path C:\\dir\\| x' }]);
    assert.ok(out.includes('| `/pan:x` | path C:\\\\dir\\\\\\| x |'), out);
  });

  test('CLI: --check exits 0 on the committed tree', () => {
    const out = execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'build-help.cjs'), '--check'], { cwd: ROOT, encoding: 'utf-8' });
    assert.match(out, /up to date/);
  });
});
