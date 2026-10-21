'use strict';
/**
 * Requirements with EARS criteria, a requirements lint and a truth→test trace matrix
 * (program V8).
 *
 * A v1 requirement (a checkbox line `- [ ] **ID**: …`) carries its acceptance criteria
 * as indented sub-bullets in an EARS form, and the tests that check them as `Test:`
 * sub-bullets:
 *
 *   - [ ] **AUTH-01**: User can sign in
 *     - WHEN a user submits a correct email and password THE SYSTEM SHALL start a session
 *     - Test: tests/auth.test.js
 *
 * `verify requirements` fails a v1 requirement with no criterion (`req_no_scenario`).
 * `verify traceability` maps each requirement to its tests and runs them: `passed`, `failing`,
 * or `not_checked` when a truth has no test (an untested truth is never read as met).
 * `phase complete` ticks a requirement that has criteria only when its trace passes; a
 * legacy requirement with no criteria keeps the old tick, so existing projects work.
 */
const fs = require('fs');
const path = require('path');
const { output, toLf } = require('./core.cjs');
const { planningPath } = require('./utils.cjs');
const { REQUIREMENTS_FILE } = require('./constants.cjs');
const TG = require('./test-gate.cjs');

// EARS forms: ubiquitous (THE <system> SHALL), event (WHEN … SHALL), state (WHILE …),
// optional feature (WHERE …), unwanted behaviour (IF … THEN … SHALL).
const EARS_RE = /^(?:(?:WHEN|WHILE|WHERE)\b[\s\S]*\bSHALL\b|IF\b[\s\S]*\bTHEN\b[\s\S]*\bSHALL\b|THE\s+\S[\s\S]*\bSHALL\b)/i;
const REQ_RE = /^- (\[[ xX]\] )?\*\*([A-Z][A-Z0-9]*-\d+)\*\*:?\s*(.*)$/;
const DEFAULT_TEST_TIMEOUT_MS = 3 * 60 * 1000;

const isEars = (s) => EARS_RE.test(String(s || '').trim());

/** The requirements in a requirements.md, with criteria and mapped tests. */
function parseRequirements(raw) {
  const lines = toLf(String(raw || '')).split('\n');
  const out = [];
  let cur = null;
  for (const line of lines) {
    const m = REQ_RE.exec(line);
    if (m) {
      cur = { id: m[2], v1: !!m[1], checked: !!m[1] && /x/i.test(m[1]), text: m[3].trim(), criteria: [], tests: [] };
      out.push(cur);
      continue;
    }
    if (!cur) continue;
    const sub = /^\s{2,}- (.*)$/.exec(line);
    if (!sub) { if (line.trim() !== '') cur = null; continue; }
    const body = sub[1].trim();
    const t = /^tests?:\s*(.+)$/i.exec(body);
    if (t) { for (const p of t[1].split(',')) { const file = p.trim().replace(/`/g, '').split('#')[0].trim(); if (file) cur.tests.push(file); } continue; }
    if (isEars(body)) cur.criteria.push(body);
  }
  return out;
}

function readRequirements(cwd) {
  try { return fs.readFileSync(path.join(planningPath(cwd), REQUIREMENTS_FILE), 'utf-8'); } catch { return null; }
}

function lintRequirements(cwd) {
  const text = readRequirements(cwd);
  if (text === null) return { error: 'requirements_not_found', reason: '.planning/requirements.md is missing' };
  const reqs = parseRequirements(text).filter((r) => r.v1);
  const errors = reqs.filter((r) => r.criteria.length === 0).map((r) => ({ code: 'req_no_scenario', id: r.id, detail: 'no acceptance criterion in an EARS form (WHEN/WHILE/WHERE/IF … THE SYSTEM SHALL …)' }));
  return { ok: errors.length === 0, requirements: reqs.map((r) => ({ id: r.id, criteria: r.criteria.length, tests: r.tests.length })), errors };
}

/** Run a requirement's mapped tests: passed | failing | not_checked | legacy. Pure over the cache. */
function traceOf(cwd, req, cache, opts = {}) {
  if (req.criteria.length === 0) return { id: req.id, status: 'legacy', tests: req.tests };
  if (req.tests.length === 0) return { id: req.id, status: 'not_checked', tests: [], detail: 'no test is mapped to this requirement' };
  const results = [];
  for (const file of req.tests) {
    if (!cache.has(file)) {
      if (!fs.existsSync(path.join(cwd, file))) cache.set(file, { file, result: 'missing' });
      else {
        const fc = TG.fileCommand(cwd, file);
        if (!fc.command) cache.set(file, { file, result: 'not_checked', detail: fc.reason });
        else cache.set(file, { file, result: TG.runCommand(cwd, fc.command, opts.timeoutMs || DEFAULT_TEST_TIMEOUT_MS).exit === 0 ? 'passed' : 'failing' });
      }
    }
    results.push(cache.get(file));
  }
  const status = results.some((r) => r.result === 'failing' || r.result === 'missing') ? 'failing'
    : results.every((r) => r.result === 'passed') ? 'passed' : 'not_checked';
  return { id: req.id, status, tests: results };
}

function traceMatrix(cwd, opts = {}) {
  const text = readRequirements(cwd);
  if (text === null) return { error: 'requirements_not_found', reason: '.planning/requirements.md is missing' };
  let reqs = parseRequirements(text).filter((r) => r.v1);
  if (opts.ids && opts.ids.length) reqs = reqs.filter((r) => opts.ids.includes(r.id));
  const cache = new Map();
  const requirements = reqs.map((r) => traceOf(cwd, r, cache, opts));
  const count = (s) => requirements.filter((r) => r.status === s).length;
  return { requirements, passed: count('passed'), failing: count('failing'), not_checked: count('not_checked'), legacy: count('legacy') };
}

/** Whether `phase complete` may tick each id. Legacy requirements may; the rest need a passing trace. */
function tickDecisions(cwd, ids) {
  const text = readRequirements(cwd);
  if (text === null) return new Map(ids.map((id) => [id, { allowed: true, status: 'unknown' }]));
  const byId = new Map(parseRequirements(text).map((r) => [r.id, r]));
  const cache = new Map();
  const out = new Map();
  for (const id of ids) {
    const r = byId.get(id);
    if (!r) { out.set(id, { allowed: true, status: 'unknown' }); continue; }
    const t = traceOf(cwd, r, cache);
    out.set(id, { allowed: t.status === 'legacy' || t.status === 'passed', status: t.status });
  }
  return out;
}

function cmdVerifyRequirements(cwd, raw) {
  const r = lintRequirements(cwd);
  if (r.error) { output(r, raw, 'error', 1); return; }
  output(r, raw, r.ok ? 'valid' : 'invalid', r.ok ? 0 : 1);
}

function cmdVerifyTrace(cwd, ids, raw) {
  const r = traceMatrix(cwd, { ids });
  if (r.error) { output(r, raw, 'error', 1); return; }
  output(r, raw, r.failing ? 'failing' : (r.not_checked ? 'not_checked' : 'passed'), r.failing ? 1 : 0);
}

module.exports = { isEars, parseRequirements, lintRequirements, traceMatrix, tickDecisions, cmdVerifyRequirements, cmdVerifyTrace };
