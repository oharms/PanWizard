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
        for (const hook of hookArr) {
          if (hook.command) hookCommands.push(hook.command);
        }
      }
    }
    // Copilot/Gemini statusLine
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

  const status = missing.length > 0 ? 'broken' : modified.length > 0 ? 'modified' : 'clean';

  return {
    status,
    version: manifest.version || null,
    total_files: totalFiles,
    missing,
    modified,
    orphaned: [],
    settings_ok: settingsOk,
    settings_issues: settingsIssues,
  };
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
};
