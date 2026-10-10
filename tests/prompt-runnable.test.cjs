// Instructions in shipped prompts that a model runs as written, run here the way the
// model would run them. The doc audit of 2026-10-05 found each of these broken while
// the prose around it read correctly:
//   - /pan:update's detection printed nothing about the runtime when the VERSION file
//     was missing, and its install step reused a shell variable from an earlier tool
//     call (each Bash call is a new shell), so the update installed Claude Code only;
//   - the previous-phase arithmetic stopped bash on a letter-suffix phase (`12A`), and
//     the verifier agent and verify-phase computed different "previous" phases;
//   - the verification template's `gaps:` line, uncommented as told, kept its inline
//     `# note`, which the generic frontmatter parser (frontmatter get, report phase, retro)
//     read as the value: gaps became a string and the example gap's `status: failed`
//     replaced the report's own status (`findings record` strips the note and read the gaps);
//     and the template's own Example claimed gaps_found with no gaps for a verdict to record.

'use strict';

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { installInto, cleanup, withFakeHome } = require('./helpers.cjs');
const { verdictFromVerificationFrontmatter } = require('../pan-wizard-core/bin/lib/verdict.cjs');
const { extractFrontmatter } = require('../pan-wizard-core/bin/lib/frontmatter.cjs');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const VERSION = require('../package.json').version;

// A bash that can see this machine's paths: Git Bash on Windows, bash elsewhere.
// (A WSL bash.exe without a distribution, or one that cannot see C:/, does not count.)
const PROBE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-bash-probe-'));
const BASH_OK = (() => {
  const r = spawnSync('bash', ['-c', `[ -d "${PROBE_DIR.split(path.sep).join('/')}" ] && echo ok`], { encoding: 'utf8' });
  return !r.error && r.status === 0 && r.stdout.trim() === 'ok';
})();
cleanup(PROBE_DIR);
const NO_BASH = 'no bash that sees this filesystem (Git Bash on Windows)';

function runBash(script, cwd) {
  const r = spawnSync('bash', ['-c', script], { cwd, encoding: 'utf8' });
  assert.equal(r.status, 0, `bash failed: ${r.stderr}`);
  return r.stdout.split('\n').map((l) => l.trim()).filter(Boolean);
}

/** The first ```bash block inside <step name="…">. */
function stepBash(md, step) {
  const start = md.indexOf(`<step name="${step}"`);
  assert.ok(start >= 0, `step ${step} not found`);
  const body = md.slice(start, md.indexOf('</step>', start));
  const m = body.match(/```bash\n([\s\S]*?)```/);
  assert.ok(m, `no bash block in step ${step}`);
  return { block: m[1], body };
}

