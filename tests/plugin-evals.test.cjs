// The plugin eval suite (market-ideas queue M4) — its shape, offline.
//
// `claude plugin eval` runs the cases in harness/plugin-evals/ against the built
// plugin; that run is paid and needs Claude Code 2.1.269+, so it is not a test.
// What is pinned here is everything that can be checked for free: every case is
// in the documented layout (code.claude.com/docs/en/plugin-evals, read
// 2026-09-26: `<case>/prompt.md` with run limits in frontmatter, `graders/*.md`,
// six grader types), every regex compiles as the JavaScript regex the runner
// uses, each case scores on its result and not only on a Skill indicator, and the
// plugin build carries the suite.

'use strict';

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { buildPluginInto, cleanup } = require('./helpers.cjs');

const SUITE = path.join(__dirname, '..', 'harness', 'plugin-evals');
const GRADER_TYPES = new Set(['regex', 'tool_used', 'tool_order', 'file_exists', 'llm', 'baseline']);
const PAID_TYPES = new Set(['llm', 'baseline']);

/** The frontmatter subset these files use: `key: value`, `[a, b]` lists, quoted strings. */
function frontmatter(file) {
  const text = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  const m = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  assert.ok(m, `${file}: no frontmatter block`);
  const data = {};
  for (const line of m[1].split('\n')) {
    if (!line.trim()) continue;
    const kv = line.match(/^([a-z_]+):\s*(.*)$/);
    assert.ok(kv, `${file}: unreadable frontmatter line "${line}"`);
    let v = kv[2].trim();
    if (/^\[.*\]$/.test(v)) v = v.slice(1, -1).split(',').map((s) => s.trim()).filter(Boolean);
    else if (/^'.*'$/.test(v)) v = v.slice(1, -1).replace(/''/g, "'");
    else if (/^\d+$/.test(v)) v = Number(v);
    data[kv[1]] = v;
  }
  return { data, body: m[2].trim() };
}

const cases = fs.readdirSync(SUITE, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();

describe('plugin eval suite — the documented case layout', () => {
  test('the suite has cases (otherwise every check below is vacuous)', () => {
    assert.ok(cases.length >= 4, `expected at least 4 cases, found ${cases.join(', ')}`);
  });

  for (const name of cases) {
    const dir = path.join(SUITE, name);

    test(`${name}: prompt.md sets run limits and carries a prompt`, () => {
      const { data, body } = frontmatter(path.join(dir, 'prompt.md'));
      assert.ok(Number.isInteger(data.max_turns) && data.max_turns >= 1 && data.max_turns <= 200, 'max_turns must be 1-200');
      assert.ok(Array.isArray(data.allowed_tools) && data.allowed_tools.length > 0, 'allowed_tools must list the tools the case needs');
      assert.ok(body.length > 0, 'the body is the prompt Claude receives');
    });

    test(`${name}: every grader is a documented, mechanical type whose patterns compile`, () => {
      const files = fs.readdirSync(path.join(dir, 'graders')).filter((f) => f.endsWith('.md'));
      assert.ok(files.length >= 1, 'a case needs at least one grader');
      for (const f of files) {
        const { data } = frontmatter(path.join(dir, 'graders', f));
        assert.ok(GRADER_TYPES.has(data.type), `${f}: "${data.type}" is not a grader type`);
        assert.ok(!PAID_TYPES.has(data.type), `${f}: the suite keeps to free graders — a judge model makes the score drift`);
        if (data.type === 'regex') assert.doesNotThrow(() => new RegExp(data.pattern, data.flags || ''), `${f}: pattern`);
        if (data.type === 'tool_used') {
          assert.ok(typeof data.tool === 'string' && data.tool, `${f}: tool_used names its tool`);
          if (data.input_match) assert.doesNotThrow(() => new RegExp(data.input_match), `${f}: input_match`);
        }
        if (data.type === 'file_exists') assert.ok(typeof data.path === 'string' && data.path, `${f}: file_exists names a path glob`);
      }
    });

    test(`${name}: scores on its result, not only on the Skill indicator`, () => {
      // A `tool_used: Skill` grader is excluded from the score in a two-arm run, so a
      // case graded by nothing else would score as if it had no graders.
      const graders = fs.readdirSync(path.join(dir, 'graders')).filter((f) => f.endsWith('.md'))
        .map((f) => frontmatter(path.join(dir, 'graders', f)).data);
      assert.ok(graders.some((g) => !(g.type === 'tool_used' && g.tool === 'Skill')), 'add a regex or file_exists grader on the result');
    });
  }

  test('the Skill input_match patterns accept a namespaced plugin command', () => {
    // The Skill tool is called with the command's name, which a plugin prefixes.
    const re = new RegExp(frontmatter(path.join(SUITE, 'help-discovery', 'graders', 'skill-fired.md')).data.input_match);
    assert.match('{"skill":"pan-wizard:pan:help"}', re);
    assert.match('{"skill": "help"}', re);
    assert.doesNotMatch('{"skill":"pan-wizard:pan:helper"}', re);
  });

  test('the README lists every case', () => {
    const readme = fs.readFileSync(path.join(SUITE, 'README.md'), 'utf8');
    for (const name of cases) assert.ok(readme.includes(`\`${name}\``), `README.md does not describe ${name}`);
  });
});

describe('plugin eval suite — the build carries it', () => {
  let out;
  before(() => { out = buildPluginInto(); });
  after(() => cleanup(out));

  test('build-plugin.js copies every case into evals/', () => {
    const built = fs.readdirSync(path.join(out, 'evals'), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();
    assert.deepEqual(built, cases);
    for (const name of cases) {
      assert.equal(
        fs.readFileSync(path.join(out, 'evals', name, 'prompt.md'), 'utf8'),
        fs.readFileSync(path.join(SUITE, name, 'prompt.md'), 'utf8'),
        `${name}/prompt.md must reach the plugin unchanged`,
      );
    }
  });
});
