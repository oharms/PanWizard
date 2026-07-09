#!/usr/bin/env node
// Claude Code Statusline - PAN Edition
// Shows: model | current task | directory | context | cache | thinking

const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * Build the statusline output string from the JSON payload Claude Code pipes
 * to stdin. Pure function — no stdin, no stdout, no process exit. Safe to
 * call from tests.
 *
 * @param {Object} data - Parsed stdin JSON from Claude Code.
 * @param {Object} [deps] - Optional dep injection for testing.
 *   {fs, path, homeDir, tmpDir} — defaults to real modules + OS paths.
 * @returns {string} The statusline content.
 */
function buildStatuslineOutput(data, deps) {
  const d = deps || {};
  const fsMod = d.fs || fs;
  const pathMod = d.path || path;
  const homeDir = d.homeDir || os.homedir();
  const tmpDir = d.tmpDir || os.tmpdir();

  if (!data || typeof data !== 'object') return '';

  const model = data.model?.display_name || 'Claude';
  const dir = data.workspace?.current_dir || process.cwd();
  const session = data.session_id || '';
  const remaining = data.context_window?.remaining_percentage;

  // Context window bar — shows USED percentage scaled so 80% real = 100% shown.
  let ctx = '';
  if (remaining != null) {
    const rem = Math.round(remaining);
    const rawUsed = Math.max(0, Math.min(100, 100 - rem));
    const used = Math.min(100, Math.round((rawUsed / 80) * 100));

    if (session && d.skipBridge !== true) {
      try {
        // Write the bridge file into a per-user 0700 subdir so another user on
        // a shared host can't symlink-attack the predictable session path.
        // Mirrors bridgeDir() in pan-context-monitor.js (the reader).
        const uid = (typeof process.getuid === 'function' ? process.getuid() : process.env.USERNAME || 'win');
        const bridgeSubdir = pathMod.join(tmpDir, `pan-hooks-${uid}`);
        try { fsMod.mkdirSync(bridgeSubdir, { recursive: true, mode: 0o700 }); } catch { /* best-effort */ }
        const bridgePath = pathMod.join(bridgeSubdir, `claude-ctx-${session}.json`);
        fsMod.writeFileSync(bridgePath, JSON.stringify({
          session_id: session,
          remaining_percentage: remaining,
          used_pct: used,
          timestamp: Math.floor(Date.now() / 1000),
        }));
      } catch { /* bridge is best-effort */ }
    }

    const filled = Math.floor(used / 10);
    const bar = '█'.repeat(filled) + '░'.repeat(10 - filled);

    if (used < 63) {
      ctx = ` \x1b[32m${bar} ${used}%\x1b[0m`;
    } else if (used < 81) {
      ctx = ` \x1b[33m${bar} ${used}%\x1b[0m`;
    } else if (used < 95) {
      ctx = ` \x1b[38;5;208m${bar} ${used}%\x1b[0m`;
    } else {
      ctx = ` \x1b[5;31m💀 ${bar} ${used}%\x1b[0m`;
    }
  }

  // E-8: Opus 4.7 indicators. Read from stdin data first (if present),
  // else merge from optional bridge file `claude-pan-<session>.json` that
  // an agent or external process can write.
  let panExtras = null;
  if (session) {
    try {
      const extrasPath = pathMod.join(tmpDir, `claude-pan-${session}.json`);
      const extrasRaw = fsMod.readFileSync(extrasPath, 'utf8');
      panExtras = JSON.parse(extrasRaw);
    } catch { /* no extras is fine */ }
  }

  const thinkingActive = (data.thinking && data.thinking.active === true)
    || (panExtras && panExtras.thinking_active === true);
  const cacheHitRate = (data.cache && typeof data.cache.hit_rate_pct === 'number')
    ? data.cache.hit_rate_pct
    : (panExtras && typeof panExtras.cache_hit_rate_pct === 'number'
      ? panExtras.cache_hit_rate_pct
      : null);

  let thinkingBadge = '';
  if (thinkingActive) thinkingBadge = ' \x1b[35m🧠\x1b[0m';

  let cacheBadge = '';
  if (cacheHitRate != null) {
    const pct = Math.max(0, Math.min(100, Math.round(cacheHitRate)));
    // Color: green ≥70%, yellow 30-70%, dim <30% (warmup).
    const color = pct >= 70 ? '\x1b[32m' : pct >= 30 ? '\x1b[33m' : '\x1b[2m';
    cacheBadge = ` ${color}⚡${pct}%\x1b[0m`;
  }

  // Current task from todos
  let task = '';
  const todosDir = pathMod.join(homeDir, '.claude', 'todos');
  let todosExists = false;
  try { todosExists = fsMod.statSync(todosDir).isDirectory(); } catch { /* missing */ }
  if (session && todosExists) {
    try {
      const files = fsMod.readdirSync(todosDir)
        .filter(f => f.startsWith(session) && f.includes('-agent-') && f.endsWith('.json'))
        .map(f => {
          try { return { name: f, mtime: fsMod.statSync(pathMod.join(todosDir, f)).mtime }; }
          catch { return null; }
        })
        .filter(Boolean)
        .sort((a, b) => b.mtime - a.mtime);

      if (files.length > 0) {
        try {
          const todos = JSON.parse(fsMod.readFileSync(pathMod.join(todosDir, files[0].name), 'utf8'));
          const inProgress = todos.find(t => t.status === 'in_progress');
          if (inProgress) task = inProgress.activeForm || '';
        } catch { /* malformed todos file — skip */ }
      }
    } catch { /* fs errors — silent */ }
  }

  // PAN update available?
  let panUpdate = '';
  const cacheFile = pathMod.join(homeDir, '.claude', 'cache', 'pan-update-check.json');
  try {
    const cache = JSON.parse(fsMod.readFileSync(cacheFile, 'utf8'));
    if (cache.update_available) panUpdate = '\x1b[33m⬆ /pan:update\x1b[0m │ ';
  } catch { /* no update cache — silent */ }

  const dirname = pathMod.basename(dir);
  const head = `${panUpdate}\x1b[2m${model}\x1b[0m`;
  const taskSegment = task ? ` │ \x1b[1m${task}\x1b[0m` : '';
  const dirSegment = ` │ \x1b[2m${dirname}\x1b[0m`;
  return `${head}${taskSegment}${dirSegment}${ctx}${cacheBadge}${thinkingBadge}`;
}

// ─── Stdin driver ───────────────────────────────────────────────────────────

if (require.main === module) {
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => input += chunk);
  process.stdin.on('end', () => {
    try {
      const data = JSON.parse(input);
      process.stdout.write(buildStatuslineOutput(data));
    } catch {
      // Silent fail — don't break statusline on parse errors.
    }
  });
}

module.exports = { buildStatuslineOutput };
