#!/usr/bin/env node
// Context Monitor - PostToolUse hook
// Reads context metrics from the statusline bridge file and injects
// warnings when context usage is high. This makes the AGENT aware of
// context limits (the statusline only shows the user).
//
// How it works:
// 1. The statusline hook writes metrics to /tmp/claude-ctx-{session_id}.json
// 2. This hook reads those metrics after each tool use
// 3. When remaining context drops below thresholds, it injects a warning
//    as additionalContext, which the agent sees in its conversation
//
// Thresholds:
//   WARNING  (remaining <= 35%): Agent should wrap up current task
//   CRITICAL (remaining <= 25%): Agent should stop immediately and save state
//
// Debounce: 5 tool uses between warnings to avoid spam
// Severity escalation bypasses debounce (WARNING -> CRITICAL fires immediately)

const fs = require('fs');
const os = require('os');
const path = require('path');

// Per-user bridge directory inside tmpdir, created 0700 so another user on a
// shared host can't pre-plant a symlink at a predictable session path or read
// the bridge files. Both hooks derive the same dir from the same uid, so the
// statusline→context-monitor IPC channel is preserved.
function bridgeDir() {
  const uid = (typeof process.getuid === 'function' ? process.getuid() : process.env.USERNAME || 'win');
  const dir = path.join(os.tmpdir(), `pan-hooks-${uid}`);
  try { fs.mkdirSync(dir, { recursive: true, mode: 0o700 }); } catch { /* best-effort */ }
  return dir;
}

const WARNING_THRESHOLD = 35;  // remaining_percentage <= 35%
const CRITICAL_THRESHOLD = 25; // remaining_percentage <= 25%
const STALE_SECONDS = 60;      // ignore metrics older than 60s
const DEBOUNCE_CALLS = 5;      // min tool uses between warnings

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => input += chunk);
process.stdin.on('end', () => {
  try {
    const data = JSON.parse(input);
    const sessionId = data.session_id;

    if (!sessionId) {
      process.exit(0);
    }

    const tmpDir = bridgeDir();
    const metricsPath = path.join(tmpDir, `claude-ctx-${sessionId}.json`);

    // Read metrics directly; absence (subagent/fresh session) or a corrupt
    // file just means "nothing to warn about" — exit silently. No
    // existsSync-then-read gap.
    let metrics;
    try {
      metrics = JSON.parse(fs.readFileSync(metricsPath, 'utf8'));
    } catch {
      process.exit(0);
    }
    const now = Math.floor(Date.now() / 1000);

    // Ignore stale metrics
    if (metrics.timestamp && (now - metrics.timestamp) > STALE_SECONDS) {
      process.exit(0);
    }

    const remaining = metrics.remaining_percentage;
    const usedPct = metrics.used_pct;

    // No warning needed
    if (remaining > WARNING_THRESHOLD) {
      process.exit(0);
    }

    // Debounce: check if we warned recently
    const warnPath = path.join(tmpDir, `claude-ctx-${sessionId}-warned.json`);
    let warnData = { callsSinceWarn: 0, lastLevel: null };
    let firstWarn = true;

    try {
      warnData = JSON.parse(fs.readFileSync(warnPath, 'utf8'));
      firstWarn = false;
    } catch {
      // No prior warning file (or corrupted) — treat as first warning.
    }

    warnData.callsSinceWarn = (warnData.callsSinceWarn || 0) + 1;

    const isCritical = remaining <= CRITICAL_THRESHOLD;
    const currentLevel = isCritical ? 'critical' : 'warning';

    // Emit immediately on first warning, then debounce subsequent ones
    // Severity escalation (WARNING -> CRITICAL) bypasses debounce
    const severityEscalated = currentLevel === 'critical' && warnData.lastLevel === 'warning';
    if (!firstWarn && warnData.callsSinceWarn < DEBOUNCE_CALLS && !severityEscalated) {
      // Update counter and exit without warning
      fs.writeFileSync(warnPath, JSON.stringify(warnData));
      process.exit(0);
    }

    // Reset debounce counter
    warnData.callsSinceWarn = 0;
    warnData.lastLevel = currentLevel;
    fs.writeFileSync(warnPath, JSON.stringify(warnData));

    // Build warning message
    let message;
    if (isCritical) {
      message = `CONTEXT MONITOR CRITICAL: Usage at ${usedPct}%. Remaining: ${remaining}%. ` +
        'STOP new work immediately. Save state NOW and inform the user that context is nearly exhausted. ' +
        'If using PAN, run /pan:pause to save execution state.';
    } else {
      message = `CONTEXT MONITOR WARNING: Usage at ${usedPct}%. Remaining: ${remaining}%. ` +
        'Begin wrapping up current task. Do not start new complex work. ' +
        'If using PAN, consider /pan:pause to save state.';
    }

    const output = {
      hookSpecificOutput: {
        hookEventName: "PostToolUse",
        additionalContext: message
      }
    };

    process.stdout.write(JSON.stringify(output));
  } catch (e) {
    // Silent fail -- never block tool execution
    process.exit(0);
  }
});
