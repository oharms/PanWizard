'use strict';

/**
 * Scenario loading and validation (ADR-0047 D4). Pure except for the directory read.
 *
 * A scenario that does not validate is refused before anything runs — a malformed
 * `expect` would otherwise pass vacuously, and a step without a `why` cannot be
 * read as a finding six months later.
 */

const fs = require('fs');
const path = require('path');

const STEP_KINDS = new Set(['pan', 'sh', 'mcp', 'model', 'fs', 'build', 'cli']);
const ASSERTION_RE = /^(exit:-?\d+|file:.+|absent:.+|glob:.+|count:.+=\d+|json:[^=]+(=.*)?|json!:.+|stdout~.+|stderr~.+|rpc:[^.]+\.[^=]+(=.*)?)$/;

function validateScenario(s, fileName = '<inline>') {
  const errors = [];
  const err = (m) => errors.push(`${fileName}: ${m}`);
  if (!s || typeof s !== 'object') return [`${fileName}: not an object`];
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(String(s.id || ''))) err('id must be kebab-case');
  if (![0, 1, 2].includes(s.tier)) err('tier must be 0, 1 or 2');
  if (typeof s.description !== 'string' || !s.description.trim()) err('description required');
  if (typeof s.why !== 'string' || !s.why.trim()) err('why required');
  if (s.seed !== undefined && (typeof s.seed !== 'string' || !s.seed)) err('seed must be a name or "empty"');
  if (s.install !== null && s.install !== undefined) {
    if (!Array.isArray(s.install) || !s.install.every(f => /^--[a-z-]+$/.test(f))) err('install must be null or an array of installer flags');
  }
  if (s.requires !== undefined && s.requires !== null) {
    if (typeof s.requires !== 'object' || (s.requires.cli !== undefined && !/^[a-z][a-z0-9-]*$/.test(s.requires.cli))) err('requires.cli must be a bare command name');
    if (s.requires && s.requires.minVersion !== undefined) {
      if (!/^\d+(\.\d+)*$/.test(String(s.requires.minVersion))) err('requires.minVersion must be a dotted version like 2.1.261');
      if (!s.requires.cli) err('requires.minVersion needs requires.cli');
    }
  }
  const b = s.budget || {};
  for (const k of ['maxUsd', 'maxMinutes', 'maxStepMinutes']) {
    if (b[k] !== undefined && !(typeof b[k] === 'number' && b[k] >= 0)) err(`budget.${k} must be a non-negative number`);
  }
  if (!Array.isArray(s.steps) || s.steps.length === 0) { err('steps must be a non-empty array'); return errors; }
  s.steps.forEach((st, i) => {
    const at = `steps[${i}]`;
    if (!st || typeof st !== 'object') { err(`${at}: not an object`); return; }
    if (!STEP_KINDS.has(st.kind)) err(`${at}: unknown kind "${st.kind}"`);
    if (typeof st.why !== 'string' || !st.why.trim()) err(`${at}: why required`);
    if (!Array.isArray(st.expect)) err(`${at}: expect must be an array`);
    else for (const e of st.expect) if (typeof e !== 'string' || !ASSERTION_RE.test(e)) err(`${at}: bad assertion "${e}"`);
    if (st.kind === 'model' && s.tier === 0) err(`${at}: a model step cannot live in a tier-0 scenario`);
    if (st.kind === 'pan' && !Array.isArray(st.argv)) err(`${at}: pan steps need argv[]`);
    if (st.kind === 'mcp' && !Array.isArray(st.requests)) err(`${at}: mcp steps need requests[]`);
    if (st.kind === 'model' && typeof st.prompt !== 'string') err(`${at}: model steps need a prompt`);
    if (st.kind === 'build' && !/^[a-z-]+\.js$/.test(String(st.script || ''))) err(`${at}: build steps need a scripts/<name>.js`);
    if (st.kind === 'sh' && !/^[a-z-]+\.cjs$/.test(String(st.script || ''))) err(`${at}: sh steps need a harness/scripts/<name>.cjs`);
    if (st.kind === 'cli' && !/^[a-z][a-z0-9-]*$/.test(String(st.bin || ''))) err(`${at}: cli steps need a bare bin name`);
  });
  if (s.tier >= 1 && !s.steps.some(st => st.kind === 'model')) err('a tier ≥1 scenario should contain a model step (else it is tier 0)');
  return errors;
}

function loadScenarios(dir) {
  const out = [];
  for (const f of fs.readdirSync(dir).filter(n => n.endsWith('.json')).sort()) {
    const s = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    const errors = validateScenario(s, f);
    if (errors.length) throw new Error(`invalid scenario:\n  ${errors.join('\n  ')}`);
    out.push(s);
  }
  return out;
}

module.exports = { validateScenario, loadScenarios, STEP_KINDS, ASSERTION_RE };
