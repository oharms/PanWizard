/**
 * Program L7: renamed commands resolve on all five runtimes.
 *
 * Each COMMAND_ALIASES entry is installed as a command under its old name, in the
 * shape and place each runtime reads commands from, carrying the target's body with
 * the flags preset. Retired commands are installed nowhere.
 */
'use strict';

const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { createScenarioRunner } = require('../helpers.cjs');
const { COMMAND_ALIASES, RETIRED_COMMANDS } = require('../../pan-wizard-core/bin/lib/constants.cjs');

const WHERE = {
  claude: (n) => path.join('.claude', 'commands', 'pan', `${n}.md`),
  gemini: (n) => path.join('.gemini', 'commands', 'pan', `${n}.toml`),
  opencode: (n) => path.join('.opencode', 'commands', `pan-${n}.md`),
  codex: (n) => path.join('.agents', 'skills', `pan-${n}`, 'SKILL.md'),
  copilot: (n) => path.join('.github', 'skills', `pan-${n}`, 'SKILL.md'),
};

for (const runtime of Object.keys(WHERE)) {
  describe(`${runtime}: renamed commands resolve (L7)`, () => {
    let runner;
    before(() => { runner = createScenarioRunner(runtime); });
    after(() => { if (runner) runner.cleanup(); });

    test('every old name is installed as an alias of its new form', () => {
      for (const [old, a] of Object.entries(COMMAND_ALIASES)) {
        const file = path.join(runner.tmpDir, WHERE[runtime](old));
        assert.ok(fs.existsSync(file), `${runtime}: ${old} alias missing at ${WHERE[runtime](old)}`);
        const text = fs.readFileSync(file, 'utf8');
        assert.ok(text.includes('is now'), `${runtime}: ${old} must say what it was renamed to`);
        assert.ok(text.includes(a.to), `${runtime}: ${old} must name ${a.to}`);
        if (a.args) assert.ok(text.includes(a.args), `${runtime}: ${old} must preset ${a.args}`);
        assert.ok(fs.existsSync(path.join(runner.tmpDir, WHERE[runtime](a.to))), `${runtime}: target ${a.to} missing`);
      }
    });

    test('retired commands are not installed', () => {
      for (const r of RETIRED_COMMANDS) {
        assert.ok(!fs.existsSync(path.join(runner.tmpDir, WHERE[runtime](r))), `${runtime}: ${r} must not be installed`);
      }
    });
  });
}
