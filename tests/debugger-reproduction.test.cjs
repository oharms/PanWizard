// The debugger reproduces before it theorises (market-ideas MI-105).
//
// pan-debugger ranked hypotheses but checked reproduction only at the end. A
// diagnosis built on a hypothesis never tested against a failing command is how a
// fix lands on a neighbouring bug. The debugger now runs a command that fails on the
// reported symptom, records it in the session file's Reproduction section, shrinks
// it, and only then forms hypotheses; the fix is verified when that command passes.
// The agent, the session-file template, the /pan:debug command and the native
// diagnose script must agree on it.

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
const agent = read('agents/pan-debugger.md');
const template = read('pan-wizard-core/templates/debug.md');
const step = (name) => {
  const s = agent.indexOf(`<step name="${name}">`);
  assert.ok(s >= 0, `step ${name} exists`);
  return agent.slice(s, agent.indexOf('</step>', s));
};
const sectionOrder = (text) => (text.match(/^## [A-Z][A-Za-z ]+$/gm) || []).map((h) => h.slice(3));
const fields = (text) => {
  const s = text.indexOf('## Reproduction\n');
  const body = text.slice(s, text.indexOf('\n## ', s + 5));
  return (body.match(/^([a-z_]+):/gm) || []).map((f) => f.slice(0, -1));
};

describe('pan-debugger reproduces before it theorises', () => {
  test('the investigation builds and runs the reproduction before the first hypothesis', () => {
    const loop = step('investigation_loop');
    const repro = loop.indexOf('Reproduce before you theorise');
    const hyp = loop.indexOf('Phase 2: Form hypothesis');
    assert.ok(repro > 0 && repro < hyp, 'the reproduction step comes before Phase 2');
    assert.match(loop, /RUN it/);
    assert.match(loop, /Shrink it/);
    assert.match(loop, /command: none/, 'the escape is a recorded reason, not silence');
  });

  test('a diagnosis names the command, and a fix is verified by it', () => {
    assert.match(step('return_diagnosis'), /\*\*Reproduction:\*\*/);
    assert.match(step('fix_and_verify'), /Re-run Reproduction\.command: it must now pass/);
  });

  test('the agent\'s file structure and the template agree on the section', () => {
    const fileStructure = agent.slice(agent.indexOf('```markdown', agent.indexOf('## File Structure')), agent.indexOf('## Update Rules'));
    const order = ['Current Focus', 'Symptoms', 'Reproduction', 'Eliminated', 'Evidence', 'Resolution'];
    assert.deepEqual(sectionOrder(fileStructure), order);
    const tplBlock = template.slice(template.indexOf('```markdown'), template.indexOf('<section_rules>'));
    assert.deepEqual(sectionOrder(tplBlock), order);
    assert.deepEqual(fields(fileStructure), ['command', 'fails_with', 'deterministic', 'tried']);
    assert.deepEqual(fields(tplBlock), fields(fileStructure));
    assert.match(agent, /\| Reproduction \| OVERWRITE to shrink \|/);
    assert.match(template, /\*\*Reproduction:\*\*\n- Written before the first hypothesis/);
  });

  test('/pan:debug and the native diagnose script carry the section and the field', () => {
    const cmd = read('commands/pan/debug.md');
    assert.match(cmd, /Current Focus, Symptoms, Reproduction, Eliminated, Evidence and Resolution/);
    const lib = read('bin/install-lib.cjs');
    const diag = lib.slice(lib.indexOf('const DIAGNOSIS = {'), lib.indexOf("phase('Record')"));
    assert.match(diag, /reproduction: \{ type: 'string' \}/);
    assert.match(diag, /a command that fails on the symptom before forming any hypothesis/);
  });
});
