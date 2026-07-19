'use strict';

/**
 * PAN-Z M3 — content port: Claude agent/command markdown → ZCode subagent/skill.
 *
 * Reuses the installer's frontmatter helpers (bin/install-lib.cjs) so the parsing
 * matches every other runtime converter. ZCode stores subagents as Markdown at
 * ~/.zcode/agents/<name>.md; the exact frontmatter schema is docs-silent on a
 * weekly-churning Beta, so this emits a conservative, clearly-labelled best-effort
 * shape. The installer PREFERS ZCode's own "Import from Claude Code" surface where
 * available (see install-zcode.js / the M0 verify spike) and treats these files as a
 * fallback, not a contract.
 *
 * Two structural facts from the review are honored here:
 *  - No subagent nesting → the `Task` tool (PAN's delegation primitive) is dropped;
 *    a ported subagent is a leaf worker, and the primary Agent orchestrates.
 *  - Per-subagent model selection exists but PAN's tier aliases (opus/sonnet/haiku)
 *    are not ZCode model ids → model maps to "inherit" (ZCode's "Inherit default"),
 *    preserving the original tier as a hint comment.
 */

const fs = require('fs');
const path = require('path');
const { extractFrontmatterAndBody, extractFrontmatterField } = require('../../bin/install-lib.cjs');

/** Tools that must not survive the port (no nesting; MCP names are host-specific). */
function remapTools(toolsCsv) {
  if (!toolsCsv) return null;
  const kept = toolsCsv.split(',').map((t) => t.trim()).filter(Boolean)
    .filter((t) => t !== 'Task' && !t.startsWith('mcp__'));
  return kept.length ? kept.join(', ') : null;
}

/** Convert one Claude agent markdown string → a ZCode subagent markdown string. */
function convertClaudeToZcodeAgent(content) {
  const { frontmatter, body } = extractFrontmatterAndBody(content);
  const name = (frontmatter && extractFrontmatterField(frontmatter, 'name')) || 'pan-agent';
  const description = (frontmatter && extractFrontmatterField(frontmatter, 'description')) || '';
  const color = frontmatter && extractFrontmatterField(frontmatter, 'color');
  const tierHint = frontmatter && extractFrontmatterField(frontmatter, 'model');
  const tools = remapTools(frontmatter && extractFrontmatterField(frontmatter, 'tools'));

  const fm = ['---', `name: ${name}`, `description: ${description}`];
  // PAN tiers aren't ZCode model ids → inherit the primary Agent's model.
  fm.push('model: inherit');
  if (tierHint) fm.push(`# pan-tier: ${tierHint}  (original PAN model tier; mapped to inherit)`);
  if (color) fm.push(`color: ${color}`);
  if (tools) fm.push(`tools: ${tools}`);
  fm.push('---');

  return `${fm.join('\n')}\n${String(body).trimStart()}`;
}

/** Wrap a Claude /pan command markdown as a ZCode skill doc (best-effort). */
function convertClaudeCommandToZcodeSkill(content, commandName) {
  const { body } = extractFrontmatterAndBody(content);
  const header = [
    '---',
    `name: pan-${commandName}`,
    `description: PAN ${commandName} workflow (invoke via the pan-mcp tools + this playbook).`,
    '---',
    '',
    `> ZCode has no custom slash-commands. This skill carries the ${commandName} playbook;`,
    '> its deterministic steps run through the pan-mcp tools (see the pan_* tool list).',
    '',
  ].join('\n');
  return header + String(body).trimStart();
}

/**
 * Convert every agents/*.md under srcDir into ZCode subagent files under destDir.
 * @returns {Array<{name:string, dest:string}>}
 */
function convertAgentsDir(srcDir, destDir) {
  const out = [];
  const files = fs.readdirSync(srcDir).filter((f) => f.endsWith('.md'));
  fs.mkdirSync(destDir, { recursive: true });
  for (const f of files) {
    const content = fs.readFileSync(path.join(srcDir, f), 'utf8');
    const converted = convertClaudeToZcodeAgent(content);
    const dest = path.join(destDir, f);
    fs.writeFileSync(dest, converted, 'utf8');
    out.push({ name: f.replace(/\.md$/, ''), dest });
  }
  return out;
}

module.exports = {
  convertClaudeToZcodeAgent, convertClaudeCommandToZcodeSkill, convertAgentsDir, remapTools,
};
