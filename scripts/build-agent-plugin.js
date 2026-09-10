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
 * Vendor namespace directories (com.github.copilot/, Codex, Antigravity) are
 * NOT emitted here yet — each is gated on reading its primary docs (plan items
 * 4c/4d). This is the portable core the standard defines: skills + MCP.
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

  console.log('PAN Agent Plugins bundle built at', path.relative(ROOT, OUT) || OUT);
  console.log('  skills:', skills);
  console.log('  agent reference copies:', agents);
  console.log('  version:', pkg.version);
}

main();
