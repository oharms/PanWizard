// Tests for GitHub Copilot CLI runtime support in the installer.
// Tests the Copilot CLI installation flow: skills, agents, hooks,
// config.json, uninstall, tool name mapping, converters.

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Paths
const PROJECT_ROOT = path.join(__dirname, '..');
const INSTALLER = path.join(PROJECT_ROOT, 'bin', 'install.js');
const PKG_VERSION = require(path.join(PROJECT_ROOT, 'package.json')).version;

// Shared temp directory
let tempDir;

function runInstaller(flags) {
  return execSync(`node "${INSTALLER}" ${flags}`, {
    cwd: tempDir,
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

// ── Group 1: Copilot CLI Install Structure ──────────────────

describe('Copilot CLI: install structure', () => {
  before(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-copilot-'));
    runInstaller('--copilot --local');
  });

  after(() => {
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test('.github directory exists (local install path)', () => {
    assert.ok(fs.existsSync(path.join(tempDir, '.github')), '.github dir should exist');
  });

  test('skills directory has pan-* skill directories', () => {
    const skillsDir = path.join(tempDir, '.github', 'skills');
    assert.ok(fs.existsSync(skillsDir), 'skills dir should exist');
    const skillDirs = fs.readdirSync(skillsDir, { withFileTypes: true })
      .filter(e => e.isDirectory() && e.name.startsWith('pan-'));
    assert.ok(skillDirs.length >= 30, `should have 30+ skill dirs, got ${skillDirs.length}`);
  });

  test('each skill has SKILL.md with correct YAML frontmatter', () => {
    const skillsDir = path.join(tempDir, '.github', 'skills');
    const skillDirs = fs.readdirSync(skillsDir, { withFileTypes: true })
      .filter(e => e.isDirectory() && e.name.startsWith('pan-'));

    for (const dir of skillDirs.slice(0, 5)) {
      const skillPath = path.join(skillsDir, dir.name, 'SKILL.md');
      assert.ok(fs.existsSync(skillPath), `${dir.name}/SKILL.md should exist`);

      const content = fs.readFileSync(skillPath, 'utf8');
      assert.ok(content.startsWith('---'), `${dir.name}/SKILL.md should start with YAML frontmatter`);
      assert.ok(content.includes('name:'), `${dir.name}/SKILL.md should have name field`);
      assert.ok(content.includes('description:'), `${dir.name}/SKILL.md should have description field`);
    }
  });

  test('skill content has Copilot CLI adapter header', () => {
    const skillsDir = path.join(tempDir, '.github', 'skills');
    const skillDirs = fs.readdirSync(skillsDir, { withFileTypes: true })
      .filter(e => e.isDirectory() && e.name.startsWith('pan-'));

    const firstSkill = path.join(skillsDir, skillDirs[0].name, 'SKILL.md');
    const content = fs.readFileSync(firstSkill, 'utf8');
    assert.ok(content.includes('<copilot_skill_adapter>'), 'should have Copilot skill adapter header');
    assert.ok(content.includes('</copilot_skill_adapter>'), 'should have closing adapter tag');
  });

  test('skill content has /pan- prefix (not /pan: or $pan-)', () => {
    const skillsDir = path.join(tempDir, '.github', 'skills');
    // Check a skill that references other commands
    const progressSkill = path.join(skillsDir, 'pan-progress', 'SKILL.md');
    if (fs.existsSync(progressSkill)) {
      const content = fs.readFileSync(progressSkill, 'utf8');
      // Should NOT contain Claude-style /pan: references
      const claudeRefs = content.match(/\/pan:[a-z0-9-]+/gi) || [];
      assert.strictEqual(claudeRefs.length, 0,
        `should not have /pan: references, found: ${claudeRefs.join(', ')}`);
      // Should NOT contain Codex-style $pan- references
      const codexRefs = content.match(/\$pan-[a-z0-9-]+/gi) || [];
      assert.strictEqual(codexRefs.length, 0,
        `should not have $pan- references, found: ${codexRefs.join(', ')}`);
    }
  });

  test('agents directory has .agent.md files', () => {
    const agentsDir = path.join(tempDir, '.github', 'agents');
    assert.ok(fs.existsSync(agentsDir), 'agents dir should exist');
    const agentFiles = fs.readdirSync(agentsDir)
      .filter(f => f.startsWith('pan-') && f.endsWith('.agent.md'));
    assert.ok(agentFiles.length >= 10, `should have 10+ .agent.md files, got ${agentFiles.length}`);
  });

  test('agent files have correct YAML frontmatter with tools list', () => {
    const agentsDir = path.join(tempDir, '.github', 'agents');
    const agentFiles = fs.readdirSync(agentsDir)
      .filter(f => f.startsWith('pan-') && f.endsWith('.agent.md'));

    for (const file of agentFiles.slice(0, 3)) {
      const content = fs.readFileSync(path.join(agentsDir, file), 'utf8');
      assert.ok(content.startsWith('---'), `${file} should start with YAML frontmatter`);
      assert.ok(content.includes('name:'), `${file} should have name field`);
      assert.ok(content.includes('description:'), `${file} should have description field`);
    }
  });

  test('agent files do NOT have plain .md duplicates', () => {
    const agentsDir = path.join(tempDir, '.github', 'agents');
    const plainMdFiles = fs.readdirSync(agentsDir)
      .filter(f => f.startsWith('pan-') && f.endsWith('.md') && !f.endsWith('.agent.md'));
    assert.strictEqual(plainMdFiles.length, 0,
      `should not have plain .md agent files, found: ${plainMdFiles.join(', ')}`);
  });

  test('hooks directory has .js files', () => {
    const hooksDir = path.join(tempDir, '.github', 'hooks');
    assert.ok(fs.existsSync(hooksDir), 'hooks dir should exist');
    const jsFiles = fs.readdirSync(hooksDir).filter(f => f.endsWith('.js'));
    assert.ok(jsFiles.length >= 3, `should have 3+ hook files, got ${jsFiles.length}`);
  });

  // Copilot CLI reads hook config from .github/hooks/*.json (version:1), NOT
  // config.json — migrated 2026-06.
  test('.github/hooks/pan.json exists with version:1 schema', () => {
    const hooksConfigPath = path.join(tempDir, '.github', 'hooks', 'pan.json');
    assert.ok(fs.existsSync(hooksConfigPath), '.github/hooks/pan.json should exist');
    const config = JSON.parse(fs.readFileSync(hooksConfigPath, 'utf8'));
    assert.equal(config.version, 1, 'should declare version: 1');
    assert.ok(config.hooks.sessionStart, 'should have sessionStart hooks');
    assert.ok(config.hooks.postToolUse, 'should have postToolUse hooks');

    const hasUpdateHook = config.hooks.sessionStart.some(h =>
      h.type === 'command' && h.command && h.command.includes('pan-check-update')
    );
    assert.ok(hasUpdateHook, 'should have pan-check-update in sessionStart');

    const hasContextHook = config.hooks.postToolUse.some(h =>
      h.type === 'command' && h.command && h.command.includes('pan-context-monitor')
    );
    assert.ok(hasContextHook, 'should have pan-context-monitor in postToolUse');

    // Multi-runtime hooks layer (2026-06): cost + trace loggers ride
    // Copilot's subagentStop, same as Claude/Gemini's SubagentStop.
    assert.ok(Array.isArray(config.hooks.subagentStop), 'should have subagentStop hooks');
    const subagentCommands = config.hooks.subagentStop.map(h => h.command).join(' ');
    assert.ok(subagentCommands.includes('pan-cost-logger'), 'cost logger on subagentStop');
    assert.ok(subagentCommands.includes('pan-trace-logger'), 'trace logger on subagentStop');
  });

  test('hook entries declare type: command (Copilot CLI schema)', () => {
    const config = JSON.parse(fs.readFileSync(
      path.join(tempDir, '.github', 'hooks', 'pan.json'), 'utf8'));
    for (const evt of ['sessionStart', 'postToolUse']) {
      for (const hook of config.hooks[evt]) {
        assert.equal(hook.type, 'command', `${evt} hook should have type: command`);
        assert.ok(hook.command, `${evt} hook should have a command`);
      }
    }
  });

  test('config.json does NOT carry PAN hooks (migrated out)', () => {
    const configPath = path.join(tempDir, '.github', 'config.json');
    if (!fs.existsSync(configPath)) return; // fine — nothing to leak
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    const serialized = JSON.stringify(config.hooks || {});
    assert.ok(!serialized.includes('pan-check-update'), 'no PAN hooks should remain in config.json');
    assert.ok(!serialized.includes('pan-context-monitor'), 'no PAN hooks should remain in config.json');
  });

  // Copilot CLI reads user-editable settings from .github/copilot/settings.json
  // (documented repo-level read path) — NOT .github/config.json. Migrated 2026-06.
  test('statusline lands in .github/copilot/settings.json with type: command', () => {
    const settingsPath = path.join(tempDir, '.github', 'copilot', 'settings.json');
    assert.ok(fs.existsSync(settingsPath), '.github/copilot/settings.json should exist');
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    assert.ok(settings.statusLine, 'settings should have statusLine');
    assert.equal(settings.statusLine.type, 'command', 'statusLine should declare type: command');
    assert.ok(settings.statusLine.command.includes('pan-statusline'),
      'statusLine should invoke pan-statusline');
  });

  test('config.json does NOT carry PAN statusline (migrated out)', () => {
    const configPath = path.join(tempDir, '.github', 'config.json');
    if (!fs.existsSync(configPath)) return; // fine — nothing to leak
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    assert.ok(
      !(config.statusLine && String(config.statusLine.command).includes('pan-statusline')),
      'PAN statusline should not be registered in config.json'
    );
  });

  test('pan-wizard-core is installed', () => {
    const corePath = path.join(tempDir, '.github', 'pan-wizard-core');
    assert.ok(fs.existsSync(corePath), 'pan-wizard-core dir should exist');
    assert.ok(
      fs.existsSync(path.join(corePath, 'bin', 'pan-tools.cjs')),
      'pan-tools.cjs should exist'
    );
  });

  test('VERSION file matches package.json', () => {
    const versionPath = path.join(tempDir, '.github', 'pan-wizard-core', 'VERSION');
    assert.ok(fs.existsSync(versionPath), 'VERSION file should exist');
    const version = fs.readFileSync(versionPath, 'utf-8').trim();
    assert.strictEqual(version, PKG_VERSION, `VERSION should be ${PKG_VERSION}`);
  });

  test('package.json exists (CommonJS mode marker)', () => {
    const pkgPath = path.join(tempDir, '.github', 'package.json');
    assert.ok(fs.existsSync(pkgPath), 'package.json should exist');
    const content = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    assert.strictEqual(content.type, 'commonjs', 'should be commonjs');
  });

  test('manifest tracks skills with hashes', () => {
    const manifestPath = path.join(tempDir, '.github', 'pan-file-manifest.json');
    assert.ok(fs.existsSync(manifestPath), 'manifest should exist');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    assert.strictEqual(manifest.version, PKG_VERSION, `manifest version should match ${PKG_VERSION}`);
    const skillEntries = Object.keys(manifest.files).filter(k => k.startsWith('skills/'));
    assert.ok(skillEntries.length >= 10, `manifest should track 10+ skill files, got ${skillEntries.length}`);
    // Each entry should have a valid SHA256 hash
    for (const entry of skillEntries.slice(0, 3)) {
      assert.match(manifest.files[entry], /^[a-f0-9]{64}$/, `${entry} should have SHA256 hash`);
    }
  });

  test('manifest tracks hooks with hashes', () => {
    const manifestPath = path.join(tempDir, '.github', 'pan-file-manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const hookEntries = Object.keys(manifest.files).filter(k => k.startsWith('hooks/'));
    assert.ok(hookEntries.length >= 3, `manifest should track 3+ hook files, got ${hookEntries.length}`);
    assert.ok(hookEntries.some(h => h.includes('pan-check-update')), 'should track pan-check-update hook');
    assert.ok(hookEntries.some(h => h.includes('pan-context-monitor')), 'should track pan-context-monitor hook');
    assert.ok(hookEntries.some(h => h.includes('pan-statusline')), 'should track pan-statusline hook');
    for (const entry of hookEntries) {
      assert.match(manifest.files[entry], /^[a-f0-9]{64}$/, `${entry} should have SHA256 hash`);
    }
  });

  // Regression: Copilot CLI executes commands literally; bare `pan-tools X`
  // fails because there's no `pan-tools` binary on PATH. The installer must
  // replace these with the explicit `node .../pan-tools.cjs X` invocation.
  test('REGRESSION: bare `pan-tools X` invocations replaced with node path', () => {
    const skillsDir = path.join(tempDir, '.github', 'skills');
    const focusAutoSkill = path.join(skillsDir, 'pan-focus-auto', 'SKILL.md');
    assert.ok(fs.existsSync(focusAutoSkill), 'pan-focus-auto skill should exist');
    const content = fs.readFileSync(focusAutoSkill, 'utf8');
    // No bare executable invocations: `pan-tools` followed by a subcommand
    const bareInvocations = content.match(/`pan-tools\s+[a-z]/g);
    assert.equal(bareInvocations, null, 'no bare `pan-tools X` invocations should remain after install');
    // But the full node invocation should be present
    assert.ok(
      content.includes('node ./.github/pan-wizard-core/bin/pan-tools.cjs'),
      'should contain explicit node path invocation'
    );
  });

  test('prose references to `pan-tools` (no subcommand) are preserved', () => {
    const skillsDir = path.join(tempDir, '.github', 'skills');
    const focusAutoSkill = path.join(skillsDir, 'pan-focus-auto', 'SKILL.md');
    const content = fs.readFileSync(focusAutoSkill, 'utf8');
    // Prose mentions like "`pan-tools`," (followed by non-alpha) should survive
    assert.ok(
      content.match(/`pan-tools`(?!\.cjs)/),
      'prose-style `pan-tools` references (no subcommand) should remain'
    );
  });
});

// ── Group 2: Copilot CLI Uninstall ──────────────────────────

describe('Copilot CLI: uninstall', () => {
  before(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-copilot-uninstall-'));
    // Install first
    runInstaller('--copilot --local');
    // Then uninstall
    runInstaller('--copilot --local --uninstall');
  });

  after(() => {
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test('skills are removed after uninstall', () => {
    const skillsDir = path.join(tempDir, '.github', 'skills');
    if (fs.existsSync(skillsDir)) {
      const panSkills = fs.readdirSync(skillsDir, { withFileTypes: true })
        .filter(e => e.isDirectory() && e.name.startsWith('pan-'));
      assert.strictEqual(panSkills.length, 0, 'should have no PAN skills after uninstall');
    }
  });

  test('agents are removed after uninstall', () => {
    const agentsDir = path.join(tempDir, '.github', 'agents');
    if (fs.existsSync(agentsDir)) {
      const panAgents = fs.readdirSync(agentsDir)
        .filter(f => f.startsWith('pan-') && f.endsWith('.md'));
      assert.strictEqual(panAgents.length, 0, 'should have no PAN agents after uninstall');
    }
  });

  test('hooks are removed after uninstall', () => {
    const hooksDir = path.join(tempDir, '.github', 'hooks');
    if (fs.existsSync(hooksDir)) {
      const panHooks = fs.readdirSync(hooksDir)
        .filter(f => f.startsWith('pan-'));
      assert.strictEqual(panHooks.length, 0, 'should have no PAN hooks after uninstall');
    }
  });

  test('pan-wizard-core is removed after uninstall', () => {
    const corePath = path.join(tempDir, '.github', 'pan-wizard-core');
    assert.ok(!fs.existsSync(corePath), 'pan-wizard-core should not exist after uninstall');
  });

  test('config.json hooks are cleaned up', () => {
    const configPath = path.join(tempDir, '.github', 'config.json');
    // config.json may be removed entirely if it was empty after cleanup
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      if (config.hooks) {
        if (config.hooks.sessionStart) {
          const panHooks = config.hooks.sessionStart.filter(h =>
            h.command && h.command.includes('pan-')
          );
          assert.strictEqual(panHooks.length, 0, 'should have no PAN hooks in sessionStart');
        }
        if (config.hooks.postToolUse) {
          const panHooks = config.hooks.postToolUse.filter(h =>
            h.command && h.command.includes('pan-')
          );
          assert.strictEqual(panHooks.length, 0, 'should have no PAN hooks in postToolUse');
        }
      }
    }
  });

  test('PAN statusline removed from .github/copilot/settings.json', () => {
    const settingsPath = path.join(tempDir, '.github', 'copilot', 'settings.json');
    if (!fs.existsSync(settingsPath)) return; // removed entirely — fine
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    assert.ok(
      !(settings.statusLine && String(settings.statusLine.command).includes('pan-statusline')),
      'PAN statusline should be gone after uninstall'
    );
  });
});

// ── Group 2b: legacy config.json migration ──────────────────

describe('Copilot CLI: legacy config.json migration', () => {
  before(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-copilot-legacy-'));
    // Seed a pre-2026-06 install surface: PAN statusline registered in
    // .github/config.json (a path Copilot CLI never read) plus a foreign key.
    const ghDir = path.join(tempDir, '.github');
    fs.mkdirSync(ghDir, { recursive: true });
    fs.writeFileSync(path.join(ghDir, 'config.json'), JSON.stringify({
      statusLine: { command: 'node .github/hooks/pan-statusline.js' },
      theme: 'dark',
    }, null, 2) + '\n');
    runInstaller('--copilot --local');
  });

  after(() => {
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test('legacy PAN statusline stripped from config.json, foreign keys preserved', () => {
    const config = JSON.parse(fs.readFileSync(
      path.join(tempDir, '.github', 'config.json'), 'utf8'));
    assert.ok(!config.statusLine, 'legacy PAN statusLine should be removed from config.json');
    assert.equal(config.theme, 'dark', 'foreign config keys should be preserved');
  });

  test('statusline reinstalled into copilot/settings.json', () => {
    const settings = JSON.parse(fs.readFileSync(
      path.join(tempDir, '.github', 'copilot', 'settings.json'), 'utf8'));
    assert.ok(
      settings.statusLine && settings.statusLine.command.includes('pan-statusline'),
      'statusline should be registered in the documented settings path'
    );
    assert.equal(settings.statusLine.type, 'command', 'should carry type: command');
  });
});

// ── Group 3: --all flag includes Copilot CLI ────────────────

describe('Copilot CLI: --all flag', () => {
  before(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-copilot-all-'));
    runInstaller('--all --local');
  });

  after(() => {
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test('--all installs to .github (Copilot CLI)', () => {
    assert.ok(fs.existsSync(path.join(tempDir, '.github')), '.github dir should exist');
  });

  test('--all installs to .claude (Claude Code)', () => {
    assert.ok(fs.existsSync(path.join(tempDir, '.claude')), '.claude dir should exist');
  });

  test('--all installs to .opencode (OpenCode)', () => {
    assert.ok(fs.existsSync(path.join(tempDir, '.opencode')), '.opencode dir should exist');
  });

  test('--all installs to .gemini (Gemini)', () => {
    assert.ok(fs.existsSync(path.join(tempDir, '.gemini')), '.gemini dir should exist');
  });

  test('--all installs to .codex (Codex)', () => {
    assert.ok(fs.existsSync(path.join(tempDir, '.codex')), '.codex dir should exist');
  });

  test('Copilot CLI skills are present under .github', () => {
    const skillsDir = path.join(tempDir, '.github', 'skills');
    assert.ok(fs.existsSync(skillsDir), 'skills dir should exist');
    const skillDirs = fs.readdirSync(skillsDir, { withFileTypes: true })
      .filter(e => e.isDirectory() && e.name.startsWith('pan-'));
    assert.ok(skillDirs.length >= 30, `should have 30+ skills, got ${skillDirs.length}`);
  });
});

// ── Group 4: Converter function output validation ───────────

describe('Copilot CLI: converter output validation', () => {
  let skillContent;
  let agentContent;

  before(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-copilot-converters-'));
    runInstaller('--copilot --local');

    // Read a skill file to validate converter output
    const skillsDir = path.join(tempDir, '.github', 'skills');
    const firstSkillDir = fs.readdirSync(skillsDir, { withFileTypes: true })
      .find(e => e.isDirectory() && e.name.startsWith('pan-'));
    if (firstSkillDir) {
      skillContent = fs.readFileSync(
        path.join(skillsDir, firstSkillDir.name, 'SKILL.md'), 'utf8'
      );
    }

    // Read an agent file
    const agentsDir = path.join(tempDir, '.github', 'agents');
    const firstAgent = fs.readdirSync(agentsDir)
      .find(f => f.startsWith('pan-') && f.endsWith('.agent.md'));
    if (firstAgent) {
      agentContent = fs.readFileSync(path.join(agentsDir, firstAgent), 'utf8');
    }
  });

  after(() => {
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test('skill has proper YAML frontmatter structure', () => {
    assert.ok(skillContent, 'should have skill content');
    const fmEnd = skillContent.indexOf('---', 3);
    assert.ok(fmEnd > 3, 'should have closing frontmatter delimiter');
    const fm = skillContent.substring(3, fmEnd);
    assert.ok(fm.includes('name:'), 'frontmatter should have name');
    assert.ok(fm.includes('description:'), 'frontmatter should have description');
    assert.ok(fm.includes('metadata:'), 'frontmatter should have metadata');
    assert.ok(fm.includes('short-description:'), 'frontmatter should have short-description');
  });

  test('skill content does not contain ~/.claude/ paths', () => {
    assert.ok(skillContent, 'should have skill content');
    assert.ok(!skillContent.includes('~/.claude/'),
      'should not contain ~/.claude/ paths');
  });

  test('agent has proper .agent.md YAML frontmatter', () => {
    assert.ok(agentContent, 'should have agent content');
    assert.ok(agentContent.startsWith('---'), 'should start with frontmatter');
    const fmEnd = agentContent.indexOf('---', 3);
    assert.ok(fmEnd > 3, 'should have closing frontmatter delimiter');
    const fm = agentContent.substring(3, fmEnd);
    assert.ok(fm.includes('name:'), 'frontmatter should have name');
    assert.ok(fm.includes('description:'), 'frontmatter should have description');
  });

  test('agent content does not contain ~/.claude/ paths', () => {
    assert.ok(agentContent, 'should have agent content');
    assert.ok(!agentContent.includes('~/.claude/'),
      'should not contain ~/.claude/ paths');
  });

  test('skill content does not reference .claude directory', () => {
    assert.ok(skillContent, 'should have skill content');
    assert.ok(!skillContent.includes('./.claude/'),
      'should not contain ./.claude/ paths');
  });
});

// ── Group 5: Copilot CLI Interaction Converter ────────────────────

describe('Copilot CLI: interaction converter', () => {
  let interactionDir;
  let skillContent;
  let savedTempDir;

  before(() => {
    savedTempDir = tempDir;
    interactionDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-copilot-interact-'));
    tempDir = interactionDir; // runInstaller uses module-level tempDir
    runInstaller('--copilot --local');
  });

  after(() => {
    tempDir = savedTempDir;
    if (interactionDir && fs.existsSync(interactionDir)) {
      fs.rmSync(interactionDir, { recursive: true, force: true });
    }
  });

  // ── Adapter Header Tests ──

  test('skill adapter header contains User interaction section', () => {
    // Read any installed skill — all should have the adapter header
    const skillsDir = path.join(interactionDir, '.github', 'skills');
    if (!fs.existsSync(skillsDir)) return; // guard for CI
    const firstSkill = fs.readdirSync(skillsDir, { withFileTypes: true })
      .find(e => e.isDirectory() && e.name.startsWith('pan-'));
    if (!firstSkill) return;
    const content = fs.readFileSync(
      path.join(skillsDir, firstSkill.name, 'SKILL.md'), 'utf-8'
    );
    assert.ok(content.includes('User interaction:'),
      'adapter header should contain User interaction section');
    assert.ok(content.includes('numbered lists'),
      'should mention numbered lists pattern');
  });

  test('adapter header includes single-select instruction', () => {
    const skillsDir = path.join(interactionDir, '.github', 'skills');
    if (!fs.existsSync(skillsDir)) return;
    const firstSkill = fs.readdirSync(skillsDir, { withFileTypes: true })
      .find(e => e.isDirectory() && e.name.startsWith('pan-'));
    if (!firstSkill) return;
    const content = fs.readFileSync(
      path.join(skillsDir, firstSkill.name, 'SKILL.md'), 'utf-8'
    );
    assert.ok(content.includes('Type a number or label'),
      'should include single-select instruction');
  });

  test('adapter header includes multi-select instruction', () => {
    const skillsDir = path.join(interactionDir, '.github', 'skills');
    if (!fs.existsSync(skillsDir)) return;
    const firstSkill = fs.readdirSync(skillsDir, { withFileTypes: true })
      .find(e => e.isDirectory() && e.name.startsWith('pan-'));
    if (!firstSkill) return;
    const content = fs.readFileSync(
      path.join(skillsDir, firstSkill.name, 'SKILL.md'), 'utf-8'
    );
    assert.ok(content.includes('separated by commas'),
      'should include multi-select comma instruction');
  });

  test('adapter header mentions recommended option marking', () => {
    const skillsDir = path.join(interactionDir, '.github', 'skills');
    if (!fs.existsSync(skillsDir)) return;
    const firstSkill = fs.readdirSync(skillsDir, { withFileTypes: true })
      .find(e => e.isDirectory() && e.name.startsWith('pan-'));
    if (!firstSkill) return;
    const content = fs.readFileSync(
      path.join(skillsDir, firstSkill.name, 'SKILL.md'), 'utf-8'
    );
    assert.ok(content.includes('(recommended)'),
      'should mention recommended option marking');
  });

  // ── AskUserQuestion Rewriting Tests ──

  test('discuss-phase skill does not contain raw AskUserQuestion text', () => {
    const discussPath = path.join(interactionDir, '.github', 'skills', 'pan-discuss-phase', 'SKILL.md');
    if (!fs.existsSync(discussPath)) return;
    skillContent = fs.readFileSync(discussPath, 'utf-8');
    // After rewriting, there should be no raw "AskUserQuestion" — only "ask_user" references
    assert.ok(!skillContent.includes('AskUserQuestion'),
      'should not contain raw AskUserQuestion after conversion');
  });

  test('discuss-phase skill has interaction guidance instead of raw tool references', () => {
    const discussPath = path.join(interactionDir, '.github', 'skills', 'pan-discuss-phase', 'SKILL.md');
    if (!fs.existsSync(discussPath)) return;
    const content = fs.readFileSync(discussPath, 'utf-8');
    // The command body delegates to a workflow for AskUserQuestion usage,
    // so the skill should have the adapter header's interaction guidance
    assert.ok(content.includes('User interaction:'),
      'should contain User interaction guidance section from adapter header');
    assert.ok(content.includes('numbered lists'),
      'should include numbered lists instruction');
  });

  test('new-project skill does not contain raw AskUserQuestion', () => {
    const projPath = path.join(interactionDir, '.github', 'skills', 'pan-new-project', 'SKILL.md');
    if (!fs.existsSync(projPath)) return;
    const content = fs.readFileSync(projPath, 'utf-8');
    assert.ok(!content.includes('AskUserQuestion'),
      'new-project skill should not contain raw AskUserQuestion');
  });

  test('settings skill does not contain raw AskUserQuestion', () => {
    const settingsPath = path.join(interactionDir, '.github', 'skills', 'pan-settings', 'SKILL.md');
    if (!fs.existsSync(settingsPath)) return;
    const content = fs.readFileSync(settingsPath, 'utf-8');
    assert.ok(!content.includes('AskUserQuestion'),
      'settings skill should not contain raw AskUserQuestion');
  });

  // ── Block Rewrite Verification ──

  test('block rewrite produces numbered options for discuss-phase', () => {
    const discussPath = path.join(interactionDir, '.github', 'skills', 'pan-discuss-phase', 'SKILL.md');
    if (!fs.existsSync(discussPath)) return;
    const content = fs.readFileSync(discussPath, 'utf-8');
    // If block rewrite worked, there should be "1." or "2." numbered patterns
    // or "Ask the user" patterns from the rewriter
    const hasNumbered = /\d+\.\s+\*\*/.test(content);
    const hasAskUser = content.includes('Ask the user');
    assert.ok(hasNumbered || hasAskUser,
      'discuss-phase should have numbered options or Ask the user patterns');
  });

  test('workflow content with AskUserQuestion block is rewritten', () => {
    // Verify that a workflow with known AskUserQuestion patterns was rewritten
    // by checking the new-milestone skill (which has 5 AskUserQuestion invocations)
    const milestonePath = path.join(interactionDir, '.github', 'skills', 'pan-milestone-new', 'SKILL.md');
    if (!fs.existsSync(milestonePath)) return;
    const content = fs.readFileSync(milestonePath, 'utf-8');
    assert.ok(!content.includes('AskUserQuestion'),
      'new-milestone should not contain raw AskUserQuestion');
  });

  // ── Graceful Pass-Through ──

  test('content without AskUserQuestion passes through unchanged', () => {
    // Read a skill that likely has no AskUserQuestion (e.g., pan-progress)
    const progressPath = path.join(interactionDir, '.github', 'skills', 'pan-progress', 'SKILL.md');
    if (!fs.existsSync(progressPath)) return;
    const content = fs.readFileSync(progressPath, 'utf-8');
    // Should still be valid skill content
    assert.ok(content.includes('copilot_skill_adapter'),
      'non-AskUserQuestion skill should still have adapter header');
    assert.ok(content.includes('User interaction:'),
      'should still have interaction guidance in header');
  });
});

// ── Group 6: saveLocalPatches detects modified hooks ──────────

describe('Copilot CLI: saveLocalPatches hooks detection', () => {
  let patchDir;

  before(() => {
    patchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-copilot-patches-'));
    tempDir = patchDir;
    // Install first
    runInstaller('--copilot --local');
    // Modify a hook file to simulate user edit
    const hookPath = path.join(patchDir, '.github', 'hooks', 'pan-check-update.js');
    if (fs.existsSync(hookPath)) {
      const content = fs.readFileSync(hookPath, 'utf8');
      fs.writeFileSync(hookPath, content + '\n// user modification\n');
    }
    // Re-install — saveLocalPatches should detect the modification
    runInstaller('--copilot --local');
  });

  after(() => {
    tempDir = patchDir; // restore for cleanup
    if (patchDir && fs.existsSync(patchDir)) {
      fs.rmSync(patchDir, { recursive: true, force: true });
    }
  });

  test('modified hook is backed up to pan-local-patches/', () => {
    const backupDir = path.join(patchDir, '.github', 'pan-local-patches', 'hooks');
    assert.ok(fs.existsSync(backupDir), 'pan-local-patches/hooks/ should exist');
    const backed = fs.readdirSync(backupDir).filter(f => f.includes('pan-check-update'));
    assert.ok(backed.length >= 1, 'modified hook should be backed up');
  });

  test('backup-meta.json records the modified hook', () => {
    const metaPath = path.join(patchDir, '.github', 'pan-local-patches', 'backup-meta.json');
    assert.ok(fs.existsSync(metaPath), 'backup-meta.json should exist');
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    assert.ok(meta.files.some(f => f.includes('hooks/pan-check-update')),
      'meta.files should include the modified hook path');
    assert.ok(meta.from_version, 'meta should have from_version');
    assert.ok(meta.backed_up_at, 'meta should have backed_up_at timestamp');
  });
});

// ── Group 7: Cross-runtime manifest hook parity ───────────────

describe('Cross-runtime manifest hook parity', () => {
  let parityDir;
  const hookRuntimes = ['claude', 'gemini', 'copilot', 'codex']; // runtimes that support hooks (codex since 2026-06)

  before(() => {
    parityDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-manifest-parity-'));
    tempDir = parityDir;
    runInstaller('--all --local');
  });

  after(() => {
    tempDir = parityDir;
    if (parityDir && fs.existsSync(parityDir)) {
      fs.rmSync(parityDir, { recursive: true, force: true });
    }
  });

  test('all hook-supporting runtimes have identical hook file entries in manifest', () => {
    const hookSets = {};
    const dirMap = { claude: '.claude', gemini: '.gemini', copilot: '.github', codex: '.codex' };
    for (const rt of hookRuntimes) {
      const manifestPath = path.join(parityDir, dirMap[rt], 'pan-file-manifest.json');
      assert.ok(fs.existsSync(manifestPath), `${rt} manifest should exist`);
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      hookSets[rt] = Object.keys(manifest.files)
        .filter(k => k.startsWith('hooks/'))
        .sort();
    }
    // All hook-supporting runtimes should have the same hook entries
    assert.deepStrictEqual(hookSets.claude, hookSets.gemini,
      'Claude and Gemini should have identical hook manifest entries');
    assert.deepStrictEqual(hookSets.claude, hookSets.copilot,
      'Claude and Copilot should have identical hook manifest entries');
    assert.deepStrictEqual(hookSets.claude, hookSets.codex,
      'Claude and Codex should have identical hook manifest entries');
  });

  test('OpenCode manifest has zero hook entries', () => {
    const noHookDirs = { opencode: '.opencode' };
    for (const [rt, dir] of Object.entries(noHookDirs)) {
      const manifestPath = path.join(parityDir, dir, 'pan-file-manifest.json');
      assert.ok(fs.existsSync(manifestPath), `${rt} manifest should exist`);
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      const hookEntries = Object.keys(manifest.files).filter(k => k.startsWith('hooks/'));
      assert.strictEqual(hookEntries.length, 0,
        `${rt} should have zero hook entries (hooks not supported)`);
    }
  });
});
