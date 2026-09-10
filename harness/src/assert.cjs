'use strict';

/**
 * Assertion evaluator for harness steps (ADR-0047 D4).
 *
 * Pure: takes the step's observed outcome and the workspace path, returns a list
 * of failures (empty = pass). Every kind here has a both-direction unit test in
 * tests/harness.test.cjs — a check that has never been shown to fail is a false
 * pass waiting to be believed, which is how PanLoop came to withdraw four of its
 * own claims.
 *
 * Kinds:
 *   exit:<n>              process exit code
 *   file:<rel>            path exists (file or dir) inside the workspace
 *   absent:<rel>          path does not exist
 *   glob:<pattern>        at least one match for a simple glob (* and ** over /)
 *   count:<pattern>=<n>   exactly n matches
 *   json:<path>           stdout parses as JSON and the dotted path exists
 *   json:<path>=<value>   … and equals value (string compare of JSON-ish scalars)
 *   json!:<path>          stdout parses as JSON and the dotted path is ABSENT
 *   stdout~<regex>        stdout matches
 *   stderr~<regex>        stderr matches
 *   rpc:<id>.<path>=<value>   for mcp steps: the response with that id has path == value
 *   rpc:<id>.<path>       … the path exists
 */

const fs = require('fs');
const path = require('path');

function getPath(obj, dotted) {
  let cur = obj;
  for (const seg of dotted.split('.')) {
    if (cur === null || cur === undefined) return { found: false };
    const key = /^\d+$/.test(seg) && Array.isArray(cur) ? Number(seg) : seg;
    if (!(key in Object(cur))) return { found: false };
    cur = cur[key];
  }
  return { found: true, value: cur };
}

function scalarEquals(actual, expected) {
  if (actual === null || actual === undefined) return String(actual) === expected;
  if (typeof actual === 'object') return JSON.stringify(actual) === expected;
  return String(actual) === expected;
}

/** Minimal glob → regex: `**` any depth, `*` within a segment, `?` one char. Always posix separators. */
function globToRegExp(pattern) {
  let re = '';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '*') {
      if (pattern[i + 1] === '*') { re += '.*'; i++; if (pattern[i + 1] === '/') i++; }
      else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp('^' + re + '$');
}

function walk(dir, base = dir, acc = []) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return acc; }
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name === '.git') continue;
    const p = path.join(dir, e.name);
    acc.push(path.relative(base, p).split(path.sep).join('/'));
    if (e.isDirectory()) walk(p, base, acc);
  }
  return acc;
}

function globMatches(workspace, pattern) {
  const re = globToRegExp(pattern);
  return walk(workspace).filter(rel => re.test(rel));
}

/**
 * @param {string} expectation - one assertion string
 * @param {{code?:number, stdout?:string, stderr?:string, responses?:object[]}} outcome
 * @param {string} workspace - absolute path
 * @returns {string|null} failure message, or null when the assertion holds
 */
function checkOne(expectation, outcome, workspace) {
  const o = outcome || {};
  let m;
  if ((m = expectation.match(/^exit:(-?\d+)$/))) {
    return Number(o.code) === Number(m[1]) ? null : `exit code ${o.code}, expected ${m[1]}`;
  }
  if ((m = expectation.match(/^file:(.+)$/))) {
    return fs.existsSync(path.join(workspace, m[1])) ? null : `missing: ${m[1]}`;
  }
  if ((m = expectation.match(/^absent:(.+)$/))) {
    return fs.existsSync(path.join(workspace, m[1])) ? `present but expected absent: ${m[1]}` : null;
  }
  if ((m = expectation.match(/^glob:(.+)$/))) {
    return globMatches(workspace, m[1]).length > 0 ? null : `no match for glob ${m[1]}`;
  }
  if ((m = expectation.match(/^count:(.+)=(\d+)$/))) {
    const n = globMatches(workspace, m[1]).length;
    return n === Number(m[2]) ? null : `${n} match(es) for ${m[1]}, expected ${m[2]}`;
  }
  if ((m = expectation.match(/^json!:(.+)$/))) {
    let parsed;
    try { parsed = JSON.parse(String(o.stdout || '').trim()); } catch { return `stdout is not JSON (needed for ${expectation})`; }
    return getPath(parsed, m[1]).found ? `json path ${m[1]} present but expected absent` : null;
  }
  if ((m = expectation.match(/^json:([^=]+)(?:=(.*))?$/))) {
    let parsed;
    try { parsed = JSON.parse(String(o.stdout || '').trim()); } catch { return `stdout is not JSON (needed for ${expectation})`; }
    const got = getPath(parsed, m[1]);
    if (!got.found) return `json path ${m[1]} absent`;
    if (m[2] !== undefined && !scalarEquals(got.value, m[2])) return `json ${m[1]} = ${JSON.stringify(got.value)}, expected ${m[2]}`;
    return null;
  }
  if ((m = expectation.match(/^stdout~(.+)$/))) {
    return new RegExp(m[1]).test(String(o.stdout || '')) ? null : `stdout does not match /${m[1]}/`;
  }
  if ((m = expectation.match(/^stderr~(.+)$/))) {
    return new RegExp(m[1]).test(String(o.stderr || '')) ? null : `stderr does not match /${m[1]}/`;
  }
  if ((m = expectation.match(/^rpc:([^.]+)\.([^=]+)(?:=(.*))?$/))) {
    const id = /^\d+$/.test(m[1]) ? Number(m[1]) : m[1];
    const resp = (o.responses || []).find(r => r && r.id === id);
    if (!resp) return `no rpc response with id ${m[1]}`;
    const got = getPath(resp, m[2]);
    if (!got.found) return `rpc ${m[1]}: path ${m[2]} absent`;
    if (m[3] !== undefined && !scalarEquals(got.value, m[3])) return `rpc ${m[1]}.${m[2]} = ${JSON.stringify(got.value)}, expected ${m[3]}`;
    return null;
  }
  return `unknown assertion kind: ${expectation}`;
}

/** Evaluate every expectation; returns [{ expect, failure }] for the ones that failed. */
function check(expectations, outcome, workspace) {
  const failures = [];
  for (const e of expectations || []) {
    const failure = checkOne(e, outcome, workspace);
    if (failure) failures.push({ expect: e, failure });
  }
  return failures;
}

module.exports = { check, checkOne, getPath, globToRegExp, globMatches };
