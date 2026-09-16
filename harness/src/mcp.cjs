'use strict';

/**
 * Drive the INSTALLED PAN MCP bridge over real stdio JSON-RPC (ADR-0047 D4, `mcp` steps).
 *
 * Spawns `node <workspace>/<runtime dir>/pan-wizard-core/mcp/server.cjs` and feeds
 * a whole batch in on stdin — the server exits on stdin end, so a batch is also a
 * clean session. Spawning rather than requiring the module is the point: PAN's own
 * suite calls handle() directly and never executes the framing loop, and it measures
 * the source tree, not the deployed copy. Kept from the PanLoop design, which found
 * two dead resources exactly this way.
 *
 * Options: { cwd } sets the server's working directory (defaults to the workspace).
 * Scenario steps that want to prove the per-call `cwd` tool input pass a DIFFERENT
 * cwd here and a workspace path inside the tool arguments.
 */

const { spawnSync } = require('child_process');
const path = require('path');

const RUNTIME_DIR = { claude: '.claude', codex: '.codex', gemini: '.gemini', opencode: '.opencode', copilot: '.github' };

function serverPath(workspace, runtime = 'claude') {
  return path.join(workspace, RUNTIME_DIR[runtime] || '.claude', 'pan-wizard-core', 'mcp', 'server.cjs');
}

/**
 * @param {string} workspace
 * @param {Array<object|string>} requests - JSON-RPC objects, or raw strings sent verbatim
 * @param {{runtime?:string, cwd?:string, timeoutMs?:number}} [opts]
 * @returns {{ok:boolean, code:number|null, responses:object[], stdout:string, stderr:string, error?:string}}
 */
function rpcBatch(workspace, requests, opts = {}) {
  const server = serverPath(workspace, opts.runtime);
  const input = requests.map(r => (typeof r === 'string' ? r : JSON.stringify(r))).join('\n') + '\n';
  const r = spawnSync(process.execPath, [server], {
    cwd: opts.cwd || workspace,
    input,
    encoding: 'utf8',
    timeout: opts.timeoutMs || 60000,
    env: { ...process.env, PAN_PROJECT_ROOT: '' }, // the server must not inherit a project root from this shell
  });
  const stdout = String(r.stdout || '');
  const responses = [];
  for (const line of stdout.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try { responses.push(JSON.parse(t)); } catch { /* non-JSON noise is reported via stdout */ }
  }
  return {
    ok: !r.error && r.status === 0,
    code: r.status,
    responses,
    stdout,
    stderr: String(r.stderr || ''),
    error: r.error ? String(r.error.message || r.error) : undefined,
  };
}

/** Replace `<ws>` and `<other>` placeholders inside request arguments with real paths. */
function materialise(requests, vars) {
  const text = JSON.stringify(requests);
  const filled = text.replace(/<(ws|other|state)>/g, (_, k) => JSON.stringify(vars[k] || '').slice(1, -1));
  return JSON.parse(filled);
}

module.exports = { rpcBatch, serverPath, materialise, RUNTIME_DIR };
