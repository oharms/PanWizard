/**
 * Tests for hud.cjs — single-page HTML army + project dashboard (ADR-0035).
 * collectHudData() / renderHud() are pure given a fixed `now`; cmdHud() writes
 * the file. Army worktrees need a real git repo, so army-mode is exercised via
 * the campaign schedule (the other armyActive trigger).
 */

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const hud = require('../pan-wizard-core/bin/lib/hud.cjs');
const campaign = require('../pan-wizard-core/bin/lib/campaign.cjs');
const { runPanTools } = require('./helpers.cjs');

const NOW = new Date('2026-06-12T09:00:00Z');

let cwd;
beforeEach(() => {
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-hud-'));
});
afterEach(() => { fs.rmSync(cwd, { recursive: true, force: true }); });

function W(rel, content) {
  const p = path.join(cwd, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content, 'utf-8');
}

function scaffoldProject() {
  W('package.json', JSON.stringify({ name: 'demo-app', version: '0.4.0' }));
  W('.planning/project.md', '# Demo\n\n## Core Value\n\nAnswer questions from evidence, automatically.\n');
  W('.planning/state.md', [
    '**Current Phase:** 02',
    '**Current Phase Name:** Build it',
    '**Status:** in_progress',
    '**Last Activity:** 2026-06-12',
    '',
    '## Blockers',
    '- waiting on API key',
    '',
  ].join('\n'));
  W('.planning/requirements.md', '- [x] req one\n- [x] req two\n- [ ] req three\n');
  W('.planning/phases/01-setup/plan.md', '# plan');
  W('.planning/phases/01-setup/summary.md', '# summary');
  W('.planning/phases/01-setup/01-verification.md', '# verified');
  W('.planning/phases/02-build-it/plan.md', '# plan');
  // cost ledger: one record per squad-mapped agent
  const recs = [
    { ts: '2026-06-12T08:00:00Z', agent: 'pan-planner', model: 'claude-opus-4-8', input_tokens: 1000, output_tokens: 200 },
    { ts: '2026-06-12T08:10:00Z', agent: 'pan-executor', model: 'claude-sonnet-4-6', input_tokens: 5000, output_tokens: 900 },
    { ts: '2026-06-12T08:20:00Z', agent: 'pan-conductor', model: 'claude-opus-4-8', input_tokens: 800, output_tokens: 100 },
  ].map(r => JSON.stringify(r)).join('\n') + '\n';
  W('.planning/metrics/tokens.jsonl', recs);
}

describe('hud — collectHudData (project signals)', () => {
  test('reads project identity, state, progress, requirements, quality', () => {
    scaffoldProject();
    const d = hud.collectHudData(cwd, { now: NOW });
    assert.equal(d.project.name, 'demo-app');
    assert.equal(d.project.version, '0.4.0');
    assert.match(d.project.core_value, /evidence/);
    assert.equal(d.state.current_phase, '02');
    assert.equal(d.state.status, 'in_progress');
    assert.deepEqual(d.state.blockers, ['waiting on API key']);
    assert.equal(d.progress.total, 2);
    assert.equal(d.progress.completed, 1);
    assert.equal(d.progress.percent, 50);
    assert.equal(d.requirements.total, 3);
    assert.equal(d.requirements.done, 2);
    assert.deepEqual(d.requirements.open, ['req three']);
    assert.equal(d.quality.phase, '01');
    assert.equal(d.quality.verification, true);
  });

  test('telemetry maps agents to squads', () => {
    scaffoldProject();
    const d = hud.collectHudData(cwd, { now: NOW });
    assert.ok(d.telemetry.by_squad.architecture, 'pan-planner → architecture');
    assert.ok(d.telemetry.by_squad.build, 'pan-executor → build');
    assert.ok(d.telemetry.by_squad.command, 'pan-conductor → command');
    assert.ok(d.telemetry.totals.cost_usd > 0);
  });

  test('command stack marks active agents from the cost ledger', () => {
    scaffoldProject();
    const d = hud.collectHudData(cwd, { now: NOW });
    const build = d.army.squads.find(s => s.name === 'build');
    const exec = build.agents.find(a => a.name === 'pan-executor');
    assert.equal(exec.active, true);
    assert.ok(exec.tokens > 0);
  });
});

describe('hud — graceful degradation', () => {
  test('empty project does not throw and produces safe defaults', () => {
    const d = hud.collectHudData(cwd, { now: NOW });
    assert.equal(d.army_active, false);
    assert.equal(d.project.name, null);
    assert.equal(d.progress.total, 0);
    assert.equal(d.requirements, null);
    assert.equal(d.quality, null);
    // rendering must not throw on an empty project
    const html = hud.renderHud(d);
    assert.match(html, /<!DOCTYPE html>/);
  });

  test('army panels hidden without a campaign or worktrees', () => {
    scaffoldProject();
    const d = hud.collectHudData(cwd, { now: NOW });
    assert.equal(d.army_active, false);
    const html = hud.renderHud(d);
    assert.ok(!/command stack/i.test(html), 'no command-stack panel');
    assert.ok(!/safety harness/i.test(html), 'no harness panel');
  });

  test('army panels appear once a campaign is scheduled', () => {
    scaffoldProject();
    campaign.writeSchedule(cwd, { goal: 'ship v1', cadence: 'daily', daily_budget: 200 }, NOW);
    const d = hud.collectHudData(cwd, { now: NOW });
    assert.equal(d.army_active, true);
    assert.ok(d.campaign);
    assert.equal(d.campaign.daily_budget, 200);
    const html = hud.renderHud(d);
    assert.match(html, /command stack/i);
    assert.match(html, /campaign/i);
    assert.match(html, /safety harness/i);
  });
});

