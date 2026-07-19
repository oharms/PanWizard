#!/usr/bin/env node
'use strict';

/**
 * PAN-Z M4 — assemble the ZCode bundle and emit a pull-based install.
 *
 * Produces, into an explicit --target directory:
 *   agents/*.md              PAN agents converted to ZCode subagents (best-effort)
 *   pan-mcp.json             the MCP server registration (command/args/env)
 *   pan-zcode-manifest.json  what was generated
 *   INSTALL-ZCODE.md         how to finish setup inside ZCode
 *
 * It NEVER writes to a real ~/.zcode on its own and NEVER writes inside the PAN
 * source repo — ZCode's on-disk formats churn weekly, so the human finishes setup by
 * driving ZCode's own "Import from Claude Code" / Settings surfaces using this bundle.
 */

const fs = require('fs');
const path = require('path');
const { convertAgentsDir } = require('../lib/convert-agent.cjs');

/** The MCP registration ZCode reads (Claude-compatible: command/args/env). */
function mcpServerConfig(panToolsPath, serverPath, projectRoot) {
  return {
    mcpServers: {
      'pan-mcp': {
        command: 'node',
        args: [serverPath],
        env: { PAN_TOOLS_PATH: panToolsPath, PAN_PROJECT_ROOT: projectRoot || '.' },
      },
    },
  };
}

const INSTRUCTIONS = `# Install PAN-Z into ZCode

PAN-Z bridges PAN's engine to ZCode over MCP. Finish setup inside ZCode:

1. **Register the MCP server.** Add the contents of \`pan-mcp.json\` to ZCode's MCP
   configuration (Settings → MCP), or point ZCode's MCP config at this file. This
   exposes the \`pan_*\` tools (state, plan, verify, report, next-action, merge gate).

2. **Import the subagents.** The \`agents/\` folder holds PAN agents in ZCode subagent
   form. Prefer ZCode's **Import from Claude Code** / Settings → Subagents to register
   them, since ZCode owns the on-disk format (it is a fast-moving Beta). These files are
   a fallback, not a contract.

3. **Protect your branches.** The merge gate (\`pan_confirm_merge\`) is one lock; the
   real, non-bypassable one is **server-side branch protection** on your remote. Enable
   required reviews so a raw push under Full Access cannot merge. Approve a staged merge
   by setting \`PAN_MERGE_APPROVAL=<request-id>\` in the MCP server's environment.

4. **Never run the install/import step in ZCode Full Access mode.**

Not yet resolved (the M0 verify spike, on your real ZCode): whether a subagent can call
MCP tools, and whether local stdio MCP calls are metered. Until confirmed, the primary
Agent makes every pan-mcp call.
`;

function assertNotInSourceRepo(destDir, repoRoot) {
  const d = path.resolve(destDir);
  const r = path.resolve(repoRoot);
  if (d === r || d.startsWith(r + path.sep)) {
    throw new Error('Refusing to write the PAN-Z bundle inside the PAN source repo. Choose a --target outside it.');
  }
}

/**
 * Build the bundle.
 * @param {{repoRoot:string, destDir:string, projectRoot?:string}} o
 * @returns {{agents:number, destDir:string, mcp:Object, files:string[]}}
 */
function buildBundle(o) {
  const repoRoot = path.resolve(o.repoRoot);
  const destDir = path.resolve(o.destDir);
  assertNotInSourceRepo(destDir, repoRoot);

  const agentsSrc = path.join(repoRoot, 'agents');
  const serverPath = path.join(repoRoot, 'pan-zcode', 'mcp', 'server.cjs');
  const panToolsPath = path.join(repoRoot, 'pan-wizard-core', 'bin', 'pan-tools.cjs');

  fs.mkdirSync(destDir, { recursive: true });
  const agents = fs.existsSync(agentsSrc) ? convertAgentsDir(agentsSrc, path.join(destDir, 'agents')) : [];

  const mcp = mcpServerConfig(panToolsPath, serverPath, o.projectRoot);
  fs.writeFileSync(path.join(destDir, 'pan-mcp.json'), JSON.stringify(mcp, null, 2), 'utf8');

  const manifest = {
    subsystem: 'pan-zcode',
    agents: agents.map((a) => a.name),
    mcp_config: 'pan-mcp.json',
    server: serverPath,
    pan_tools: panToolsPath,
  };
  fs.writeFileSync(path.join(destDir, 'pan-zcode-manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
  fs.writeFileSync(path.join(destDir, 'INSTALL-ZCODE.md'), INSTRUCTIONS, 'utf8');

  return { agents: agents.length, destDir, mcp, files: ['agents/', 'pan-mcp.json', 'pan-zcode-manifest.json', 'INSTALL-ZCODE.md'] };
}

function getArg(args, name) {
  const i = args.indexOf(name);
  return i !== -1 && i + 1 < args.length ? args[i + 1] : null;
}

function main() {
  const args = process.argv.slice(2);
  const target = getArg(args, '--target');
  if (!target) {
    console.error('Usage: install-zcode.js --target <dir> [--project-root <dir>]');
    console.error('Writes the PAN-Z ZCode bundle to <dir> (outside the PAN source repo).');
    process.exit(2);
  }
  const repoRoot = path.resolve(__dirname, '..', '..');
  try {
    const res = buildBundle({ repoRoot, destDir: target, projectRoot: getArg(args, '--project-root') });
    console.log(`pan-zcode bundle written to ${res.destDir} (${res.agents} subagents + MCP config).`);
    console.log('Next: open INSTALL-ZCODE.md and finish setup inside ZCode.');
  } catch (e) {
    console.error(`install-zcode: ${e.message}`);
    process.exit(1);
  }
}

if (require.main === module) main();

module.exports = { buildBundle, mcpServerConfig, assertNotInSourceRepo };
