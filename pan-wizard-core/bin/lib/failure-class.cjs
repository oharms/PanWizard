'use strict';
/**
 * The failure-class router (program A4).
 *
 * When an autodev unit fails, what to do next depends on why. classifyFailure reads the
 * exit, the output tail and whether it timed out; routeFailure gives the class's policy
 * for this attempt. Breadth before depth (Olausson et al.): a cheap retry with the error
 * in front of the model comes before a tier escalation, and anything a model cannot fix
 * (a missing CLI or login, a merge conflict, the guard's deny, an undeclared file) goes
 * to a human.
 *
 *   retry_with_tail  rerun the unit with the error tail in the prompt
 *   fresh_restart    rerun the unit as it was
 *   escalate_tier    rerun it at the next model tier (core.cjs escalateTier)
 *   quarantine       record it as a flake and go on
 *   ask              stop: human_needed
 *   stop_budget      stop: budget_usd
 */

const { escalateTier } = require('./core.cjs');

const FAILURE_CLASSES = Object.freeze(['compile', 'assertion', 'timeout', 'flake', 'missing_env', 'merge_conflict', 'integrity_violation', 'scope_violation', 'budget', 'unknown']);

// First match wins: the specific, unfixable classes are checked before the generic ones.
const PATTERNS = [
  ['budget', /max-budget-usd|credit balance|usage limit|rate limit|quota exceeded|budget exceeded/i],
  ['missing_env', /is not recognized as an internal or external command|command not found|ENOENT|invalid api key|not logged in|please run \/login|authenticat(e|ion) (failed|required)|missing (an )?api key/i],
  ['integrity_violation', /PAN guard:|integrity (check|violation)|hash mismatch|tamper/i],
  ['merge_conflict', /CONFLICT \(|merge conflict|Automatic merge failed/i],
  ['scope_violation', /scope violation|undeclared (file|test)|not declared by any plan|outside the plan/i],
  ['timeout', /ETIMEDOUT|timed out|timeout of \d+/i],
  ['compile', /error TS\d+|SyntaxError|ReferenceError|Cannot find (module|name)|compilation failed|failed to compile|cannot compile/i],
  ['assertion', /AssertionError|assert\w*\.\w+|expected .{1,80} (to|but)|\btests? failed\b|\d+ failing\b|^not ok /im],
];

/**
 * @param {{exit?: number|null, stderr?: string, stdout?: string, timedOut?: boolean, flaky?: boolean}} f
 * @returns {string} one of FAILURE_CLASSES
 */
function classifyFailure(f = {}) {
  if (f.flaky) return 'flake';
  if (f.timedOut) return 'timeout';
  const text = `${f.stderr || ''}\n${f.stdout || ''}`;
  for (const [cls, re] of PATTERNS) if (re.test(text)) return cls;
  if (f.exit === 127) return 'missing_env';
  return 'unknown';
}

const POLICIES = {
  compile: ['retry_with_tail', 'escalate_tier'],
  assertion: ['retry_with_tail', 'escalate_tier'],
  timeout: ['fresh_restart'],
  flake: ['quarantine'],
  missing_env: [],
  merge_conflict: [],
  integrity_violation: [],
  scope_violation: [],
  budget: ['stop_budget'],
  unknown: ['fresh_restart'],
};

/**
 * The policy for the `attempt`th failure of a unit (1 = its first failure).
 * @returns {{action: string, tier?: string}}
 */
function routeFailure(cls, attempt = 1) {
  const ladder = POLICIES[cls] || POLICIES.unknown;
  if (cls === 'flake') return { action: 'quarantine' };
  if (cls === 'budget') return { action: 'stop_budget' };
  const action = ladder[attempt - 1] || 'ask';
  if (action === 'escalate_tier') return { action, tier: escalateTier('mid', attempt).tier };
  return { action };
}

/** The last lines of a failure's output, for the retry prompt (one line, shell-safe). */
function errorTail(f = {}, max = 300) {
  const text = `${f.stderr || ''}\n${f.stdout || ''}`.trim().split(/\r?\n/).filter(Boolean).slice(-4).join(' / ');
  return text.replace(/[\r\n&|<>%^"]/g, ' ').replace(/\s+/g, ' ').slice(-max).trim();
}

module.exports = { FAILURE_CLASSES, classifyFailure, routeFailure, errorTail, POLICIES };