describe('/pan:update reads its runtime and scope from its own install path', () => {
  let root;
  before(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-update-wf-'));
    const r = installInto(root, ['--claude', '--codex', '--gemini', '--opencode', '--copilot', '--local']);
    assert.ok(r.success, `install failed: ${r.error}`);
  });
  after(() => cleanup(root));

  const LOCAL = [['claude', '.claude'], ['codex', '.codex'], ['gemini', '.gemini'], ['opencode', '.opencode'], ['copilot', '.github']];
  for (const [runtime, dir] of LOCAL) {
    test(`a local ${runtime} install detects --${runtime} and LOCAL`, (t) => {
      if (!BASH_OK) return t.skip(NO_BASH);
      const md = fs.readFileSync(path.join(root, dir, 'pan-wizard-core', 'workflows', 'update.md'), 'utf8');
      assert.deepEqual(runBash(stepBash(md, 'get_installed_version').block, root), [VERSION, `--${runtime}`, 'LOCAL']);
    });
  }

  test('a missing VERSION file still reports the runtime and scope', (t) => {
    if (!BASH_OK) return t.skip(NO_BASH);
    const core = path.join(root, '.codex', 'pan-wizard-core');
    const md = fs.readFileSync(path.join(core, 'workflows', 'update.md'), 'utf8');
    const saved = fs.readFileSync(path.join(core, 'VERSION'), 'utf8');
    fs.unlinkSync(path.join(core, 'VERSION'));
    try {
      // Without the runtime line the workflow fell back to --claude and reinstalled
      // Claude Code over a Codex project.
      assert.deepEqual(runBash(stepBash(md, 'get_installed_version').block, root), ['UNKNOWN', '--codex', 'LOCAL']);
    } finally {
      fs.writeFileSync(path.join(core, 'VERSION'), saved);
    }
  });

  test('a --unified-skills install prints the version on its own line', (t) => {
    // The shared .agents/ core's VERSION had no trailing newline, so `cat` glued the
    // version to the runtime line ("3.33.0--claude") and the parse read no version.
    // (Which runtime a unified install reports is a documented limit; the version is not.)
    if (!BASH_OK) return t.skip(NO_BASH);
    const uroot = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-update-unified-'));
    try {
      const r = installInto(uroot, ['--codex', '--local', '--unified-skills']);
      assert.ok(r.success, `install failed: ${r.error}`);
      const md = fs.readFileSync(path.join(uroot, '.agents', 'pan-wizard-core', 'workflows', 'update.md'), 'utf8');
      const out = runBash(stepBash(md, 'get_installed_version').block, uroot);
      assert.equal(out.length, 3, `expected version, runtime, scope: ${JSON.stringify(out)}`);
      assert.equal(out[0], VERSION);
      assert.equal(out[2], 'LOCAL');
    } finally {
      cleanup(uroot);
    }
  });

  test('the install step does not reuse a shell variable from the detection step', () => {
    // Each Bash tool call is a fresh shell: "$RUNTIME" set in step 1 is empty in the
    // install step, and `npx pan-wizard@latest "" --local` installs Claude Code only.
    const md = fs.readFileSync(path.join(root, '.codex', 'pan-wizard-core', 'workflows', 'update.md'), 'utf8');
    const { body } = stepBash(md, 'run_update');
    const npx = body.split('\n').filter((l) => l.includes('pan-wizard@latest'));
    assert.ok(npx.length >= 2, 'the install step names its npx commands');
    for (const line of npx) {
      assert.doesNotMatch(line, /\$\{?(RUNTIME|SCOPE)\b/, `a step-1 shell variable in: ${line}`);
      assert.match(line, /\{runtime_flag\}/, `the runtime flag is written into the command: ${line}`);
    }
  });

  test('a global install detects its runtime and GLOBAL', (t) => {
    if (!BASH_OK) return t.skip(NO_BASH);
    withFakeHome((home) => {
      const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-update-glob-'));
      try {
        const r = installInto(proj, ['--opencode', '--copilot', '--global']);
        assert.ok(r.success, `global install failed: ${r.error}`);
        const found = [];
        const walk = (d, depth) => {
          if (depth > 4) return;
          for (const e of fs.readdirSync(d, { withFileTypes: true })) {
            const p = path.join(d, e.name);
            if (e.isDirectory()) walk(p, depth + 1);
            else if (e.name === 'update.md' && p.includes(`${path.sep}pan-wizard-core${path.sep}workflows${path.sep}`)) found.push(p);
          }
        };
        walk(home, 0);
        const flags = found.map((p) => runBash(stepBash(fs.readFileSync(p, 'utf8'), 'get_installed_version').block, proj));
        assert.deepEqual(flags.map((l) => l.slice(1)).sort(), [['--copilot', 'GLOBAL'], ['--opencode', 'GLOBAL']]);
        for (const l of flags) assert.equal(l[0], VERSION);
      } finally {
        cleanup(proj);
      }
    });
  });
});

describe('the previous phase, computed the same way by verify-phase and the verifier', () => {
  const CASES = [['08', '7'], ['2.1', '2'], ['12A', '12'], ['12A.1', '12A'], ['10', '9']];
  const lines = [
    ['pan-wizard-core/workflows/verify-phase.md', 'phase_number', 'PREV'],
    ['agents/pan-verifier.md', 'PHASE_NUM', 'PREV_PHASE'],
  ];
  for (const [file, input, output] of lines) {
    test(`${file}: 08 → 7, 2.1 → 2, 12A → 12 (bash rejected 12A; octal 08)`, (t) => {
      if (!BASH_OK) return t.skip(NO_BASH);
      const line = read(file).split('\n').find((l) => new RegExp(`^case "\\$${input}" in`).test(l));
      assert.ok(line, `${file}: the previous-phase case statement is gone`);
      for (const [n, want] of CASES) {
        assert.deepEqual(runBash(`${input}="${n}"\n${line}\necho "$${output}"`, os.tmpdir()), [want], `${file}: phase ${n}`);
      }
    });
  }
});

