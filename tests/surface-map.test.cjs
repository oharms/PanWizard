/**
 * Surface map — every shipped surface row is named by a test, or sits in the
 * allowlist with a reason (spec docs/specs/testing-system-redesign-2026-09.md §3.1).
 *
 * The rows come from the code (scripts/test-surface.cjs), not from the tests, so a
 * new verb, flag, hook registration, MCP tool or config key shows up here as a
 * failure until a test names it. The committed registry tests/fixtures/surface.json
 * is the reviewable copy; it must match the extraction.
 */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  ROOT, REGISTRY_REL, ALLOWLIST_REL, extractSurface, surfaceRows, mapSurface, loadTestSources, diffSurface,
  LIVENESS_ALLOWLIST_REL, pantoolsCalls, loadLivenessInputs, stripDefaultsBuilder, liveness, livenessProblems, checkReport, readLivenessAllowlist,
} = require('../scripts/test-surface.cjs');

describe('surface map — the code names the surface, the tests must name it back', () => {
  const surface = extractSurface(ROOT);
  const rows = mapSurface(surfaceRows(surface), loadTestSources(ROOT));

  test('the committed registry matches the code (run `node scripts/test-surface.cjs --write` after a surface change)', () => {
    const committed = JSON.parse(fs.readFileSync(path.join(ROOT, REGISTRY_REL), 'utf8'));
    const d = diffSurface(committed, surface);
    assert.deepEqual(d, { added: [], removed: [] }, `registry drift — added ${JSON.stringify(d.added)} removed ${JSON.stringify(d.removed)}`);
  });

  test('the extraction is not vacuous: the known surface is present', () => {
    assert.ok(surface.verbs.includes('state') && surface.verbs.includes('cost'));
    assert.ok(surface.subcommands.includes('state snapshot') && surface.subcommands.includes('cost rebuild'));
    assert.ok(surface.case_arms.includes('state') && surface.case_arms.length > 50);
    assert.ok(surface.installer_flags.includes('--claude') && surface.installer_flags.includes('--unified-skills'));
    assert.ok(surface.hooks.some((h) => h.runtime === 'codex' && h.hook === 'pan-cost-logger.js'));
    assert.ok(!surface.hooks.some((h) => h.runtime === 'opencode'), 'OpenCode has no hook system');
    assert.ok(surface.mcp.tools.includes('pan_next_action') && surface.mcp.resources.includes('pan://health'));
    assert.ok(surface.config_keys.includes('commit_docs') && surface.config_keys.some((k) => k.startsWith('budget.')));
    assert.deepEqual(Object.keys(surface.content).sort(), ['agents', 'commands/pan', 'pan-wizard-core/workflows']);
  });

  test('every surface row is referenced by a test, or allowlisted with a reason that is still true', () => {
    let allowlist = [];
    try { allowlist = JSON.parse(fs.readFileSync(path.join(ROOT, ALLOWLIST_REL), 'utf8')); } catch { /* none */ }
    const allow = new Map(allowlist.map((a) => [a.id, a]));
    const problems = [];
    for (const a of allowlist) {
      if (!a.reason || !String(a.reason).trim()) problems.push(`allowlist entry ${a.id} has no reason`);
      const row = rows.find((r) => r.id === a.id);
      if (!row) problems.push(`allowlist entry ${a.id} names a surface row that no longer exists — remove it`);
      else if (row.hits.length) problems.push(`allowlist entry ${a.id} is referenced now by ${row.hits[0]} — remove the entry`);
    }
    const missing = rows.filter((r) => !r.hits.length && !allow.has(r.id));
    for (const r of missing) problems.push(`no test names ${r.id} — write one (\`node scripts/test-surface.cjs --scaffold <dir>\` emits a stub) or allowlist it in ${ALLOWLIST_REL} with a reason`);
    assert.deepEqual(problems, [], problems.join('\n'));
  });

  test('the map itself can fail: a row nothing names is reported missing, a named one is found', () => {
    // A subcommand name no test file can contain (this file included) — built at run time.
    const never = `zz-never-${process.pid}-${Date.now()}`;
    const fake = mapSurface([{ id: `sub:state ${never}`, kind: 'sub', verb: 'state', sub: never }, { id: 'sub:state snapshot', kind: 'sub', verb: 'state', sub: 'snapshot' }], loadTestSources(ROOT));
    assert.equal(fake[0].hits.length, 0);
    assert.ok(fake[1].hits.length > 0);
  });
});

