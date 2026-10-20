#!/usr/bin/env node
'use strict';
/**
 * The prompt-rule registry (program H6).
 *
 * A normative line in a shipped prompt (MUST, NEVER, SHALL, always, never, do not) is a
 * rule. Each gets a stable id, `<file without .md>:<first 8 hex of sha1(text)>`, so it
 * moves with its text and not its line number. The registry, tests/fixtures/prompt-rules.json,
 * lists them. A harness scenario claims the rules it exercises with `covers: [ids]`.
 *
 *   --write   regenerate the registry. Rules already marked `baseline` keep the mark;
 *             with --baseline every rule gets it (how the registry was first created).
 *   --check   exit 1 when the registry is stale, when a rule that is neither baseline nor
 *             claimed has no reason in tests/fixtures/prompt-rules-allowlist.json, or when
 *             a scenario claims a rule that does not exist.
 *   --list    print the rules (id, file, text) as JSON.
 *
 * `harness run --prompt-mutant <id>` deletes one rule's line from the packed package
 * (applyMutant) and runs only the scenarios that cover it: a rule whose removal changes
 * nothing is decorative.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PROMPT_DIRS = ['agents', 'commands', 'pan-wizard-core/workflows', 'pan-wizard-core/references'];
const REGISTRY = 'tests/fixtures/prompt-rules.json';
const ALLOWLIST = 'tests/fixtures/prompt-rules-allowlist.json';
const NORMATIVE_RE = /\b(MUST|NEVER|SHALL|must not|never|always|Always|Never|[Dd]o not|[Dd]on't)\b/;

function normalise(line) {
  return line.trim().replace(/^(?:[-*+]|\d+\.)\s+/, '').replace(/^>\s*/, '').replace(/\s+/g, ' ').trim();
}

