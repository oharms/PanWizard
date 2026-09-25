/**
 * Verify / Deployment validation — manifest + settings integrity per runtime.
 * Extracted from verify.cjs (IMPROVEMENT-TODO P2 module decomposition);
 * verify.cjs re-exports everything here, so consumers are unaffected.
 */

const fs = require('fs');
const path = require('path');
const { output } = require('./core.cjs');

/**
 * Detect which PAN runtimes are installed in cwd.
 * @param {string} cwd
 * @returns {Array<{runtime: string, configDir: string}>}
 */
function detectInstalledRuntimes(cwd) {
  const RUNTIME_DIRS = [
    { runtime: 'claude', configDir: '.claude' },
    { runtime: 'opencode', configDir: '.opencode' },
    { runtime: 'gemini', configDir: '.gemini' },
    { runtime: 'codex', configDir: '.codex' },
    { runtime: 'copilot', configDir: '.github' },
  ];
  const found = [];
  for (const rt of RUNTIME_DIRS) {
    const manifestPath = path.join(cwd, rt.configDir, 'pan-file-manifest.json');
    try {
      fs.accessSync(manifestPath);
      found.push(rt);
    } catch (_) { /* not installed */ }
  }
  return found;
}

/**
 * Validate a single PAN runtime installation.
 * Checks: manifest files exist, hashes match, settings integrity.
 * @param {string} cwd
 * @param {string} configDir - e.g. '.claude'
 * @param {string} runtime - e.g. 'claude'
 * @returns {{ status: string, version: string, total_files: number, missing: string[], modified: string[], orphaned: string[], settings_ok: boolean, settings_issues: string[] }}
 */
function validateRuntimeInstall(cwd, configDir, runtime) {
  const crypto = require('crypto');
  const baseDir = path.join(cwd, configDir);
  const manifestPath = path.join(baseDir, 'pan-file-manifest.json');

  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (e) {
    return { status: 'broken', version: null, error: `Cannot read manifest: ${e.message}`, total_files: 0, missing: [], modified: [], orphaned: [], settings_ok: false, settings_issues: ['manifest unreadable'] };
  }

  const missing = [];
  const modified = [];
  const files = manifest.files || {};
  const totalFiles = Object.keys(files).length;

  for (const [relPath, expectedHash] of Object.entries(files)) {
    const absPath = path.join(baseDir, relPath);
    try {
      const content = fs.readFileSync(absPath);
      const actualHash = crypto.createHash('sha256').update(content).digest('hex');
      if (actualHash !== expectedHash) {
        modified.push(relPath);
      }
    } catch (_) {
      missing.push(relPath);
    }
  }

  // Check settings integrity (hook paths resolve to real files).
  // Copilot's user-editable settings moved to .github/copilot/settings.json
  // (2026-06; .github/config.json was never a Copilot read path) and the file
  // is optional — hooks live in .github/hooks/pan.json, so absence is fine.
  const settingsIssues = [];
  const settingsPath = runtime === 'copilot'
    ? path.join(baseDir, 'copilot', 'settings.json')
    : path.join(baseDir, 'settings.json');
  const settingsOptional = runtime === 'codex' || runtime === 'opencode' || runtime === 'copilot';
  let settingsOk = true;
  try {
    const settingsContent = fs.readFileSync(settingsPath, 'utf8');
    const settings = JSON.parse(settingsContent);
    // Check hook paths in settings
    // Collect all hook command strings from settings
    const hookCommands = [];
    const hooks = settings.hooks;
    if (hooks && typeof hooks === 'object') {
      for (const hookArr of Object.values(hooks)) {
        if (!Array.isArray(hookArr)) continue;
        // M29: PAN installs hooks in the nested Claude shape — each event maps to
        // an array of GROUPS, and each group holds the real commands under
        // group.hooks[]: { matcher, hooks: [{ type, command }] }. The old code
        // only read group.command (undefined in that shape), so it validated
        // nothing for PAN's own hooks. Collect both the flat group.command (other
        // runtimes) AND every command nested in group.hooks[].
        for (const group of hookArr) {
          if (!group || typeof group !== 'object') continue;
          if (group.command) hookCommands.push(group.command);
          if (Array.isArray(group.hooks)) {
            for (const h of group.hooks) {
              if (h && h.command) hookCommands.push(h.command);
            }
          }
        }
      }
    }
    // statusLine (Claude, Copilot; PAN writes none for Gemini since 2026-09-23)
    if (settings.statusLine && settings.statusLine.command) {
      hookCommands.push(settings.statusLine.command);
    }
    // Claude statusline
    if (settings.statusline && settings.statusline.command) {
      hookCommands.push(settings.statusline.command);
    }
    for (const cmd of hookCommands) {
      const parts = cmd.split(/\s+/);
      const hookFile = parts.find(p => p.endsWith('.js'));
      if (hookFile) {
        // Hook paths are relative to cwd, not to config dir
        const resolvedPath = path.isAbsolute(hookFile) ? hookFile : path.join(cwd, hookFile);
        try { fs.accessSync(resolvedPath); } catch (_) {
          settingsIssues.push(`Hook path not found: ${hookFile}`);
          settingsOk = false;
        }
      }
    }
  } catch (_) {
    // No settings file is OK for runtimes where settings are optional
    if (!settingsOptional) {
      settingsIssues.push(`${path.basename(settingsPath)} missing or unreadable`);
      settingsOk = false;
    }
  }

  const mcp = validateMcpRegistration(cwd, configDir, runtime);
  if (!mcp.ok) settingsIssues.push(...mcp.issues);

  const status = missing.length > 0 ? 'broken'
    : modified.length > 0 ? 'modified'
      : !mcp.ok ? 'modified'
        : 'clean';

  return {
    status,
    version: manifest.version || null,
    total_files: totalFiles,
    missing,
    modified,
    orphaned: [],
    settings_ok: settingsOk && mcp.ok,
    settings_issues: settingsIssues,
    mcp,
  };
}