describe('liveness registry (program L1) — every command, agent, verb and config key has a user', () => {
  const surface = extractSurface(ROOT);
  const inputs = loadLivenessInputs(ROOT);
  const rows = liveness(surface, inputs);
  const allowlist = readLivenessAllowlist(ROOT);
  const committed = JSON.parse(fs.readFileSync(path.join(ROOT, REGISTRY_REL), 'utf8'));
  const users = (id) => (rows.find((r) => r.id === id) || { users: null }).users;
  // A name no file in the tree can contain, built at run time.
  const never = `zz${process.pid}x${Date.now()}`;

  test('the tree is clean: every orphan is allowlisted with a reason, and no entry is stale', () => {
    assert.deepEqual(livenessProblems(rows, allowlist), []);
  });

  test('the registry is not vacuous: known users are found', () => {
    assert.ok(users('command:quick').some((f) => f.endsWith('quick-mode.json')), 'quick-mode scenario runs /pan:quick');
    assert.ok(users('agent:pan-executor').length > 0);
    assert.ok(users('caller:verb:state').length > 0);
    assert.ok(users('caller:sub:validate health').some((u) => u.startsWith('mcp:')), 'pan://health calls validate health');
    assert.ok(users('reader:config:workflow.phase_gate').length > 0);
    assert.ok(rows.filter((r) => r.kind === 'command').length === surface.content['commands/pan'].length);
  });

  test('--check fails on a seeded orphan command, verb, subcommand and config key', () => {
    const seeded = JSON.parse(JSON.stringify(surface));
    seeded.content['commands/pan'].push(`${never}.md`);
    seeded.verbs.push(`${never}-verb`);
    seeded.subcommands.push(`state ${never}`);
    seeded.config_keys.push(`workflow.${never}_key`);
    const r = checkReport(seeded, seeded, inputs, allowlist);
    assert.equal(r.ok, false);
    assert.deepEqual(r.drift, { added: [], removed: [] }, 'the seeds are liveness problems, not registry drift');
    for (const id of [`command:${never}`, `caller:verb:${never}-verb`, `caller:sub:state ${never}`, `reader:config:workflow.${never}_key`]) {
      assert.ok(r.live.some((p) => p.startsWith(`orphan ${id} `)), `${id} not reported: ${r.live.join('\n')}`);
    }
    assert.equal(checkReport(committed, surface, inputs, allowlist).ok, true, 'the unseeded tree passes');
  });

  test('a stale or reasonless allowlist entry fails', () => {
    const used = rows.find((r) => r.users.length);
    const p = livenessProblems(rows, [...allowlist, { id: used.id, reason: 'x' }, { id: `command:${never}`, reason: 'gone' }, { ...allowlist[0], reason: '' }]);
    assert.ok(p.some((x) => x.includes(`${used.id} has a user now`)));
    assert.ok(p.some((x) => x.includes(`command:${never} names nothing`)));
    assert.ok(p.some((x) => x.includes('has no reason')));
  });

  test('a user added for an orphan is found (the seed comes alive)', () => {
    const seeded = JSON.parse(JSON.stringify(surface));
    seeded.verbs.push(`${never}-verb`);
    seeded.content.agents.push(`${never}-agent.md`);
    const withUsers = {
      ...inputs,
      prompts: [...inputs.prompts, { file: 'commands/pan/x.md', src: `Run \`node "$PT/pan-tools.cjs" ${never}-verb now\`` }],
      scenarios: [...inputs.scenarios, { file: 'harness/scenarios/x.json', src: `{"prompt": "spawn ${never}-agent"}` }],
    };
    const r = liveness(seeded, withUsers);
    assert.deepEqual(r.find((x) => x.id === `caller:verb:${never}-verb`).users, ['commands/pan/x.md']);
    assert.deepEqual(r.find((x) => x.id === `agent:${never}-agent`).users, ['harness/scenarios/x.json']);
  });

  test('pantoolsCalls reads the invocation shapes prompts use', () => {
    const c = pantoolsCalls('node "$HOME/.claude/pan-wizard-core/bin/pan-tools.cjs" phase complete 3\n`pan-tools state load`\necho {} \\\n  | pan-tools focus reflection\nprose about pan-tools is not a call.');
    assert.ok(c.has('phase complete') && c.has('phase') && c.has('state load') && c.has('focus reflection'));
    assert.equal(c.has('is not'), false);
  });

  test('writing a default is not reading it', () => {
    const src = "function buildConfigDefaults() {\n  return { workflow: { only_here: true } };\n}\nconst x = cfg.workflow.read_here;";
    const stripped = stripDefaultsBuilder(src);
    assert.equal(stripped.includes('only_here'), false);
    assert.ok(stripped.includes('read_here'));
  });

  test('the CLI --check exits 0 on the tree', () => {
    const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'test-surface.cjs'), '--check'], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /every command, agent, verb and config key is alive/);
  });

  test(`${LIVENESS_ALLOWLIST_REL} reasons are specific to the kind of orphan`, () => {
    for (const a of allowlist) {
      const kind = a.id.split(':')[0];
      if (kind === 'command' || kind === 'agent') assert.match(a.reason, /harness scenario/, a.id);
      if (kind === 'caller') assert.match(a.reason, /prompt/, a.id);
      if (kind === 'reader') assert.match(a.reason, /default/, a.id);
    }
  });
});