function listFiles(root) {
  const out = [];
  const walk = (rel) => {
    const abs = path.join(root, rel);
    if (!fs.existsSync(abs)) return;
    for (const e of fs.readdirSync(abs, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const r = `${rel}/${e.name}`;
      if (e.isDirectory()) walk(r); else if (e.name.endsWith('.md')) out.push(r);
    }
  };
  for (const d of PROMPT_DIRS) walk(d);
  return out;
}

/** The rules of one file's text. */
function rulesOf(file, text) {
  const rules = [];
  const seen = new Map();
  let fence = null;
  let frontmatter = false;
  text.replace(/\r\n/g, '\n').split('\n').forEach((line, i) => {
    if (i === 0 && line === '---') { frontmatter = true; return; }
    if (frontmatter) { if (line === '---') frontmatter = false; return; }
    const f = line.match(/^\s*(```+|~~~+)/);
    if (f) { if (!fence) fence = f[1]; else if (line.trim().startsWith(fence)) fence = null; return; }
    if (fence || !NORMATIVE_RE.test(line)) return;
    const t = normalise(line);
    if (t.length < 8 || /^\|/.test(t) || /^#/.test(t)) return;
    const base = `${file.replace(/\.md$/, '')}:${crypto.createHash('sha1').update(t).digest('hex').slice(0, 8)}`;
    const n = (seen.get(base) || 0) + 1;
    seen.set(base, n);
    rules.push({ id: n === 1 ? base : `${base}~${n}`, file, line: i + 1, text: t });
  });
  return rules;
}

function extractRules(root) {
  return listFiles(root).flatMap((f) => rulesOf(f, fs.readFileSync(path.join(root, f), 'utf8')));
}

function readJson(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; }
}

function loadScenarios(root) {
  const dir = path.join(root, 'harness', 'scenarios');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((n) => n.endsWith('.json')).sort().map((n) => readJson(path.join(dir, n), null)).filter(Boolean);
}

function coveringScenarios(scenarios, id) {
  return scenarios.filter((s) => Array.isArray(s.covers) && s.covers.includes(id));
}

function writeRegistry(root, opts = {}) {
  const prev = new Map((readJson(path.join(root, REGISTRY), { rules: [] }).rules || []).map((r) => [r.id, r]));
  const rules = extractRules(root).map(({ id, file, text }) => ({ id, file, text, baseline: !!(opts.baseline || (prev.get(id) && prev.get(id).baseline)) }));
  const p = path.join(root, REGISTRY);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify({ rules }, null, 1) + '\n');
  return { rules: rules.length, baseline: rules.filter((r) => r.baseline).length };
}

function checkRegistry(root) {
  const reg = readJson(path.join(root, REGISTRY), { rules: [] }).rules || [];
  const now = extractRules(root);
  const regIds = new Set(reg.map((r) => r.id));
  const nowIds = new Set(now.map((r) => r.id));
  const stale = reg.length !== now.length || now.some((r) => !regIds.has(r.id));
  const scenarios = loadScenarios(root);
  const claimed = new Set(scenarios.flatMap((s) => (Array.isArray(s.covers) ? s.covers : [])));
  const allow = new Map((readJson(path.join(root, ALLOWLIST), []) || []).filter((e) => e && e.id && e.reason).map((e) => [e.id, e.reason]));
  const unclaimed = reg.filter((r) => !r.baseline && !claimed.has(r.id) && !allow.has(r.id));
  const dangling = [];
  for (const s of scenarios) for (const id of (Array.isArray(s.covers) ? s.covers : [])) if (!nowIds.has(id)) dangling.push({ scenario: s.id, id });
  return { rules: now.length, stale, unclaimed, dangling, claimed: [...claimed].filter((id) => nowIds.has(id)).length };
}

/** Delete the first line whose normalised text is the rule. Null when it is not there. */
function generateMutant(content, ruleText) {
  const eol = /\r\n/.test(content) ? '\r\n' : '\n';
  const lines = content.split(/\r?\n/);
  const i = lines.findIndex((l) => normalise(l) === ruleText);
  if (i < 0) return null;
  lines.splice(i, 1);
  return { content: lines.join(eol), removed: i + 1 };
}

/** Apply rule `id`'s mutant to the extracted package at `packageDir`. */
function applyMutant(root, packageDir, id) {
  const rule = (readJson(path.join(root, REGISTRY), { rules: [] }).rules || []).find((r) => r.id === id) || extractRules(root).find((r) => r.id === id);
  if (!rule) return { error: 'unknown_rule', reason: `no rule ${id} in ${REGISTRY}` };
  const target = path.join(packageDir, rule.file);
  if (!fs.existsSync(target)) return { error: 'file_not_in_package', reason: `${rule.file} is not in the package` };
  const m = generateMutant(fs.readFileSync(target, 'utf8'), rule.text);
  if (!m) return { error: 'rule_not_found', reason: `${rule.file} no longer holds the rule` };
  fs.writeFileSync(target, m.content);
  return { id, file: rule.file, line: m.removed, text: rule.text };
}

module.exports = { extractRules, rulesOf, writeRegistry, checkRegistry, generateMutant, applyMutant, coveringScenarios, normalise, REGISTRY, ALLOWLIST };

if (require.main === module) {
  const root = path.join(__dirname, '..');
  const argv = process.argv.slice(2);
  if (argv.includes('--write')) {
    const r = writeRegistry(root, { baseline: argv.includes('--baseline') });
    console.log(`wrote ${REGISTRY}: ${r.rules} rules, ${r.baseline} baseline`);
  } else if (argv.includes('--list')) {
    console.log(JSON.stringify(extractRules(root), null, 1));
  } else {
    const r = checkRegistry(root);
    const problems = [];
    if (r.stale) problems.push(`${REGISTRY} is stale: run node scripts/prompt-rules.cjs --write`);
    for (const u of r.unclaimed) problems.push(`unclaimed rule ${u.id} (${u.file}): "${u.text.slice(0, 80)}" — add it to a scenario's covers, or to ${ALLOWLIST} with a reason`);
    for (const d of r.dangling) problems.push(`scenario ${d.scenario} covers ${d.id}, which is no rule`);
    if (problems.length) { console.log(problems.join('\n')); process.exit(1); }
    console.log(`prompt-rule registry current: ${r.rules} rules, ${r.claimed} claimed by a scenario`);
  }
}
