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
//
// The decision logic lives in the pure, exported buildContextWarning() so it is
// unit-tested (tests/context-monitor-hook.test.cjs) rather than only reachable
// via stdin (M59, ADR audit 2026-08).

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

// Pure decision function (exported for tests).
//
//   metrics    — { remaining_percentage, used_pct?, timestamp? } from the bridge
//   warnState  — { callsSinceWarn, lastLevel } from the prior warn file, or null
//                on the first warning (no file yet / corrupt file)
//   nowSeconds — current unix time in seconds
//
// Returns one of:
//   { action: 'exit' }                                   — nothing to do
//   { action: 'debounce', warnState }                    — persist counter, no warn
//   { action: 'emit', level, warnState, message }        — persist + emit warning
function buildContextWarning(metrics, warnState, nowSeconds) {
  if (!metrics || typeof metrics !== 'object') return { action: 'exit' };

  // Ignore stale metrics (statusline stopped updating — e.g. session ended).
  if (metrics.timestamp != null && (nowSeconds - metrics.timestamp) > STALE_SECONDS) {
    return { action: 'exit' };
  }

  const remaining = Number(metrics.remaining_percentage);
  if (!Number.isFinite(remaining)) return { action: 'exit' };

  // No warning needed
  if (remaining > WARNING_THRESHOLD) return { action: 'exit' };

  const firstWarn = warnState == null || typeof warnState !== 'object';
  const prev = firstWarn ? { callsSinceWarn: 0, lastLevel: null } : warnState;
  const callsSinceWarn = (prev.callsSinceWarn || 0) + 1;

  const isCritical = remaining <= CRITICAL_THRESHOLD;
  const currentLevel = isCritical ? 'critical' : 'warning';

  // Emit immediately on first warning, then debounce subsequent ones.
  // Severity escalation (WARNING -> CRITICAL) bypasses debounce.
  const severityEscalated = currentLevel === 'critical' && prev.lastLevel === 'warning';
  if (!firstWarn && callsSinceWarn < DEBOUNCE_CALLS && !severityEscalated) {
    // Bump the counter but leave lastLevel untouched, then exit without warning.
    return {
      action: 'debounce',
      warnState: { callsSinceWarn, lastLevel: prev.lastLevel || null },
    };
  }

  // L39: report Usage and Remaining on the SAME scale so they are internally
  // consistent (sum to 100). The bridge's used_pct is the statusline's
  // 80%-rescaled figure (80% real usage displays as 100%); pairing it with the
  // raw remaining produced self-contradictory numbers like
  // "Usage at 94%. Remaining: 25%". Derive used from remaining instead.
  const rem = Math.round(remaining);
  const used = 100 - rem;

  let message;
  if (isCritical) {
    message = `CONTEXT MONITOR CRITICAL: Usage at ${used}%. Remaining: ${rem}%. ` +
      'STOP new work immediately. Save state NOW and inform the user that context is nearly exhausted. ' +
      'If using PAN, run /pan:pause to save execution state.';
  } else {
    message = `CONTEXT MONITOR WARNING: Usage at ${used}%. Remaining: ${rem}%. ` +
      'Begin wrapping up current task. Do not start new complex work. ' +
      'If using PAN, consider /pan:pause to save state.';
  }

  return {
    action: 'emit',
    level: currentLevel,
    warnState: { callsSinceWarn: 0, lastLevel: currentLevel },
    message,
  };
}

function main() {
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

      // Load prior warn state (null when no file / corrupt → treated as first warn).
      const warnPath = path.join(tmpDir, `claude-ctx-${sessionId}-warned.json`);
      let warnData = null;
      try {
        warnData = JSON.parse(fs.readFileSync(warnPath, 'utf8'));
      } catch {
        warnData = null;
      }

      const decision = buildContextWarning(metrics, warnData, now);

      if (decision.action === 'exit') {
        process.exit(0);
      }

      if (decision.action === 'debounce') {
        fs.writeFileSync(warnPath, JSON.stringify(decision.warnState));
        process.exit(0);
      }

      // action === 'emit'
      fs.writeFileSync(warnPath, JSON.stringify(decision.warnState));

      const output = {
        hookSpecificOutput: {
          hookEventName: "PostToolUse",
          additionalContext: decision.message
        }
      };

      process.stdout.write(JSON.stringify(output));
    } catch (e) {
      // Silent fail -- never block tool execution
      process.exit(0);
    }
  });
}

if (require.main === module) {
  main();
}

module.exports = {
  buildContextWarning,
  bridgeDir,
  WARNING_THRESHOLD,
  CRITICAL_THRESHOLD,
  STALE_SECONDS,
  DEBOUNCE_CALLS,
};