describe('hud — renderHud', () => {
  test('produces a self-contained document with inlined CSS and no external assets', () => {
    scaffoldProject();
    const html = hud.renderHud(hud.collectHudData(cwd, { now: NOW }));
    assert.match(html, /<!DOCTYPE html>/);
    assert.match(html, /<style>/);
    assert.ok(!/https?:\/\//.test(html.replace(/lang="en"/, '')), 'no external URLs');
    assert.ok(!/<script/i.test(html), 'no script tags');
    assert.match(html, /demo-app/);
  });

  test('HTML-escapes project-derived text (XSS-safe)', () => {
    W('package.json', JSON.stringify({ name: '<script>alert(1)</script>', version: '1.0.0' }));
    const html = hud.renderHud(hud.collectHudData(cwd, { now: NOW }));
    assert.ok(!html.includes('<script>alert(1)</script>'), 'raw payload must not appear');
    assert.match(html, /&lt;script&gt;/);
  });

  test('esc escapes the dangerous five', () => {
    assert.equal(hud.esc(`<>&"'`), '&lt;&gt;&amp;&quot;&#39;');
  });

  test('renders the "now building" panel when a roadmap exists', () => {
    scaffoldProject();
    const html = hud.renderHud(hud.collectHudData(cwd, { now: NOW }));
    assert.match(html, /now building/i);
    assert.match(html, /class="stepper"/);
  });

  test('renders the branded layout — top bar, dark now-building, per-squad color', () => {
    scaffoldProject();
    campaign.writeSchedule(cwd, { cadence: 'daily' }, NOW);
    const html = hud.renderHud(hud.collectHudData(cwd, { now: NOW }));
    assert.match(html, /class="topbar"/, 'top bar present');
    assert.match(html, /class="nowbuilding"/, 'dark now-building hero present');
    assert.match(html, /border-left:3px solid #FF5A3C/, 'Build squad reads coral');
  });
});

// cmdHud calls output() which process.exit()s, so it must be driven through the
// dispatcher in a child process (the project-wide convention for cmd* tests).
describe('hud — cmdHud via dispatcher (file write)', () => {
  test('writes .planning/hud.html by default and returns its path', () => {
    scaffoldProject();
    const r = runPanTools('hud', cwd);
    assert.equal(r.success, true, r.error);
    const out = path.join(cwd, '.planning', 'hud.html');
    assert.ok(fs.existsSync(out), 'hud.html written');
    const html = fs.readFileSync(out, 'utf-8');
    assert.match(html, /<!DOCTYPE html>/);
    assert.match(html, /demo-app/);
    assert.match(r.output, /hud\.html/);
  });

  test('--out writes to a custom path', () => {
    scaffoldProject();
    const r = runPanTools('hud --out reports/dash.html', cwd);
    assert.equal(r.success, true, r.error);
    assert.ok(fs.existsSync(path.join(cwd, 'reports', 'dash.html')));
  });

  test('--stdout prints HTML and writes no file', () => {
    scaffoldProject();
    const r = runPanTools('hud --stdout', cwd);
    assert.equal(r.success, true, r.error);
    assert.match(r.output, /<!DOCTYPE html>/);
    assert.ok(!fs.existsSync(path.join(cwd, '.planning', 'hud.html')), 'no file written');
  });
});

describe('hud — resilient to junk data (field report 2026-06)', () => {
  test('a poisoned ledger shows a reset advisory, not $millions', () => {
    scaffoldProject();
    const poison = [];
    for (let i = 0; i < 5; i++) {
      poison.push(JSON.stringify({ ts: '2026-06-12T08:00:00Z', agent: 'workflow-subagent', model: 'claude-opus-4-8', input_tokens: 1000000, output_tokens: 2000000, cache_read_tokens: 9000000000 }));
    }
    poison.push(JSON.stringify({ ts: '2026-06-12T08:00:00Z', agent: 'pan-planner', model: 'claude-opus-4-8', input_tokens: 1000, output_tokens: 200, cache_read_tokens: 50 }));
    W('.planning/metrics/tokens.jsonl', poison.join('\n') + '\n');
    const d = hud.collectHudData(cwd, { now: NOW });
    assert.ok(d.telemetry.totals.suspect_excluded >= 5, 'implausible records quarantined');
    const html = hud.renderHud(d);
    assert.match(html, /legacy ledger — unreliable/);
    assert.ok(!/\$9000000/.test(html) && !/\$45000/.test(html), 'no absurd cost rendered');
  });

  test('no package.json name → title falls back to the directory name, not "Untitled project"', () => {
    W('.planning/state.md', '**Status:** in_progress\n');
    const d = hud.collectHudData(cwd, { now: NOW });
    assert.equal(d.project.name, null);
    assert.ok(d.project.dir_name && d.project.dir_name.length > 0, 'dir_name populated');
    const html = hud.renderHud(d);
    assert.ok(!/Untitled project/.test(html), 'uses the directory name');
    assert.match(html, new RegExp(d.project.dir_name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  });
});
