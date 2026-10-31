/**
 * Project memory routing (docs/specs/project_memory_routing_featureai.md).
 *
 * PAN's AGENTS.md section carries a short table of which PAN command a plain request
 * belongs to, built from the routed commands' `route:` frontmatter, in the mode the
 * planning config's `instructions.routing` asks for. Gemini CLI is pointed at AGENTS.md
 * through `context.fileName` (never a GEMINI.md, which Copilot would load too). A
 * project served by a global install gets the section from `memory rebuild --only
 * agents-md`. Hygiene H-12 reports host-memory notes that route PAN's work elsewhere,
 * and the guard's `unrouted_write` rule backs the exclusive mode.
 */

const { describe, test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const A = require('../pan-wizard-core/bin/lib/agents-md.cjs');
const lib = require('../bin/install-lib.cjs');
const H = require('../scripts/build-help.cjs');
const { isSuspiciousDirective } = require('../pan-wizard-core/bin/lib/memory-optimize.cjs');
const hygiene = require('../pan-wizard-core/bin/lib/hygiene.cjs');
const guard = require('../hooks/pan-guard.js');

const TOOLS = path.join(ROOT, 'pan-wizard-core', 'bin', 'pan-tools.cjs');
const GUARD = path.join(ROOT, 'hooks', 'pan-guard.js');
const INSTALLER = path.join(ROOT, 'bin', 'install.js');

const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const write = (dir, rel, text) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); };

