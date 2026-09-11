/**
 * Build the PAN Wizard **Agent Plugins 1.0** bundle (ADR-0045) — the vendor-
 * neutral package that Copilot CLI / VS Code, Codex, Cursor and Kiro load
 * natively. Emits a self-contained directory at dist/pan-agent-plugin/:
 *
 *   plugin.json                   closed-schema manifest ($schema + name + metadata)
 *   skills/pan-<name>/SKILL.md    every PAN command as an Agent Skill, from the
 *                                 ONE unified-skills compiler (ADR-0028)
 *   mcp.json                      the bundled bridge, launched as
 *                                 `node ${PLUGIN_ROOT}/pan-wizard-core/mcp/server.cjs`
 *   pan-wizard-core/              dispatcher + modules + workflows + templates +
 *                                 references + learnings (internal stripped) +
 *                                 canonical agent reference copies under agents/
 *
 *   hooks/pan-*.js                PAN's hook scripts (pure Node), shared by every vendor
 *   hooks/hooks.json              Codex: default plugin hooks location; matcher-group
 *                                 shape with `${PLUGIN_ROOT}` paths and `async` observers
 *                                 (developers.openai.com/plugins/build/plugins, 2026-09-10)
 *   com.github.copilot/           Copilot's reverse-domain namespace (ADR-0045 D5):
 *     agents/pan-*.agent.md         agents in Copilot's format
 *     hooks/hooks.json              flat PascalCase format, `${CLAUDE_PLUGIN_ROOT}` paths
 *                                   (VS-Code-verified; Copilot CLI live install is the gate)
 *
 * NOT emitted: Codex agents (no plugin agent component is documented) and any
 * Antigravity variant (its manifest schema is closed and different — a separate
 * layout, deferred until its file shapes are read from a primary source).
 *
 * Paths inside skill and core markdown use PAN's `{{PAN_PLUGIN_ROOT}}` token,
 * defined for the model by the adapter note in every skill; `${PLUGIN_ROOT}`
 * (the client-expanded variable) appears only in mcp.json, the one place the
 * spec expands it.
 *
 * Usage: node scripts/build-agent-plugin.js   (or npm run build:agent-plugin)
 * PAN_AGENT_PLUGIN_OUT=<dir> overrides the output directory (tests build into
 * private temp dirs so parallel test files never race on dist/).
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = process.env.PAN_AGENT_PLUGIN_OUT
  ? path.resolve(process.env.PAN_AGENT_PLUGIN_OUT)
  : path.join(ROOT, 'dist', 'pan-agent-plugin');
const pkg = require(path.join(ROOT, 'package.json'));
const lib = require(path.join(ROOT, 'bin', 'install-lib.cjs'));

const TOKEN_PREFIX = `${lib.AGENT_PLUGIN_ROOT_TOKEN}/`;
const REWRITE = {
  // Core and agent references → inside the bundle.
  corePrefix: TOKEN_PREFIX,
  // Residual `~/.claude/…` → the consuming runtime's USER config dir; residual
  // `./.claude/…` → its PROJECT dir. Neither is known at build time, so both are
  // tokens the adapter note defines (install-lib AGENT_PLUGIN_RUNTIME_*_TOKEN).
  pathPrefix: `${lib.AGENT_PLUGIN_RUNTIME_HOME_TOKEN}/`,
  projectDirPrefix: `${lib.AGENT_PLUGIN_RUNTIME_DIR_TOKEN}/`,
  attribution: undefined, // keep the documents' default attribution — no runtime to consult
};

/**
 * Refuse to wipe a directory that is not a previous bundle build (same rule as
 * build-plugin.js). Empty or absent directories, and our own previous output —
 * recognised by a manifest carrying the Agent Plugins schema — are fair game.
 */
function assertSafeToReplace(dir) {
  if (!fs.existsSync(dir)) return;
  if (fs.readdirSync(dir).length === 0) return;
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'plugin.json'), 'utf8'));
    if (manifest && manifest.$schema === lib.AGENT_PLUGIN_MANIFEST_SCHEMA) return;
  } catch { /* fall through to refusal */ }
  throw new Error(`build-agent-plugin: refusing to replace ${dir} — it is non-empty and does not look like a previous bundle build (no Agent Plugins plugin.json)`);
}