describe('the verification template, filled as it says', () => {
  test('uncommenting `gaps:` and `human_verification:` gives lists findings record reads', () => {
    const tpl = read('pan-wizard-core/templates/verification-report.md').replace(/\r\n/g, '\n');
    const open = tpl.indexOf('```markdown\n---\n');
    assert.ok(open >= 0, 'the file template block is gone');
    const start = open + '```markdown\n'.length;
    const fm = tpl.slice(start, tpl.indexOf('\n---\n', start + 4) + 5);
    // Do what the comment tells the verifier: strip the leading `# ` of the gaps and
    // human_verification blocks (the other commented examples stay commented).
    let inBlock = false;
    const filled = fm
      .replace(/^status: .*$/m, 'status: gaps_found')
      .split('\n').map((l) => {
        if (/^# (gaps|human_verification):/.test(l)) { inBlock = true; return l.slice(2); }
        if (/^# [a-z_]+:/.test(l)) { inBlock = false; return l; }
        return inBlock && l.startsWith('#   ') ? l.slice(2) : l;
      }).join('\n');
    assert.match(filled, /^gaps:/m, 'the template still carries a gaps block to uncomment');
    const v = verdictFromVerificationFrontmatter(filled);
    assert.ok(v, 'the filled frontmatter parses');
    assert.ok(v.findings.some((f) => f.class === 'missing'), `the gap is read: ${JSON.stringify(v.findings)}`);
    assert.ok(v.findings.some((f) => f.class === 'human'), `the human item is read: ${JSON.stringify(v.findings)}`);
    // The generic parser (frontmatter get, report phase, retro) keeps an inline `# note` as the
    // key's value, which turned the uncommented `gaps:` into a string and let the example
    // gap's nested `status: failed` replace the report's own status.
    const fmParsed = extractFrontmatter(filled);
    assert.equal(fmParsed.status, 'gaps_found', 'the report keeps its own status');
    assert.ok(Array.isArray(fmParsed.gaps), `gaps reads as a list: ${JSON.stringify(fmParsed.gaps)}`);
    assert.ok(Array.isArray(fmParsed.human_verification), 'human_verification reads as a list');
  });
});

describe('the verification template\'s Example', () => {
  test('a report modelled on it records the gaps it shows, with no warnings', () => {
    const tpl = read('pan-wizard-core/templates/verification-report.md').replace(/\r\n/g, '\n');
    const ex = tpl.indexOf('## Example');
    assert.ok(ex >= 0, 'the Example section is gone');
    const start = tpl.indexOf('```markdown\n', ex) + '```markdown\n'.length;
    const fm = tpl.slice(start, tpl.indexOf('\n---\n', start + 4) + 5);
    const parsed = extractFrontmatter(fm);
    assert.equal(parsed.status, 'gaps_found');
    assert.ok(Array.isArray(parsed.gaps) && parsed.gaps.length > 0, 'a gaps_found Example lists its gaps');
    assert.ok(parsed.verified_commit && parsed.test_gate, 'verify-phase requires verified_commit and test_gate');
    const v = verdictFromVerificationFrontmatter(fm);
    assert.ok(v.findings.length > 0, `the Example's gaps become findings: ${JSON.stringify(v)}`);
    const body = tpl.slice(start);
    const bodyScore = /\*\*Score:\*\* (\d+)\/(\d+) truths verified/.exec(body);
    assert.ok(bodyScore, 'the Example states a score');
    assert.ok(parsed.score.startsWith(`${bodyScore[1]}/${bodyScore[2]} `), `frontmatter and body give the same score: ${parsed.score}`);
  });
});
