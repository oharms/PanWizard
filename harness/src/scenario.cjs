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
const { MODEL_RUNTIMES } = require('./model.cjs');

const STEP_KINDS = new Set(['pan', 'sh', 'mcp', 'model', 'user', 'fs', 'build', 'cli']);
const ASSERTION_RE = /^(exit:-?\d+|file:.+|absent:.+|glob:.+|count:.+=\d+|json:[^=]+(=.*)?|json!:.+|stdout~.+|stderr~.+|rpc:[^.]+\.[^=]+(=.*)?|wire:(system|tools|url|body)~.+|wire-count:(system|tools|url|body)~.+=\d+|drift:.+)$/;

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
    // A double-backed model step (H1) reaches no real model and spends nothing: tier 0.
    if (st.kind === 'model' && s.tier === 0 && !st.double) err(`${at}: a model step cannot live in a tier-0 scenario`);
    if (st.kind === 'user' && s.tier === 0 && !st.double) err(`${at}: a user step in a tier-0 scenario needs a double`);
    if (st.double !== undefined) {
      // H1 script, or H2 cassette replay, optionally carrying the synthetic recipe `--record`
      // re-records it from. A recording from a real model is never a scenario step: it spends.
      const d = st.double && typeof st.double === 'object' ? st.double : {};
      const goodScript = (sc) => sc && Array.isArray(sc.rules) && sc.rules.every((r) => r && typeof r === 'object' && Array.isArray(r.turns));
      if (st.kind !== 'model' && st.kind !== 'user') err(`${at}: double is only for model and user steps`);
      else if (d.script !== undefined && d.cassette !== undefined) err(`${at}: double takes either a script or a cassette, not both`);
      else if (d.record !== undefined && d.record && d.record.upstream !== undefined) err(`${at}: double.record.upstream records from a real model (paid, API key) — not a scenario step`);
      else if (d.record !== undefined && typeof d.cassette !== 'string') err(`${at}: double.record needs a cassette to write`);
      else if (d.record !== undefined && !goodScript(d.record && d.record.script)) err(`${at}: double.record needs {script: {rules: [{when, turns: [...]}]}}`);
      else if (d.cassette === undefined && !goodScript(d.script)) err(`${at}: double needs {script: {rules: [{when, turns: [...]}]}} or {cassette} on a model step`);
      else if (d.cassette !== undefined && typeof d.cassette !== 'string') err(`${at}: double.cassette must be a path`);
    }
    if (st.kind === 'pan' && !Array.isArray(st.argv)) err(`${at}: pan steps need argv[]`);
    if (st.kind === 'mcp' && !Array.isArray(st.requests)) err(`${at}: mcp steps need requests[]`);
    if (st.kind === 'model' && typeof st.prompt !== 'string') err(`${at}: model steps need a prompt`);
    // H9: a scripted user answers the session before it, by pattern over its last reply,
    // and resumes it. The session it resumes starts at a model step that kept it.
    if (st.kind === 'user') {
      const prev = s.steps[i - 1];
      if (!prev || !['model', 'user'].includes(prev.kind)) err(`${at}: a user step must follow a model or user step`);
      let k = i - 1;
      while (k >= 0 && s.steps[k] && s.steps[k].kind === 'user') k--;
      if (k >= 0 && s.steps[k] && s.steps[k].kind === 'model' && s.steps[k].persistSession !== true) err(`${at}: the model step a user step answers needs persistSession: true`);
      if (!Array.isArray(st.answers) || st.answers.length === 0) err(`${at}: user steps need answers: [{match, reply}]`);
      else for (const a of st.answers) {
        if (!a || typeof a.match !== 'string' || typeof a.reply !== 'string' || !a.reply) { err(`${at}: each answer needs a match pattern and a reply`); continue; }
        try { new RegExp(a.match, 'i'); } catch { err(`${at}: "${a.match}" is not a valid pattern`); }
      }
    }
    // `runtime` picks the host CLI a model step drives (default claude; MI-104), and the
    // installed runtime directory a pan or mcp step runs against (run.cjs honours both).
    if (st.runtime !== undefined && (!['model', 'pan', 'mcp'].includes(st.kind) || !Object.prototype.hasOwnProperty.call(MODEL_RUNTIMES, st.runtime))) {
      err(`${at}: runtime is only for model, pan and mcp steps, one of ${Object.keys(MODEL_RUNTIMES).join(', ')}`);
    }
    if (st.kind === 'build' && !/^[a-z-]+\.js$/.test(String(st.script || ''))) err(`${at}: build steps need a scripts/<name>.js`);
    if (st.kind === 'sh' && !/^[a-z-]+\.cjs$/.test(String(st.script || ''))) err(`${at}: sh steps need a harness/scripts/<name>.cjs`);
    if (st.kind === 'cli' && !/^[a-z][a-z0-9-]*$/.test(String(st.bin || ''))) err(`${at}: cli steps need a bare bin name`);
    // `paid: true` marks a cli step that spends another CLI's model credits (running a
    // Copilot custom agent, say). It counts as the scenario's model step and, like one,
    // may not live in tier 0 — tier 0 is the free tier.
    if (st.paid !== undefined && (st.kind !== 'cli' || st.paid !== true)) err(`${at}: paid is only \`true\`, and only on cli steps`);
    if (st.paid === true && s.tier === 0) err(`${at}: a paid cli step cannot live in a tier-0 scenario`);
    // `env` gives a cli step's child extra variables (placeholders filled), e.g. a scratch
    // GEMINI_CLI_HOME so the CLI never touches the user's real home.
    if (st.env !== undefined) {
      const ok = st.kind === 'cli' && st.env && typeof st.env === 'object' && !Array.isArray(st.env)
        && Object.entries(st.env).every(([k, v]) => /^[A-Z_][A-Z0-9_]*$/.test(k) && typeof v === 'string');
      if (!ok) err(`${at}: env is only for cli steps, as {"NAME": "value"} with upper-case names and string values`);
    }
    // `persistSession: true` lets a model step's host write transcripts (see model.cjs).
    if (st.persistSession !== undefined && (st.kind !== 'model' || st.persistSession !== true)) err(`${at}: persistSession is only \`true\`, and only on model steps`);
  });
  if (s.tier >= 1 && !s.steps.some(st => (st.kind === 'model' && !st.double) || st.paid === true)) err('a tier ≥1 scenario should contain a model step or a paid cli step (else it is tier 0)');
  // Controls (H5): a tier-0 scenario declares at least one sabotage that must turn it
  // red, so a scenario whose assertions measure nothing cannot stay in the suite.
  if (s.controls !== undefined && !Array.isArray(s.controls)) err('controls must be an array');
  const controls = Array.isArray(s.controls) ? s.controls : [];
  if (s.tier === 0 && controls.length === 0) err('a tier-0 scenario needs controls: at least one sabotage that must turn it red');
  // Arms (H3, M43) are variants of the scenario, measured rather than expected to fail:
  // a no-guidance baseline, a deletion arm. Same shape and rules as a control.
  if (s.arms !== undefined && !Array.isArray(s.arms)) err('arms must be an array');
  for (const [field, list] of [['controls', controls], ['arms', Array.isArray(s.arms) ? s.arms : []]]) {
  const seen = new Set();
  list.forEach((c, i) => {
    const at = `${field}[${i}]`;
    if (!c || typeof c !== 'object') { err(`${at}: not an object`); return; }
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(String(c.id || ''))) err(`${at}: id must be kebab-case`);
    else if (seen.has(c.id)) err(`${at}: duplicate id "${c.id}"`); else seen.add(c.id);
    if (typeof c.why !== 'string' || !c.why.trim()) err(`${at}: why required`);
    if (c.after !== undefined && !(Number.isInteger(c.after) && c.after >= -1 && c.after < s.steps.length - 1)) err(`${at}: after must be -1 or the index of a step before the last`);
    const ops = ['delete', 'write', 'replace'].filter((k) => c[k] !== undefined);
    if (ops.length !== 1) err(`${at}: exactly one of delete, write, replace`);
    const badPath = (p) => typeof p !== 'string' || !p || p.split(/[\\/]/).includes('..') || (/^[A-Za-z]:|^\//.test(p) && !/^<(ws|other)>/.test(p));
    if (c.delete !== undefined && badPath(c.delete)) err(`${at}: delete needs a workspace-relative path`);
    if (c.write !== undefined && (badPath(c.write && c.write.path) || typeof (c.write && c.write.content) !== 'string')) err(`${at}: write needs {path, content}`);
    if (c.replace !== undefined && (badPath(c.replace && c.replace.path) || typeof (c.replace && c.replace.find) !== 'string' || !c.replace.find || typeof c.replace.with !== 'string')) err(`${at}: replace needs {path, find, with}`);
  });
  }
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