/**
 * Where each runtime's MCP registration lives, relative to the project (claude)
 * or to the runtime's config dir (everything else), and under which container
 * key. This MIRRORS `MCP_REGISTRATION` in bin/install-lib.cjs — the installer
 * writes, this reads, and the two must agree.
 *
 * Duplicated rather than imported on purpose: install-lib.cjs is installer-side
 * and is NOT shipped into an install, while this module runs from inside one. A
 * scenario test pins the two tables against each other so the copy cannot drift
 * silently.
 *
 * `codex` is absent because registration there is `register: false` — PAN prints
 * a TOML snippet rather than writing config, so there is nothing to verify.
 */
const MCP_EXPECTED = {
  claude: { rel: '.mcp.json', fromProjectRoot: true, key: 'mcpServers' },
  copilot: { rel: 'mcp.json', fromProjectRoot: false, key: 'mcpServers' },
  gemini: { rel: 'settings.json', fromProjectRoot: false, key: 'mcpServers' },
  opencode: { rel: 'opencode.json', fromProjectRoot: false, key: 'mcp' },
};

/**
 * Verify the MCP registration this install wrote.
 *
 * WHY: `registerMcpServer()` writes up to four config files per install, and this
 * verdict is the only thing most callers check afterwards. Until 2026-08 it had no
 * idea MCP existed, so a fresh install reported `clean` whether registration
 * succeeded, was skipped because the server file was missing, or was refused
 * because the runtime's config was unparseable JSON. The installer recorded those
 * cases as warnings; nothing surfaced them where anyone looks.
 *
 * Every part of this is checkable without launching the bridge: the config is
 * present, it parses, it carries a `pan` entry, and the server path in that entry
 * exists on disk. Whether a RUNTIME then loads it is a separate claim this cannot
 * make, and does not.
 *
 * @returns {{ok:boolean, registered:boolean, path:string|null, issues:string[]}}
 */
