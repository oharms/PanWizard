/**
 * Program L7: consolidate overlapping surfaces.
 *
 * Commands that did the same job as another become a flag of it, and their old names
 * keep working: COMMAND_ALIASES (constants.cjs) maps each old name to its new form, and
 * the installer writes an alias command for every entry on every runtime
 * (tests/scenarios/command-aliases.test.cjs). discord and mcp-bridge are retired.
 * progress, resume and transition share one next-action router (`pan-tools next-action`),
 * built on the MCP orchestrator's state machine.
 */
'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const commandExists = (name) => fs.existsSync(path.join(ROOT, 'commands', 'pan', `${name}.md`));

const EXPECTED = {
  dashboard: { to: 'hud', args: '' },
  'milestone-cleanup': { to: 'milestone-done', args: '--cleanup' },
  'milestone-gaps': { to: 'milestone-audit', args: '--gaps' },
  optimize: { to: 'learn', args: '--optimize' },
  'research-phase': { to: 'plan-phase', args: '--research-only' },
  profile: { to: 'settings', args: '--profile' },
  'focus-doc-audit': { to: 'focus-docs', args: '' },
  'focus-sync': { to: 'focus-docs', args: '--sync' },
  'focus-scan': { to: 'focus-auto', args: '--step scan' },
  'focus-plan': { to: 'focus-auto', args: '--step plan' },
  'focus-exec': { to: 'focus-auto', args: '--step exec' },
  'focus-drift-walking': { to: 'focus-auto', args: '--step drift' },
};

describe('renamed commands are aliases of their new form (L7)', () => {
  const { COMMAND_ALIASES, COMMAND_RENAME_MAP, RETIRED_COMMANDS } = require('../pan-wizard-core/bin/lib/constants.cjs');

  test('the alias table holds every consolidation', () => {
    assert.deepEqual(COMMAND_ALIASES, EXPECTED);
  });

  test('every alias points at a shipped command, and no alias name is still a source command', () => {
    for (const [old, a] of Object.entries(COMMAND_ALIASES)) {
      assert.ok(commandExists(a.to), `${old} → ${a.to}: target missing`);
      assert.ok(!commandExists(old), `${old} is an alias now; its source command must be gone`);
    }
  });

  test('stale-doc detection knows the new names', () => {
    for (const [old, a] of Object.entries(COMMAND_ALIASES)) {
      assert.equal(COMMAND_RENAME_MAP[old], a.args ? `${a.to} ${a.args}` : a.to, old);
    }
  });

  test('discord and mcp-bridge are retired', () => {
    assert.deepEqual([...RETIRED_COMMANDS].sort(), ['discord', 'mcp-bridge']);
    for (const r of RETIRED_COMMANDS) assert.ok(!commandExists(r), `${r} must be removed`);
  });

  test('renderCommandAlias turns the target into the old name with its flags preset', () => {
    const { renderCommandAlias } = require('../bin/install-lib.cjs');
    const target = '---\nname: pan:learn\ngroup: Learning\ndescription: Learn from the project\n---\n<objective>\nLearn.\n</objective>\n';
    const out = renderCommandAlias(target, 'optimize', { to: 'learn', args: '--optimize' });
    assert.match(out, /^---\nname: pan:optimize\n/);
    assert.match(out, /description: "Renamed: now \/pan:learn --optimize\. Learn from the project"/);
    assert.match(out, /`\/pan:optimize` is now `\/pan:learn --optimize`/);
    assert.match(out, /--optimize \$ARGUMENTS/);
    assert.match(out, /<objective>\nLearn\.\n<\/objective>/, 'the target body follows unchanged');
    // A target whose name has no pan: prefix (the focus commands) keeps that shape.
    const bare = renderCommandAlias('---\nname: focus-auto\ndescription: Auto\n---\nBody\n', 'focus-scan', { to: 'focus-auto', args: '--step scan' });
    assert.match(bare, /^---\nname: focus-scan\n/);
  });
});

describe('the absorbing commands route the old behaviour (L7)', () => {
  const ROUTES = [
    ['plan-phase', '--research-only', 'workflows/research-phase.md'],
    ['learn', '--optimize', 'workflows/optimize.md'],
    ['settings', '--profile', 'workflows/profile.md'],
    ['milestone-done', '--cleanup', 'workflows/milestone-cleanup.md'],
    ['milestone-audit', '--gaps', 'workflows/milestone-gaps.md'],
    ['focus-docs', '--sync', 'workflows/focus-sync.md'],
    ['focus-docs', '', 'workflows/focus-doc-audit.md'],
    ['focus-auto', '--step scan', 'workflows/focus-scan.md'],
    ['focus-auto', '--step plan', 'workflows/focus-plan.md'],
    ['focus-auto', '--step exec', 'workflows/focus-exec.md'],
    ['focus-auto', '--step drift', 'workflows/focus-drift-walking.md'],
  ];
  for (const [cmd, flag, wf] of ROUTES) {
    test(`/pan:${cmd} ${flag || '(default)'} follows ${wf}`, () => {
      const t = read(`commands/pan/${cmd}.md`);
      if (flag) assert.ok(t.includes(flag), `${cmd} must document ${flag}`);
      assert.ok(t.includes(wf), `${cmd} must route to ${wf}`);
      assert.ok(fs.existsSync(path.join(ROOT, 'pan-wizard-core', wf)), `${wf} must exist`);
    });
  }

  test('no shipped prompt still sends the user to an old or retired name', () => {
    const { COMMAND_ALIASES, RETIRED_COMMANDS } = require('../pan-wizard-core/bin/lib/constants.cjs');
    const names = [...Object.keys(COMMAND_ALIASES), ...RETIRED_COMMANDS];
    const re = new RegExp(`/pan[:-](${names.map((n) => n.replace(/-/g, '\\-')).join('|')})(?![\\w-])`);
    const offenders = [];
    const walk = (dir) => {
      for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
        const rel = `${dir}/${e.name}`;
        if (e.isDirectory()) walk(rel);
        else if (/\.(md|cjs|js)$/.test(e.name)) {
          const lines = read(rel).split('\n');
          lines.forEach((l, i) => { if (re.test(l)) offenders.push(`${rel}:${i + 1}: ${l.trim().slice(0, 100)}`); });
        }
      }
    };
    for (const d of ['commands', 'agents', 'pan-wizard-core/workflows', 'pan-wizard-core/references', 'pan-wizard-core/templates', 'hooks']) walk(d);
    assert.deepEqual(offenders, []);
  });

  test('review-deep no longer publishes to a channel nothing reads', () => {
    assert.ok(!read('pan-wizard-core/bin/lib/review-deep.cjs').includes("'review-handoff'"));
    assert.ok(!read('commands/pan/review-deep.md').includes('review-handoff'));
  });
});