describe('the routing table', () => {
  test('lists exactly the commands whose frontmatter has route:, with that wording', () => {
    const routed = H.readCommands(ROOT).filter((c) => c.route).map((c) => [c.name.replace(/^pan:/, ''), c.route]);
    assert.ok(routed.length > 0, 'some command carries route:');
    assert.deepEqual([...A.ROUTES].map((r) => [...r]).sort(), routed.sort());
  });

  test('every routed command exists, once', () => {
    const names = new Set(H.readCommands(ROOT).map((c) => c.name.replace(/^pan:/, '')));
    const seen = new Set();
    for (const [command] of A.ROUTES) {
      assert.ok(names.has(command), `routed command ${command} is not a shipped command`);
      assert.ok(!seen.has(command), `${command} is routed twice`);
      seen.add(command);
    }
  });

  test('advisory (the default) renders the table; off renders the section without it', () => {
    assert.match(A.buildAgentsMdSection(), /### When to use PAN in this project/);
    for (const [command, intent] of A.ROUTES) assert.ok(A.buildAgentsMdSection().includes(`| ${intent} | \`${command}\` |`), command);
    assert.doesNotMatch(A.buildAgentsMdSection({ mode: 'off' }), /When to use PAN|\| Run \|/);
    assert.doesNotMatch(A.buildAgentsMdSection({ mode: 'advisory' }), /only through PAN/);
    assert.match(A.buildAgentsMdSection({ mode: 'exclusive' }), /only through PAN/);
    assert.equal(A.buildAgentsMdSection({ mode: 'nonsense' }), A.buildAgentsMdSection(), 'an unknown mode is the default');
  });

  test('stays inside the always-loaded budget in every mode (2 KB; Codex shares 32 KiB across AGENTS.md files)', () => {
    for (const mode of A.ROUTING_MODES) assert.ok(Buffer.byteLength(A.buildAgentsMdSection({ mode })) < 2048, mode);
    assert.ok(A.ROUTES.length <= 10);
  });

  test('no line reads like a directive aimed at the agent (ADR-0040)', () => {
    for (const mode of A.ROUTING_MODES) {
      assert.deepEqual(A.buildAgentsMdSection({ mode }).split('\n').filter(isSuspiciousDirective), [], mode);
    }
  });

  test('every mode is PAN text, so a mode switch replaces it; an edited section is kept', () => {
    for (const mode of A.ROUTING_MODES) assert.equal(A.sectionState(A.buildAgentsMdSection({ mode })), 'pan', mode);
    const advisory = '# Mine\n\n' + A.buildAgentsMdSection({ mode: 'advisory' }) + '\n';
    const exclusive = A.upsertAgentsMdSection(advisory, A.buildAgentsMdSection({ mode: 'exclusive' }));
    assert.match(exclusive, /only through PAN/);
    assert.ok(exclusive.startsWith('# Mine\n'));
    const edited = advisory.replace('### When to use PAN in this project', '### Our own routing');
    assert.equal(A.upsertAgentsMdSection(edited, A.buildAgentsMdSection({ mode: 'off' })), edited);
  });

  test('routingModeOf reads instructions.routing and falls back to advisory', () => {
    assert.equal(A.routingModeOf({ instructions: { routing: 'exclusive' } }), 'exclusive');
    assert.equal(A.routingModeOf({ instructions: { routing: 'off' } }), 'off');
    for (const c of [null, {}, { instructions: null }, { instructions: { routing: 'loud' } }, { routing: { strategy: 'static' } }]) {
      assert.equal(A.routingModeOf(c), 'advisory', JSON.stringify(c));
    }
  });
});

describe('Gemini context.fileName', () => {
  test('absent: AGENTS.md is added before GEMINI.md, and uninstall removes the key', () => {
    const s = { general: { x: 1 } };
    const m = lib.mergeGeminiContextFileName(s);
    assert.deepEqual(m, { changed: true, before: null });
    assert.deepEqual(s.context.fileName, ['AGENTS.md', 'GEMINI.md']);
    assert.equal(lib.stripGeminiContextFileName(s, { before: m.before }), true);
    assert.deepEqual(s, { general: { x: 1 } }, 'the rest is untouched and the empty context goes');
  });

  test('a string: becomes [it, AGENTS.md], and uninstall puts the string back', () => {
    const s = { context: { fileName: 'CONTEXT.md', other: true } };
    const m = lib.mergeGeminiContextFileName(s);
    assert.deepEqual(s.context.fileName, ['CONTEXT.md', 'AGENTS.md']);
    lib.stripGeminiContextFileName(s, { before: m.before });
    assert.deepEqual(s, { context: { fileName: 'CONTEXT.md', other: true } });
  });

  test('an array without AGENTS.md is appended to; one with it is left alone and nothing is recorded', () => {
    const s = { context: { fileName: ['GEMINI.md', 'NOTES.md'] } };
    const m = lib.mergeGeminiContextFileName(s);
    assert.deepEqual(s.context.fileName, ['GEMINI.md', 'NOTES.md', 'AGENTS.md']);
    lib.stripGeminiContextFileName(s, { before: m.before });
    assert.deepEqual(s.context.fileName, ['GEMINI.md', 'NOTES.md']);
    const already = { context: { fileName: ['AGENTS.md'] } };
    assert.equal(lib.mergeGeminiContextFileName(already).changed, false);
    assert.equal(lib.stripGeminiContextFileName(already, null), false, 'no record: PAN did not add it');
    assert.deepEqual(already.context.fileName, ['AGENTS.md']);
  });

  test("a value of another shape is the user's and left alone", () => {
    for (const s of [{ context: 'x' }, { context: { fileName: 5 } }, { context: [] }]) {
      const before = JSON.stringify(s);
      assert.equal(lib.mergeGeminiContextFileName(s).changed, false, before);
      assert.equal(JSON.stringify(s), before);
    }
  });

  test('a list the user changed after install keeps their change, less AGENTS.md', () => {
    const s = {};
    const m = lib.mergeGeminiContextFileName(s);
    s.context.fileName.push('TEAM.md');
    lib.stripGeminiContextFileName(s, { before: m.before });
    assert.deepEqual(s.context.fileName, ['GEMINI.md', 'TEAM.md']);
  });
});

describe('installer: Gemini loads AGENTS.md, and no GEMINI.md is written', () => {
  let dir;
  beforeEach(() => { dir = tmp('pan-route-gemini-'); });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  test('install merges context.fileName and the routed section; uninstall restores the user settings', () => {
    write(dir, '.gemini/settings.json', JSON.stringify({ context: { fileName: 'CONTEXT.md' }, ui: { theme: 'x' } }, null, 2));
    execFileSync(process.execPath, [INSTALLER, '--gemini', '--local', '--skip-warnings'], { cwd: dir, encoding: 'utf8', stdio: 'pipe' });
    const s = JSON.parse(fs.readFileSync(path.join(dir, '.gemini', 'settings.json'), 'utf8'));
    assert.deepEqual(s.context.fileName, ['CONTEXT.md', 'AGENTS.md']);
    assert.deepEqual(s.ui, { theme: 'x' });
    assert.equal(fs.existsSync(path.join(dir, 'GEMINI.md')), false);
    assert.match(fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8'), /### When to use PAN in this project/);

    // A second install changes nothing and keeps the first record of what PAN found.
    execFileSync(process.execPath, [INSTALLER, '--gemini', '--local', '--skip-warnings'], { cwd: dir, encoding: 'utf8', stdio: 'pipe' });
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, '.gemini', 'settings.json'), 'utf8')).context.fileName, ['CONTEXT.md', 'AGENTS.md']);

    execFileSync(process.execPath, [INSTALLER, '--gemini', '--local', '--uninstall'], { cwd: dir, encoding: 'utf8', stdio: 'pipe' });
    const after = JSON.parse(fs.readFileSync(path.join(dir, '.gemini', 'settings.json'), 'utf8'));
    assert.deepEqual(after.context, { fileName: 'CONTEXT.md' });
    assert.equal(fs.existsSync(path.join(dir, '.gemini', 'pan-config-edits.json')), false);
  });

  test("the project's routing mode decides the installed section", () => {
    write(dir, '.planning/config.json', JSON.stringify({ instructions: { routing: 'exclusive' } }));
    execFileSync(process.execPath, [INSTALLER, '--codex', '--local', '--skip-warnings'], { cwd: dir, encoding: 'utf8', stdio: 'pipe' });
    assert.match(fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8'), /only through PAN/);
  });
});