function validateMcpRegistration(cwd, configDir, runtime) {
  const spec = MCP_EXPECTED[runtime];
  // codex (and any future register:false runtime) has nothing to verify.
  if (!spec) return { ok: true, registered: false, path: null, issues: [], skipped: 'no-registration-by-design' };

  // ONLY expect a registration when this install actually SHIPS the bridge.
  //
  // An install made before the MCP bridge existed has no `.mcp.json` and never
  // should have — flagging it would be a false alarm on every older deployment,
  // and the first version of this check did exactly that, turning four green
  // fixtures red for lacking a file they were never supposed to have. The
  // installed tree is the authority: if `pan-wizard-core/mcp/server.cjs` is
  // present, registration is expected; if it is not, there is nothing to verify.
  const bridge = path.join(cwd, configDir, 'pan-wizard-core', 'mcp', 'server.cjs');
  try {
    fs.accessSync(bridge);
  } catch (_) {
    return { ok: true, registered: false, path: null, issues: [], skipped: 'bridge-not-in-this-install' };
  }

  const configPath = spec.fromProjectRoot
    ? path.join(cwd, spec.rel)
    : path.join(cwd, configDir, spec.rel);
  const shown = path.relative(cwd, configPath) || spec.rel;

  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (e) {
    // Absent and unparseable are different failures and must read differently:
    // one means registration never happened, the other means PAN deliberately
    // left a file it could not safely rewrite.
    const missingFile = e && e.code === 'ENOENT';
    return {
      ok: false,
      registered: false,
      path: shown,
      issues: [missingFile
        ? `MCP not registered: ${shown} is missing`
        : `MCP config unreadable (left untouched by design): ${shown} — ${e.message}`],
    };
  }

  const bag = parsed && parsed[spec.key];
  const entry = bag && typeof bag === 'object' ? bag.pan : undefined;
  if (!entry) {
    return { ok: false, registered: false, path: shown, issues: [`MCP not registered: no "pan" entry under "${spec.key}" in ${shown}`] };
  }

  // The server path is `args[0]` everywhere except opencode, whose `command` is a
  // single array of [cmd, ...args] — the shape difference that has already caused
  // one bug in this feature.
  const serverPath = Array.isArray(entry.command) ? entry.command[1] : (entry.args && entry.args[0]);
  const issues = [];
  if (!serverPath) {
    issues.push(`MCP entry in ${shown} names no server path`);
  } else {
    try { fs.accessSync(serverPath); } catch (_) {
      issues.push(`MCP server path does not exist: ${serverPath} (from ${shown})`);
    }
  }
  return { ok: issues.length === 0, registered: true, path: shown, server: serverPath || null, issues };
}

/**
 * CLI command: validate deployment
 * Validates PAN installations in the current directory.
 * @param {string} cwd
 * @param {boolean} raw
 */
function cmdValidateDeployment(cwd, raw) {
  const runtimes = detectInstalledRuntimes(cwd);
  if (runtimes.length === 0) {
    output({ error: 'No PAN installations found in this directory' }, raw);
    return;
  }

  const results = {};
  let overallStatus = 'clean';

  for (const { runtime, configDir } of runtimes) {
    const result = validateRuntimeInstall(cwd, configDir, runtime);
    results[runtime] = result;
    if (result.status === 'broken') overallStatus = 'broken';
    else if (result.status === 'modified' && overallStatus !== 'broken') overallStatus = 'modified';
  }

  const summary = {
    status: overallStatus,
    runtimes_found: runtimes.length,
    runtimes: results,
  };

  const rawLines = [`Deployment status: ${overallStatus} (${runtimes.length} runtimes)`];
  for (const [rt, r] of Object.entries(results)) {
    rawLines.push(`  ${rt}: ${r.status} (${r.total_files} files, ${r.missing.length} missing, ${r.modified.length} modified)`);
  }

  output(summary, raw, rawLines.join('\n'));
}

module.exports = {
  detectInstalledRuntimes,
  validateRuntimeInstall,
  cmdValidateDeployment,
  validateMcpRegistration,
  MCP_EXPECTED,
};