describe('one next-action router (L7)', () => {
  const { diskSnapshot, routeNextAction } = require('../pan-wizard-core/bin/lib/next-action.cjs');

  function project(phases) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-next-'));
    const p = path.join(dir, '.planning');
    fs.mkdirSync(path.join(p, 'phases'), { recursive: true });
    fs.writeFileSync(path.join(p, 'project.md'), '# P\n');
    fs.writeFileSync(path.join(p, 'requirements.md'), '# R\n');
    let roadmap = '# Roadmap\n\n## Phases\n\n';
    for (const ph of phases) roadmap += `- [${ph.ticked ? 'x' : ' '}] **Phase ${ph.n}: P${ph.n}**\n`;
    roadmap += '\n';
    for (const ph of phases) {
      roadmap += `### Phase ${ph.n}: P${ph.n}\n**Goal:** g\n\n`;
      const d = path.join(p, 'phases', `0${ph.n}-p${ph.n}`);
      fs.mkdirSync(d);
      for (let i = 1; i <= (ph.plans || 0); i++) fs.writeFileSync(path.join(d, `0${ph.n}-0${i}-plan.md`), 'x');
      for (let i = 1; i <= (ph.summaries || 0); i++) fs.writeFileSync(path.join(d, `0${ph.n}-0${i}-summary.md`), 'x');
      if (ph.verified) fs.writeFileSync(path.join(d, `0${ph.n}-verification.md`), 'x');
      if (ph.uatGaps) fs.writeFileSync(path.join(d, `0${ph.n}-uat.md`), '---\nstatus: diagnosed\n---\n');
    }
    fs.writeFileSync(path.join(p, 'roadmap.md'), roadmap);
    return dir;
  }

  const cases = [
    ['an unplanned phase is planned', [{ n: 1 }], 'plan', '/pan:plan-phase 1'],
    ['a planned phase is executed', [{ n: 1, plans: 2 }], 'execute', '/pan:exec-phase 1'],
    ['a half-executed phase resumes, never re-plans', [{ n: 1, plans: 2, summaries: 1 }], 'execute', '/pan:exec-phase 1'],
    ['a complete phase is verified', [{ n: 1, plans: 1, summaries: 1 }], 'verify', '/pan:verify-phase 1'],
    ['a verified phase is completed', [{ n: 1, plans: 1, summaries: 1, verified: true }], 'complete_phase', 'pan-tools phase complete 1'],
    ['a finished phase moves to the next', [{ n: 1, plans: 1, summaries: 1, verified: true, ticked: true }, { n: 2 }], 'plan', '/pan:plan-phase 2'],
    ['diagnosed UAT gaps are planned first', [{ n: 1, plans: 1, summaries: 1, uatGaps: true }], 'plan_gaps', '/pan:plan-phase 1 --gaps'],
    ['a finished milestone is audited', [{ n: 1, plans: 1, summaries: 1, verified: true, ticked: true }], 'audit_milestone', '/pan:milestone-audit'],
  ];
  for (const [name, phases, action, command] of cases) {
    test(name, () => {
      const dir = project(phases);
      try {
        const r = routeNextAction(dir);
        assert.equal(r.action, action, JSON.stringify(r));
        assert.equal(r.command, command);
      } finally { fs.rmSync(dir, { recursive: true, force: true }); }
    });
  }

  test('between milestones the router starts the next one', () => {
    const dir = project([{ n: 1, plans: 1, summaries: 1, verified: true, ticked: true }]);
    try {
      fs.rmSync(path.join(dir, '.planning', 'requirements.md'));
      assert.equal(routeNextAction(dir).action, 'new_milestone');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('the snapshot uses the disk vocabulary the state machine keys on', () => {
    const dir = project([{ n: 1, plans: 2, summaries: 1 }]);
    try {
      assert.deepEqual(diskSnapshot(dir).phases.map((p) => p.status), ['partial']);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('progress, resume and transition ask the router', () => {
    for (const wf of ['progress', 'resume-project', 'transition']) {
      assert.match(read(`pan-wizard-core/workflows/${wf}.md`), /pan-tools\.cjs next-action/, wf);
    }
  });
});
