// ADR-0028 Phase 1: `--unified-skills` compiles commands once into the shared
// runtime-neutral .agents/skills/ tree for every runtime, sweeps the
// proprietary command surface, tracks the tree in the manifest with
// out-of-tree (../) keys, and removes it on uninstall.

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PROJECT_ROOT = path.join(__dirname, '..');
const INSTALLER = path.join(PROJECT_ROOT, 'bin', 'install.js');

function runInstaller(cwd, flags) {
  return execFileSync(process.execPath, [INSTALLER, ...flags.split(/\s+/)], {
    cwd,
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

function listSkillDirs(cwd) {
  const dir = path.join(cwd, '.agents', 'skills');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter(e => e.isDirectory() && e.name.startsWith('pan-'))
    .map(e => e.name);
}

function readSkill(cwd, name) {
  return fs.readFileSync(path.join(cwd, '.agents', 'skills', name, 'SKILL.md'), 'utf8');
}

// Per-runtime proprietary surface checks: each returns true when the
// proprietary command surface is ABSENT (i.e. correctly swept).
const RUNTIMES = [
  {
    flag: '--claude', dir: '.claude',
    sweptClean: (cwd) =>
      !fs.existsSync(path.join(cwd, '.claude', 'commands', 'pan')) &&
      !(fs.existsSync(path.join(cwd, '.claude', 'skills')) &&
        fs.readdirSync(path.join(cwd, '.claude', 'skills'))
          .some(f => f.startsWith('pan-') && f.endsWith('.md'))),
  },
  {
    flag: '--gemini', dir: '.gemini',
    sweptClean: (cwd) => !fs.existsSync(path.join(cwd, '.gemini', 'commands', 'pan')),
  },
  {
    flag: '--opencode', dir: '.opencode',
    sweptClean: (cwd) =>
      !(fs.existsSync(path.join(cwd, '.opencode', 'commands')) &&
        fs.readdirSync(path.join(cwd, '.opencode', 'commands'))
          .some(f => f.startsWith('pan-') && f.endsWith('.md'))),
  },
  {
    flag: '--codex', dir: '.codex',
    sweptClean: (cwd) =>
      !(fs.existsSync(path.join(cwd, '.codex', 'skills')) &&
        fs.readdirSync(path.join(cwd, '.codex', 'skills'), { withFileTypes: true })
          .some(e => e.isDirectory() && e.name.startsWith('pan-'))),
  },
  {
    flag: '--copilot', dir: '.github',
    sweptClean: (cwd) =>
      !(fs.existsSync(path.join(cwd, '.github', 'skills')) &&
        fs.readdirSync(path.join(cwd, '.github', 'skills'), { withFileTypes: true })
          .some(e => e.isDirectory() && e.name.startsWith('pan-'))),
  },
];

for (const rt of RUNTIMES) {
  describe(`unified skills: ${rt.flag} --local --unified-skills`, () => {
    let tmpDir;

    before(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `pan-unified-${rt.dir.replace('.', '')}-`));
      runInstaller(tmpDir, `${rt.flag} --local --unified-skills --skip-warnings`);
    });

    after(() => {
      if (tmpDir && fs.existsSync(tmpDir)) {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    test('shared .agents/skills/ tree is populated', () => {
      const skills = listSkillDirs(tmpDir);
      assert.ok(skills.length >= 30, `expected 30+ unified skills, got ${skills.length}`);
      for (const name of skills.slice(0, 3)) {
        assert.ok(
          fs.existsSync(path.join(tmpDir, '.agents', 'skills', name, 'SKILL.md')),
          `${name}/SKILL.md should exist`
        );
      }
    });

    test('SKILL.md carries the runtime-neutral adapter (no runtime-specific headers)', () => {
      const content = readSkill(tmpDir, 'pan-help');
      assert.ok(content.includes('<pan_skill_adapter>'), 'should carry the unified adapter');
      assert.ok(!content.includes('<codex_skill_adapter>'), 'must not carry the Codex adapter');
      assert.ok(!content.includes('<copilot_skill_adapter>'), 'must not carry the Copilot adapter');
      assert.ok(content.startsWith('---'), 'should start with YAML frontmatter');
      assert.ok(content.includes('name:'), 'frontmatter should carry name');
      assert.ok(content.includes('description:'), 'frontmatter should carry description');
    });

    test('proprietary command surface is swept', () => {
      assert.ok(rt.sweptClean(tmpDir), `${rt.dir} proprietary command surface should be absent`);
    });

    test('manifest tracks the shared tree with out-of-tree keys', () => {
      const manifest = JSON.parse(fs.readFileSync(
        path.join(tmpDir, rt.dir, 'pan-file-manifest.json'), 'utf8'));
      const sharedKeys = Object.keys(manifest.files).filter(k => k.startsWith('../'));
      assert.ok(sharedKeys.length >= 30, `expected 30+ ../ manifest keys, got ${sharedKeys.length}`);
      assert.ok(
        sharedKeys.every(k => k.includes('.agents/skills/pan-')),
        'out-of-tree keys should point into .agents/skills/pan-*'
      );
    });

    test('agents still install per-runtime', () => {
      const agentsDir = path.join(tmpDir, rt.dir, 'agents');
      assert.ok(fs.existsSync(agentsDir), 'agents dir should exist');
      const panAgents = fs.readdirSync(agentsDir).filter(f => f.startsWith('pan-'));
      assert.ok(panAgents.length >= 15, `expected 15+ agents, got ${panAgents.length}`);
    });

    // ADR-0028 agent-ref canonicalization: shared content references the
    // canonical agent copies in the shared core, never the runtime's own
    // agents dir (whose files carry runtime-specific formats).
    test('agent refs resolve against shared canonical copies', () => {
      const agentsRefDir = path.join(tmpDir, '.agents', 'pan-wizard-core', 'agents');
      assert.ok(fs.existsSync(agentsRefDir), 'shared core should ship agent reference copies');
      const refs = fs.readdirSync(agentsRefDir).filter(f => f.startsWith('pan-') && f.endsWith('.md'));
      assert.ok(refs.length >= 15, `expected 15+ agent reference copies, got ${refs.length}`);

      const skill = readSkill(tmpDir, 'pan-research-phase');
      const match = skill.match(/(\S*pan-wizard-core\/agents\/pan-[a-z-]+\.md)/);
      assert.ok(match, 'skill should reference the shared agents path');
      assert.ok(fs.existsSync(path.resolve(tmpDir, match[1])),
        `referenced agent copy should resolve: ${match[1]}`);
      assert.ok(!skill.includes(`${rt.dir}/agents/`),
        'no runtime-specific agent refs should remain in shared content');
    });

    // ADR-0028 Phase 2: shared core
    test('shared pan-wizard-core installed; skills resolve against it', () => {
      assert.ok(
        fs.existsSync(path.join(tmpDir, '.agents', 'pan-wizard-core', 'bin', 'pan-tools.cjs')),
        'shared core should carry pan-tools.cjs'
      );
      assert.ok(
        !fs.existsSync(path.join(tmpDir, '.agents', 'pan-wizard-core', 'learnings', 'internal')),
        'internal learnings are source-only and must be stripped'
      );
      const content = readSkill(tmpDir, 'pan-exec-phase');
      assert.ok(content.includes('.agents/pan-wizard-core/'),
        'skills should reference the shared core');
      assert.ok(!content.includes(`${rt.dir}/pan-wizard-core/`),
        'skills should not reference the runtime-local core');
    });
  });
}

// ---------------------------------------------------------------------------
// Agent Skills SPEC CONFORMANCE for the emitted tree.
//
// Nothing validated this before. The existing checks assert that `name:` and
// `description:` are *present*; the spec constrains their VALUES, and one of
// those constraints is load-bearing for discovery: `name` MUST equal the parent
// directory name. A skill that violates it is written, verified, and then not
// found — the same silent-dead-surface shape as a wrong config path.
//
// Rules pinned here come from the published spec (agentskills.io / the SKILL.md
// reference, read 2026-08-12): name 1-64 chars, lowercase alphanumeric and
// hyphens with no leading, trailing or consecutive hyphens, matching its
// directory; description 1-1024 chars. Re-verify before relaxing any of them.
describe('unified skills: Agent Skills spec conformance of the emitted tree', () => {
  let tmpDir;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-uskill-spec-'));
    runInstaller(tmpDir, '--claude --local --unified-skills --skip-warnings');
  });

  after(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch { /* temp dir */ }
  });

  const frontmatterOf = (content) => {
    const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content);
    return m ? m[1] : null;
  };
  const field = (fm, key) => {
    const m = new RegExp(`^${key}:\\s*(.*)$`, 'm').exec(fm);
    if (!m) return null;
    return m[1].trim().replace(/^["'](.*)["']$/, '$1');
  };

  test('the tree is non-empty (otherwise every assertion below passes vacuously)', () => {
    assert.ok(listSkillDirs(tmpDir).length > 0, 'no skills emitted — the rest of this suite would be vacuous');
  });

  test('every skill: name matches its directory, and satisfies the spec charset/length', () => {
    // A trailing/leading/doubled hyphen or an uppercase char is invalid per spec.
    const NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
    const bad = [];
    for (const dir of listSkillDirs(tmpDir)) {
      const fm = frontmatterOf(readSkill(tmpDir, dir));
      if (!fm) { bad.push(`${dir}: no frontmatter`); continue; }
      const name = field(fm, 'name');
      if (name !== dir) bad.push(`${dir}: name "${name}" !== directory (breaks discovery)`);
      if (!name || !NAME_RE.test(name)) bad.push(`${dir}: name "${name}" fails spec charset/hyphen rules`);
      if (name && name.length > 64) bad.push(`${dir}: name is ${name.length} chars (max 64)`);
    }
    assert.deepEqual(bad, [], `spec violations in emitted skill names:\n${bad.join('\n')}`);
  });

  test('every skill: description is present and within the spec length bound', () => {
    const bad = [];
    for (const dir of listSkillDirs(tmpDir)) {
      const fm = frontmatterOf(readSkill(tmpDir, dir));
      const desc = fm && field(fm, 'description');
      if (!desc) bad.push(`${dir}: missing/empty description (it is the tier-1 discovery signal)`);
      else if (desc.length > 1024) bad.push(`${dir}: description is ${desc.length} chars (max 1024)`);
      else if (/\r?\n/.test(desc)) bad.push(`${dir}: description spans lines — must be single-line`);
    }
    assert.deepEqual(bad, [], `spec violations in emitted descriptions:\n${bad.join('\n')}`);
  });

  test('every skill declares `compatibility`, within the spec length bound', () => {
    // PAN's requirements are not inferable from a skill body: it shells out to a
    // Node CLI and assumes a .planning/ directory. Spec caps the field at 500.
    const bad = [];
    for (const dir of listSkillDirs(tmpDir)) {
      const fm = frontmatterOf(readSkill(tmpDir, dir));
      const compat = fm && field(fm, 'compatibility');
      if (!compat) bad.push(`${dir}: missing compatibility`);
      else if (compat.length > 500) bad.push(`${dir}: compatibility is ${compat.length} chars (max 500)`);
    }
    assert.deepEqual(bad, [], `compatibility problems:\n${bad.join('\n')}`);
  });

  test('no skill emits the experimental `allowed-tools` (unverified per ADR-0028)', () => {
    // Guard against a well-meaning future addition: the field is experimental,
    // and ADR-0028's rule is that frontmatter which could break a runtime parser
    // waits for a live per-runtime check. Flip this test when that check exists.
    const offenders = listSkillDirs(tmpDir).filter((dir) => {
      const fm = frontmatterOf(readSkill(tmpDir, dir));
      return fm && /^allowed-tools:/m.test(fm);
    });
    assert.deepEqual(offenders, [], 'allowed-tools is experimental — gate it on a live runtime check first');
  });

  test('every `@` reference in a skill body RESOLVES on disk', () => {
    // This is PAN's tier 3. It is NOT in-bundle `references/` — bodies import the
    // shared core by path (root-relative for a local install, absolute for a
    // global one), which works and avoids duplicating the workflow corpus into
    // every skill dir. What that trades away is a self-contained bundle, so the
    // ONLY thing keeping tier 3 alive is that these paths resolve. Assert it.
    const bad = [];
    for (const dir of listSkillDirs(tmpDir)) {
      const body = readSkill(tmpDir, dir);
      const refs = body.match(/@\.?\/?[^\s`"')\]]*pan-wizard-core\/[^\s`"')\]]+\.md/g) || [];
      for (const ref of refs) {
        const raw = ref.slice(1); // drop the leading @
        const abs = path.isAbsolute(raw) || /^[A-Za-z]:/.test(raw)
          ? raw
          : path.join(tmpDir, raw);
        if (!fs.existsSync(abs)) bad.push(`${dir}: dangling ref ${ref}`);
      }
    }
    assert.deepEqual(bad, [], `skill bodies reference files that do not exist:\n${bad.join('\n')}`);
  });

  test('a global install emits refs that resolve too (absolute, not ./-relative)', () => {
    // The local form is `@./.agents/…`, which is root-relative to the CWD. A
    // GLOBAL install puts the core under the user's home, where a project-root
    // relative path would dangle — so the emitted form must differ. Pinned
    // because getting this wrong yields skills that load and then import nothing.
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-uskill-home-'));
    const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-uskill-proj-'));
    try {
      execFileSync(process.execPath, [INSTALLER, '--claude', '--global', '--unified-skills'], {
        cwd: proj, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, HOME: home, USERPROFILE: home },
      });
      const skillPath = path.join(home, '.agents', 'skills', 'pan-exec-phase', 'SKILL.md');
      assert.ok(fs.existsSync(skillPath), 'global unified install should emit skills under ~/.agents/skills');
      const refs = fs.readFileSync(skillPath, 'utf8')
        .match(/@[^\s`"')\]]*pan-wizard-core\/[^\s`"')\]]+\.md/g) || [];
      assert.ok(refs.length > 0, 'the exec-phase skill should import at least one core file');
      for (const ref of refs) {
        const raw = ref.slice(1);
        assert.ok(!raw.startsWith('./'), `global ref must not be project-root relative: ${ref}`);
        assert.ok(fs.existsSync(raw), `global ref does not resolve: ${ref}`);
      }
    } finally {
      for (const d of [home, proj]) {
        try { fs.rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch { /* temp */ }
      }
    }
  });
});

describe('unified skills: ref-counted uninstall across runtimes (ADR-0028 Phase 2)', () => {
  let tmpDir;
  let afterFirstUninstall;
  let afterLastUninstall;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-unified-refcount-'));
    runInstaller(tmpDir, '--claude --local --unified-skills --skip-warnings');
    runInstaller(tmpDir, '--codex --local --unified-skills --skip-warnings');

    runInstaller(tmpDir, '--claude --local --uninstall');
    afterFirstUninstall = {
      skills: listSkillDirs(tmpDir).length,
      coreExists: fs.existsSync(path.join(tmpDir, '.agents', 'pan-wizard-core')),
    };

    runInstaller(tmpDir, '--codex --local --uninstall');
    afterLastUninstall = {
      skills: listSkillDirs(tmpDir).length,
      agentsRootExists: fs.existsSync(path.join(tmpDir, '.agents')),
    };
  });

  after(() => {
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test('shared tree survives while another runtime still tracks it', () => {
    assert.ok(afterFirstUninstall.skills >= 30,
      `skills should remain after first uninstall, got ${afterFirstUninstall.skills}`);
    assert.ok(afterFirstUninstall.coreExists, 'shared core should remain too');
  });

  test('last tracker removes the shared tree, core, and prunes .agents/', () => {
    assert.equal(afterLastUninstall.skills, 0, 'no pan-* skills should remain');
    assert.ok(!afterLastUninstall.agentsRootExists, '.agents/ should be pruned when empty');
  });
});

describe('unified skills: upgrade from proprietary install (claude)', () => {
  let tmpDir;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-unified-upgrade-'));
    runInstaller(tmpDir, '--claude --local --skip-warnings');
    assert.ok(
      fs.existsSync(path.join(tmpDir, '.claude', 'commands', 'pan')),
      'precondition: proprietary install should create .claude/commands/pan'
    );
    runInstaller(tmpDir, '--claude --local --unified-skills --skip-warnings');
  });

  after(() => {
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test('reinstall with the flag sweeps the proprietary tree and writes the shared one', () => {
    assert.ok(!fs.existsSync(path.join(tmpDir, '.claude', 'commands', 'pan')),
      'commands/pan should be swept on unified reinstall');
    assert.ok(listSkillDirs(tmpDir).length >= 30, 'shared tree should be populated');
  });

  test('manifest no longer tracks commands/pan keys', () => {
    const manifest = JSON.parse(fs.readFileSync(
      path.join(tmpDir, '.claude', 'pan-file-manifest.json'), 'utf8'));
    const cmdKeys = Object.keys(manifest.files).filter(k => k.startsWith('commands/pan/'));
    assert.equal(cmdKeys.length, 0, 'commands/pan keys should be gone from the manifest');
  });
});

describe('unified skills: uninstall removes the shared tree (claude)', () => {
  let tmpDir;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-unified-uninstall-'));
    runInstaller(tmpDir, '--claude --local --unified-skills --skip-warnings');
    assert.ok(listSkillDirs(tmpDir).length >= 30, 'precondition: shared tree populated');
    runInstaller(tmpDir, '--claude --local --uninstall');
  });

  after(() => {
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test('shared .agents/skills/pan-* tree is removed', () => {
    assert.equal(listSkillDirs(tmpDir).length, 0,
      'no pan-* skills should remain in the shared tree after uninstall');
  });
});
