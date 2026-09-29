/**
 * M17 — a `contract` version on PAN's machine-readable state JSON (EL-8).
 *
 * MCP clients and scripts consume `state`, `state json` and `progress` (and the
 * pan://state / pan://progress resources that wrap them). The contract field lets a
 * consumer pin the shape it reads. The rule behind it is additive: fields are added
 * within 1.x and never renamed or removed. What is pinned here: the field is present
 * on every JSON form, absent from the key=value `--raw` form (a line-oriented
 * consumer would read it as a config key), and the resources carry it unchanged.
 */

const { describe, test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { STATE_CONTRACT } = require('../pan-wizard-core/bin/lib/constants.cjs');
const { createServer } = require('../pan-wizard-core/mcp/server.cjs');
const { runPanTools, createTempProject, cleanup } = require('./helpers.cjs');

let dir;
beforeEach(() => {
  dir = createTempProject();
  fs.writeFileSync(path.join(dir, '.planning', 'state.md'), '---\nstatus: active\ncurrent_phase: 1\n---\n# State\n');
  fs.mkdirSync(path.join(dir, '.planning', 'phases', '01-alpha'), { recursive: true });
});
afterEach(() => cleanup(dir));

const json = (args) => {
  const r = runPanTools(args, dir);
  assert.equal(r.success, true, `${args}: ${r.error}`);
  return JSON.parse(r.output);
};

describe('contract field on the state and progress JSON', () => {
  test('the contract is a 1.x version string', () => {
    assert.match(STATE_CONTRACT, /^1\.\d+$/);
  });

  test('state (load), state json and progress / progress json all carry it', () => {
    for (const args of ['state', 'state load', 'state json', 'progress', 'progress json']) {
      assert.equal(json(args).contract, STATE_CONTRACT, args);
    }
  });

  test('state json keeps the frontmatter beside the contract, and a body-only state.md gets it too', () => {
    assert.equal(json('state json').status, 'active');
    fs.writeFileSync(path.join(dir, '.planning', 'state.md'), '# State\n\n**Status:** Planning\n');
    assert.equal(json('state json').contract, STATE_CONTRACT);
  });

  test('the key=value --raw form of state load stays free of it', () => {
    const r = runPanTools('state load --raw', dir);
    assert.equal(r.success, true);
    assert.ok(!/^contract=/m.test(r.output), 'a line-oriented reader would take contract= for a config key');
    assert.match(r.output, /^model_profile=/m);
  });

  test('pan://state and pan://progress return the contract through the MCP bridge', () => {
    const s = createServer({ cwd: dir });
    for (const uri of ['pan://state', 'pan://progress']) {
      const body = JSON.parse(s.handle({ jsonrpc: '2.0', id: 1, method: 'resources/read', params: { uri } }).result.contents[0].text);
      assert.equal(body.contract, STATE_CONTRACT, uri);
    }
  });
});