/** commands/pan/**.md → skills/pan-<name>/SKILL.md, mirroring the installer's recursion. */
function emitSkills(srcDir, skillsDir, prefix) {
  let count = 0;
  (function recurse(currentSrc, currentPrefix) {
    for (const entry of fs.readdirSync(currentSrc, { withFileTypes: true })) {
      const srcPath = path.join(currentSrc, entry.name);
      if (entry.isDirectory()) { recurse(srcPath, `${currentPrefix}-${entry.name}`); continue; }
      if (!entry.name.endsWith('.md')) continue;
      const skillName = `${currentPrefix}-${entry.name.replace(/\.md$/, '')}`;
      const skillDir = path.join(skillsDir, skillName);
      fs.mkdirSync(skillDir, { recursive: true });
      let content = fs.readFileSync(srcPath, 'utf8');
      content = lib.rewriteUnifiedSkillCommandContent(content, REWRITE);
      content = lib.convertClaudeCommandToUnifiedSkill(content, skillName, { adapterNote: lib.agentPluginSkillAdapterNote() });
      fs.writeFileSync(path.join(skillDir, 'SKILL.md'), content);
      count++;
    }
  })(srcDir, prefix);
  return count;
}

/** pan-wizard-core → bundle, markdown rewritten, everything else verbatim. */
function emitCore(srcDir, destDir) {
  (function recurse(currentSrc, currentDest) {
    fs.mkdirSync(currentDest, { recursive: true });
    for (const entry of fs.readdirSync(currentSrc, { withFileTypes: true })) {
      const srcPath = path.join(currentSrc, entry.name);
      const destPath = path.join(currentDest, entry.name);
      if (entry.isDirectory()) recurse(srcPath, destPath);
      else if (entry.name.endsWith('.md')) fs.writeFileSync(destPath, lib.rewriteSharedCoreMarkdown(fs.readFileSync(srcPath, 'utf8'), REWRITE));
      else fs.copyFileSync(srcPath, destPath);
    }
  })(srcDir, destDir);

  // learnings/internal is source-only — strip the files AND the index entries,
  // exactly as the installer and the Claude plugin builder do.
  fs.rmSync(path.join(destDir, 'learnings', 'internal'), { recursive: true, force: true });
  const indexPath = path.join(destDir, 'learnings', 'index.json');
  try {
    const stripped = lib.stripInternalLearningsTopics(JSON.parse(fs.readFileSync(indexPath, 'utf8')));
    if (stripped) fs.writeFileSync(indexPath, JSON.stringify(stripped, null, 2) + '\n');
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  fs.writeFileSync(path.join(destDir, 'VERSION'), pkg.version);
}

/** Canonical agent reference copies under <core>/agents/ (ADR-0028). */
function emitAgentReferenceCopies(agentsSrc, agentsRefDir) {
  fs.mkdirSync(agentsRefDir, { recursive: true });
  let count = 0;
  for (const f of fs.readdirSync(agentsSrc).filter(n => n.endsWith('.md'))) {
    fs.writeFileSync(path.join(agentsRefDir, f), lib.rewriteAgentReferenceCopy(fs.readFileSync(path.join(agentsSrc, f), 'utf8'), TOKEN_PREFIX));
    count++;
  }
  return count;
}

/** Hook scripts: the built copies from hooks/dist when present, else the pure-Node sources. */
function emitHookScripts(destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  const dist = path.join(ROOT, 'hooks', 'dist');
  const src = fs.existsSync(dist) ? dist : path.join(ROOT, 'hooks');
  const names = fs.readdirSync(src).filter(n => /^pan-[a-z-]+\.js$/.test(n)).sort();
  for (const n of names) fs.copyFileSync(path.join(src, n), path.join(destDir, n));
  return names;
}

/** The four hook commands, anchored at the plugin root through whichever variable the consumer expands. */
function hookCommands(rootVar) {
  const cmd = (script) => `node ${rootVar}/hooks/${script}`;
  return {
    updateCheckCommand: cmd('pan-check-update.js'),
    contextMonitorCommand: cmd('pan-context-monitor.js'),
    costLoggerCommand: cmd('pan-cost-logger.js'),
    traceLoggerCommand: cmd('pan-trace-logger.js'),
  };
}

/** Copilot vendor directory: agents in Copilot's `.agent.md` format + plugin hooks. */
function emitCopilotNamespace(agentsSrc, nsDir) {
  const agentsDest = path.join(nsDir, 'agents');
  fs.mkdirSync(agentsDest, { recursive: true });
  let agents = 0;
  for (const f of fs.readdirSync(agentsSrc).filter(n => n.endsWith('.md'))) {
    let content = fs.readFileSync(path.join(agentsSrc, f), 'utf8');
    // Core references → the bundle token; mentions → /pan-<name>; then the same
    // two steps the installer applies to a Copilot agent (thinking frontmatter
    // strip, Copilot frontmatter/tool-name conversion).
    content = lib.rewriteAgentReferenceCopy(content, TOKEN_PREFIX);
    content = lib.stripThinkingFrontmatter(content, 'copilot');
    content = lib.convertClaudeToCopilotAgent(content);
    fs.writeFileSync(path.join(agentsDest, f.replace(/\.md$/, '.agent.md')), content);
    agents++;
  }
  fs.mkdirSync(path.join(nsDir, 'hooks'), { recursive: true });
  fs.writeFileSync(
    path.join(nsDir, 'hooks', 'hooks.json'),
    JSON.stringify(lib.buildCopilotPluginHooksConfig(hookCommands('${CLAUDE_PLUGIN_ROOT}')), null, 2) + '\n'
  );
  return agents;
}

function main() {
  assertSafeToReplace(OUT);
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });

  // 1. Manifest (closed schema — nothing beyond the ten permitted keys)
  fs.writeFileSync(path.join(OUT, 'plugin.json'), JSON.stringify(lib.buildAgentPluginManifest(pkg), null, 2) + '\n');

  // 2. Skills
  const skills = emitSkills(path.join(ROOT, 'commands', 'pan'), path.join(OUT, 'skills'), 'pan');

  // 3. Core (+ 4. canonical agent copies inside it)
  const coreDest = path.join(OUT, 'pan-wizard-core');
  emitCore(path.join(ROOT, 'pan-wizard-core'), coreDest);
  const agents = emitAgentReferenceCopies(path.join(ROOT, 'agents'), path.join(coreDest, 'agents'));

  // 5. MCP declaration
  fs.writeFileSync(path.join(OUT, 'mcp.json'), JSON.stringify(lib.buildAgentPluginMcpConfig(), null, 2) + '\n');

  // 6. Hooks: scripts once, at the root; a Codex hooks.json at the documented
  //    default location (`hooks/hooks.json`, `${PLUGIN_ROOT}` expanded in commands,
  //    observers async — the same builder the installer uses for .codex/hooks.json).
  const hooksDir = path.join(OUT, 'hooks');
  const hookScripts = emitHookScripts(hooksDir);
  fs.writeFileSync(
    path.join(hooksDir, 'hooks.json'),
    JSON.stringify(lib.mergeCodexHooksConfig(null, hookCommands('${PLUGIN_ROOT}')), null, 2) + '\n'
  );

  // 7. Copilot vendor namespace
  const copilotAgents = emitCopilotNamespace(path.join(ROOT, 'agents'), path.join(OUT, lib.COPILOT_PLUGIN_NAMESPACE));

  console.log('PAN Agent Plugins bundle built at', path.relative(ROOT, OUT) || OUT);
  console.log('  skills:', skills);
  console.log('  agent reference copies:', agents);
  console.log('  hook scripts:', hookScripts.length);
  console.log(`  ${lib.COPILOT_PLUGIN_NAMESPACE}/agents:`, copilotAgents);
  console.log('  version:', pkg.version);
}

main();