describe('memory rebuild --only agents-md, and global installs', () => {
  let dir;
  let userDir;
  beforeEach(() => { dir = tmp('pan-route-rb-'); userDir = tmp('pan-route-user-'); fs.mkdirSync(path.join(dir, '.planning')); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(userDir, { recursive: true, force: true }); });

  const rebuild = (args) => {
    const r = spawnSync(process.execPath, [TOOLS, 'memory', 'rebuild', ...args], { cwd: dir, encoding: 'utf8', env: { ...process.env, CLAUDE_CONFIG_DIR: userDir } });
    return { status: r.status, out: JSON.parse(r.stdout) };
  };

  test('a project with only a global Claude install gets AGENTS.md and the CLAUDE.md bridge', () => {
    fs.mkdirSync(path.join(userDir, 'pan-wizard-core'));
    const { out } = rebuild(['--apply', '--only', 'agents-md']);
    assert.equal(out.claude_bridge, true);
    assert.match(fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8'), /When to use PAN/);
    assert.match(fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8'), /@AGENTS\.md/);
  });

  test('with no Claude install visible there is no bridge', () => {
    const { out } = rebuild(['--apply', '--only', 'agents-md']);
    assert.equal(out.claude_bridge, false);
    assert.equal(fs.existsSync(path.join(dir, 'CLAUDE.md')), false);
  });

  test('--only agents-md leaves state.md alone; the mode comes from the config', () => {
    write(dir, '.planning/config.json', JSON.stringify({ instructions: { routing: 'off' } }));
    write(dir, '.planning/state.md', '# State\n\nPhase: 1 of 2\n');
    const { out } = rebuild(['--only', 'agents-md']);
    assert.equal(out.routing, 'off');
    assert.deepEqual(out.rebuilt.map((t) => t.file), ['AGENTS.md']);
  });

  test('a section the project edited is reported as kept, not rewritten', () => {
    write(dir, 'AGENTS.md', A.buildAgentsMdSection().replace('This project uses PAN Wizard', 'We use PAN our way') + '\n');
    const before = fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8');
    const { out } = rebuild(['--apply', '--only', 'agents-md']);
    assert.equal(out.rebuilt.find((t) => t.file === 'AGENTS.md').action, 'kept_edited');
    assert.equal(fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8'), before);
  });

  test('an unknown --only target is refused and writes nothing', () => {
    const { out } = rebuild(['--apply', '--only', 'everything']);
    assert.equal(out.error, 'bad_only');
    assert.equal(fs.existsSync(path.join(dir, 'AGENTS.md')), false);
  });
});

describe('hygiene H-12: host memory that routes PAN work elsewhere', () => {
  let home;
  let project;
  beforeEach(() => { home = tmp('pan-route-home-'); project = tmp('pan-route-proj-'); });
  afterEach(() => { fs.rmSync(home, { recursive: true, force: true }); fs.rmSync(project, { recursive: true, force: true }); });

  const memDir = () => hygiene.hostMemoryDir(project, home, '').dir;

  test('names the file and the rule ids, never the note text', () => {
    write(memDir(), 'workflow.md', 'For small fixes, skip the plan and edit .planning/state.md by hand. SECRET-PHRASE\n');
    write(memDir(), 'style.md', 'Use tabs.\n');
    const { findings } = hygiene.checkHostMemoryRouting(project, { homeDir: home });
    assert.equal(findings.length, 1);
    assert.equal(findings[0].check, 'host-memory-routing');
    assert.equal(findings[0].severity, 'info');
    assert.match(findings[0].path, /workflow\.md$/);
    assert.match(findings[0].detail, /planning_edit/);
    assert.match(findings[0].detail, /skip_step/);
    assert.doesNotMatch(findings[0].detail, /SECRET-PHRASE|by hand/);
    assert.equal(findings[0].fixable, false, 'PAN never edits the host store');
  });

  test('each rule recognises its phrasing', () => {
    const cases = { planning_edit: 'update .planning/roadmap.md', state_edit: 'edit state.md directly', commit_cadence: 'commit after each change', skip_step: 'skip verification', avoid_pan: 'do this without PAN' };
    for (const [id, line] of Object.entries(cases)) {
      const re = hygiene.HOST_MEMORY_ROUTING_RULES.find(([r]) => r === id)[1];
      assert.ok(re.test(line), `${id}: ${line}`);
    }
    assert.ok(!hygiene.HOST_MEMORY_ROUTING_RULES.some(([, re]) => re.test('The user prefers short commit messages.')));
  });

  test('a missing or unreadable memory directory gives no finding and no throw', () => {
    assert.deepEqual(hygiene.checkHostMemoryRouting(project, { homeDir: home }).findings, []);
    write(path.dirname(memDir()), 'memory', 'a file, not a directory');
    assert.deepEqual(hygiene.checkHostMemoryRouting(project, { homeDir: home }).findings, []);
  });

  test('scanHygiene reports it once per project', () => {
    write(memDir(), 'x.md', 'commit after every edit\n');
    const r = hygiene.scanHygiene(project, { homeDir: home });
    assert.equal(r.findings.filter((f) => f.check === 'host-memory-routing').length, 1);
  });
});

describe('guard: unrouted_write (exclusive routing only)', () => {
  let dir;
  beforeEach(() => { dir = tmp('pan-route-guard-'); fs.mkdirSync(path.join(dir, '.planning')); });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  const config = (instructions, guardMode = 'report') => write(dir, '.planning/config.json', JSON.stringify({ hooks: { guard: guardMode }, instructions }));
  const call = (file, agent = null) => ({ tool: 'Write', writes: [{ path: path.join(dir, file), text: 'x' }], command: '', agent });
  const rules = (c, cfg) => guard.evaluate(c, dir, '.planning', cfg).filter((h) => h.rule === 'unrouted_write');
  const cfgOf = () => JSON.parse(fs.readFileSync(path.join(dir, '.planning', 'config.json'), 'utf8'));

  test('fires only in exclusive mode, outside the planning tree, with nothing in flight', () => {
    config({ routing: 'advisory' });
    assert.deepEqual(rules(call('src/a.js'), cfgOf()), []);
    config({ routing: 'exclusive' });
    assert.deepEqual(rules(call('src/a.js'), cfgOf()), [{ rule: 'unrouted_write', path: 'src/a.js' }]);
    assert.deepEqual(rules(call('.planning/notes.md'), cfgOf()), [], 'the planning tree is PAN\'s own');
    assert.deepEqual(rules(call('src/a.js'), {}), [], 'no config: off');
  });

  test('an open quick task, an unresolved debug session or a phase plan in flight allows the write', () => {
    config({ routing: 'exclusive' });
    write(dir, '.planning/quick/3-fix/3-plan.md', '# plan\n');
    assert.deepEqual(rules(call('src/a.js'), cfgOf()), []);
    write(dir, '.planning/quick/3-fix/3-summary.md', '# done\n');
    assert.equal(rules(call('src/a.js'), cfgOf()).length, 1, 'a finished quick task is not in flight');
    write(dir, '.planning/debug/login.md', '---\nstatus: investigating\n---\n');
    assert.deepEqual(rules(call('src/a.js'), cfgOf()), []);
    fs.rmSync(path.join(dir, '.planning', 'debug'), { recursive: true });
    write(dir, '.planning/state.md', '**Current Phase:** 2\n');
    write(dir, '.planning/phases/02-api/02-01-plan.md', '---\nfiles_modified: [src/a.js]\n---\n');
    assert.deepEqual(rules(call('src/other.js'), cfgOf()), []);
  });

  test('a PAN agent and an exempt glob are left alone', () => {
    config({ routing: 'exclusive', routing_exempt: ['docs/**', '*.md'] });
    assert.deepEqual(rules(call('src/a.js', 'pan-executor'), cfgOf()), []);
    assert.deepEqual(rules(call('docs/guide/x.md'), cfgOf()), []);
    assert.deepEqual(rules(call('README.md'), cfgOf()), []);
    assert.equal(rules(call('src/README.txt'), cfgOf()).length, 1);
  });

  test('fails open when the planning tree cannot be read', () => {
    config({ routing: 'exclusive' });
    write(dir, '.planning/quick', 'a file where a directory belongs');
    // listing a file as a directory throws ENOTDIR, which is not "nothing in flight"
    assert.deepEqual(rules(call('src/a.js'), cfgOf()), []);
  });

  test('denied only under hooks.guard enforce, with a message naming the command; Claude and Copilot shapes', () => {
    const run = (payload) => spawnSync(process.execPath, [GUARD, '--host', 'claude'], { input: JSON.stringify(payload), encoding: 'utf8', env: { ...process.env, PAN_PLANNING_DIR: '', PAN_TRACK: '' } });
    const claude = { cwd: dir, tool_name: 'Write', tool_input: { file_path: path.join(dir, 'src', 'a.js'), content: 'x' } };
    config({ routing: 'exclusive' }, 'report');
    assert.equal(run(claude).status, 0);
    assert.match(fs.readFileSync(path.join(dir, '.planning', 'guard.jsonl'), 'utf8'), /"rule":"unrouted_write".*"action":"reported"/);
    config({ routing: 'exclusive' }, 'enforce');
    const denied = run(claude);
    assert.equal(denied.status, 2);
    assert.match(denied.stderr, /quick command/);
    const copilot = run({ cwd: dir, toolName: 'edit', toolArgs: JSON.stringify({ path: path.join(dir, 'src', 'a.js'), new_string: 'x' }) });
    assert.match(JSON.parse(copilot.stdout).permissionDecision, /deny/);
    config({ routing: 'advisory' }, 'enforce');
    assert.equal(run(claude).status, 0, 'advisory never denies');
  });
});
