// After a compaction the host keeps only the start of an invoked PAN command (Claude
// Code re-attaches each invoked skill cut to its first 5,000 tokens), and a command
// @-includes its whole workflow. The state re-injection therefore names the workflow
// to re-read, not only state.md and the plan (MI-144, M53 in
// docs/specs/market-ideas-2026-11.md).

'use strict';

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  buildReinjectContext, GENERIC_WORKFLOW_LINE, workflowLine, commandFromTranscript, workflowPathFor,
} = require('../hooks/pan-state-reinject.js');
const opencode = require('../pan-wizard-core/opencode/pan-wizard.js');
const { spawnHook } = require('./helpers.cjs');

const STATE = '**Current Phase:** 3\n**Current Phase Name:** Payments\n**Status:** In progress\n';
const ROADMAP = '- [x] **Phase 2: Auth**\n- [ ] **Phase 3: Payments**\n';
const HOOK_SRC = path.join(__dirname, '..', 'hooks', 'pan-state-reinject.js');

const userTurn = (content) => JSON.stringify({ type: 'user', message: { role: 'user', content } });
const commandTurn = (name) => userTurn(`<command-message>pan:${name}</command-message>\n<command-name>/pan:${name}</command-name>\n<command-args>3</command-args>`);

let tmp;
beforeEach(() => { tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'pan-reinject-wf-'))); });
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

describe('the line in the block', () => {
  test('with no command known, the block still says to re-read the running workflow', () => {
    const ctx = buildReinjectContext({ stateContent: STATE, roadmapContent: ROADMAP });
    assert.ok(ctx.endsWith(GENERIC_WORKFLOW_LINE), ctx);
    assert.match(GENERIC_WORKFLOW_LINE, /re-read the workflow file it loads before the next step/);
  });

  test('a known command with an installed workflow is named with its file', () => {
    const ctx = buildReinjectContext({ stateContent: STATE, roadmapContent: ROADMAP, command: 'exec-phase', workflowPath: '/home/u/.claude/pan-wizard-core/workflows/exec-phase.md' });
    assert.match(ctx, /\/pan:exec-phase was running and the compaction kept only the start of its instructions: re-read \/home\/u\/\.claude\/pan-wizard-core\/workflows\/exec-phase\.md before the next step\.$/);
    assert.ok(!ctx.includes(GENERIC_WORKFLOW_LINE));
  });

  test('a command without a workflow file falls back to the general line', () => {
    assert.equal(workflowLine('quick', null), GENERIC_WORKFLOW_LINE);
    assert.equal(workflowLine(null, '/x.md'), GENERIC_WORKFLOW_LINE);
  });

  test('nothing in flight still means no block at all', () => {
    assert.equal(buildReinjectContext({ stateContent: STATE, roadmapContent: ROADMAP.replace('[ ]', '[x]'), command: 'exec-phase', workflowPath: '/x.md' }), null);
  });

  test('OpenCode\'s compaction block carries the same line', () => {
    fs.mkdirSync(path.join(tmp, '.planning'));
    fs.writeFileSync(path.join(tmp, '.planning', 'state.md'), STATE);
    fs.writeFileSync(path.join(tmp, '.planning', 'roadmap.md'), ROADMAP);
    const target = [];
    return opencode.server({ directory: tmp }).then(async (hooks) => {
      await hooks['experimental.session.compacting']({}, { context: target });
      assert.equal(target.length, 1);
      assert.ok(target[0].includes(GENERIC_WORKFLOW_LINE), target[0]);
    });
  });
});

describe('which command was running', () => {
  test('the last PAN command typed in the transcript, skipping tool results and other text', () => {
    const t = path.join(tmp, 't.jsonl');
    fs.writeFileSync(t, [
      commandTurn('plan-phase'),
      userTurn('plain text'),
      commandTurn('exec-phase'),
      JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', content: '<command-name>/pan:quick</command-name>' }] } }),
      JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: '<command-name>/pan:help</command-name>' }] } }),
      '',
    ].join('\n'));
    assert.equal(commandFromTranscript(t), 'exec-phase');
  });

  test('no transcript, an unreadable one, or one with no PAN command gives null', () => {
    assert.equal(commandFromTranscript(null), null);
    assert.equal(commandFromTranscript(path.join(tmp, 'missing.jsonl')), null);
    const t = path.join(tmp, 't.jsonl');
    fs.writeFileSync(t, `${userTurn('hello')}\nnot json\n`);
    assert.equal(commandFromTranscript(t), null);
  });

  test('the installed workflow is found beside the hook directory; a missing one or a bad name is null', () => {
    const hooks = path.join(tmp, '.claude', 'hooks');
    const wf = path.join(tmp, '.claude', 'pan-wizard-core', 'workflows');
    fs.mkdirSync(hooks, { recursive: true });
    fs.mkdirSync(wf, { recursive: true });
    fs.writeFileSync(path.join(wf, 'exec-phase.md'), '# exec');
    assert.equal(workflowPathFor('exec-phase', hooks), path.join(wf, 'exec-phase.md').split(path.sep).join('/'));
    assert.equal(workflowPathFor('autodev', hooks), null);
    assert.equal(workflowPathFor('../../etc/passwd', hooks), null);
    assert.equal(workflowPathFor(null, hooks), null);
  });
});

describe('the hook process, as installed', () => {
  test('after a compaction during /pan:exec-phase the block names the installed exec-phase workflow', () => {
    const project = path.join(tmp, 'proj');
    const hooks = path.join(project, '.claude', 'hooks');
    const wf = path.join(project, '.claude', 'pan-wizard-core', 'workflows');
    fs.mkdirSync(hooks, { recursive: true });
    fs.mkdirSync(wf, { recursive: true });
    fs.mkdirSync(path.join(project, '.planning'));
    fs.copyFileSync(HOOK_SRC, path.join(hooks, 'pan-state-reinject.js'));
    fs.writeFileSync(path.join(wf, 'exec-phase.md'), '# exec');
    fs.writeFileSync(path.join(project, '.planning', 'state.md'), STATE);
    fs.writeFileSync(path.join(project, '.planning', 'roadmap.md'), ROADMAP);
    const transcript = path.join(tmp, 'session.jsonl');
    fs.writeFileSync(transcript, `${commandTurn('exec-phase')}\n`);
    const r = spawnHook(path.join(hooks, 'pan-state-reinject.js'), { hook_event_name: 'SessionStart', source: 'compact', cwd: project, transcript_path: transcript }, project);
    assert.equal(r.status, 0, r.stderr);
    const ctx = JSON.parse(r.stdout).hookSpecificOutput.additionalContext;
    assert.ok(ctx.includes(`re-read ${path.join(wf, 'exec-phase.md').split(path.sep).join('/')} before the next step`), ctx);
  });
});
