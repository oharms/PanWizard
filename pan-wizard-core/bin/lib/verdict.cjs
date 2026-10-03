'use strict';
/**
 * Verdict contract — the machine-readable half of a judging agent's report
 * (evidence loop, docs/specs/evidence_loop_featureai.md §3.3; ADR-0049).
 *
 * The judges that return text (pan-plan-checker, pan-reviewer, pan-design-checker)
 * end their report with a fenced `pan-verdict` JSON block. The verifier already
 * writes a machine contract — the verification.md frontmatter that
 * `/pan:plan-phase --gaps` consumes — so its verdict is read from that frontmatter
 * instead of from a second block that could disagree with it.
 *
 * Pure: no filesystem access, no process exit. findings.cjs does the IO.
 *
 * Contract rules (D11): `contract` is "1.x"; fields may be ADDED within a major
 * version and are never renamed or removed; readers accept any 1.x and ignore
 * fields they do not know; an unknown major is refused.
 */
const crypto = require('crypto');

const VERDICT_CONTRACT = '1.0';
const OUTCOMES = Object.freeze(['pass', 'fail', 'needs_human']);
// Spec Kit's converge classes (missing / partial / contradicts / unrequested) for the
// verification side, plus the review side's defect / risk / quality, plus `human`
// for what no check can settle mechanically.
const FINDING_CLASSES = Object.freeze(['missing', 'partial', 'contradicts', 'unrequested', 'defect', 'risk', 'quality', 'human']);
// The one severity ladder in PAN — identical to review-deep.cjs SEVERITIES
// (tests/verdict.test.cjs pins the equality; a cycle stops this module importing it).
const SEVERITIES = Object.freeze(['critical', 'high', 'medium', 'low', 'info']);
const DISPOSITIONS = Object.freeze(['fixed', 'deferred', 'dismissed', 'decision']);
const REASON_REQUIRED = Object.freeze(['deferred', 'dismissed', 'decision']);
// A re-run does not re-check these, so their absence from a later verdict is not
// evidence that they were resolved (D6).
const AUTO_FIX_EXEMPT = Object.freeze(['human', 'unrequested']);

/** Each judge's own verdict word → the normalised outcome it implies. */
const KNOWN_VERDICTS = Object.freeze({
  'pan-verifier': Object.freeze({ passed: 'pass', gaps_found: 'fail', human_needed: 'needs_human' }),
  'pan-plan-checker': Object.freeze({ passed: 'pass', issues_found: 'fail' }),
  'pan-reviewer': Object.freeze({ PASS: 'pass', PASS_WITH_WARNINGS: 'pass', NEEDS_FIXES: 'fail' }),
  'pan-design-checker': Object.freeze({ PASS: 'pass', GAPS: 'fail' }),
});

const LIMITS = Object.freeze({ findings: 100, where: 200, summary: 300, verdict: 40, score: 40, not_checked: 20, check: 80 });
// What the verifier's test gate can report (verify-phase.md, run_test_suite).
const TEST_GATE_VALUES = Object.freeze(['passed', 'failed', 'skipped']);
const AGENT_RE = /^[a-z][a-z0-9-]{0,63}$/;
const OPEN_FENCE_RE = /^[ \t]*(`{3,}|~{3,})[ \t]*pan-verdict[ \t]*$/;
const CLOSE_FENCE_RE = /^[ \t]*(`{3,}|~{3,})[ \t]*$/;

function sha256(s) {
  return crypto.createHash('sha256').update(s, 'utf8').digest('hex');
}

/** EOL-normalised text: BOM dropped, CRLF → LF. */
function normaliseEol(text) {
  return String(text == null ? '' : text).replace(/^﻿/, '').replace(/\r\n/g, '\n');
}

/** Phase numbers compare without their zero padding ("03" === "3", "03.1" === "3.1"). */
function comparablePhase(p) {
  return String(p == null ? '' : p).trim().replace(/^0+(?=\d)/, '');
}

/**
 * Every fenced `pan-verdict` block in `text`, in order. Backtick or tilde fences,
 * any leading indentation (the host indents framed subagent results). An
 * unterminated block runs to the end of the text and is marked `closed: false`.
 * @returns {{body: string, closed: boolean}[]}
 */
function findVerdictBlocks(text) {
  const lines = normaliseEol(text).split('\n');
  const blocks = [];
  for (let i = 0; i < lines.length; i++) {
    const open = OPEN_FENCE_RE.exec(lines[i]);
    if (!open) continue;
    const fence = open[1];
    const body = [];
    let closed = false;
    let j = i + 1;
    for (; j < lines.length; j++) {
      const close = CLOSE_FENCE_RE.exec(lines[j]);
      if (close && close[1][0] === fence[0] && close[1].length >= fence.length) { closed = true; break; }
      body.push(lines[j]);
    }
    blocks.push({ body: body.join('\n'), closed });
    i = j;
  }
  return blocks;
}

function truncate(s, max) {
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

function cleanText(v) {
  return String(v).replace(/\s+/g, ' ').trim();
}

/**
 * Normalise contract `1`, `"1"`, `"1.x"` to a `1.x` string; null for anything else.
 */
function normaliseContract(c) {
  if (c === 1 || c === '1') return VERDICT_CONTRACT;
  if (typeof c === 'string' && /^1\.\d+$/.test(c.trim())) return c.trim();
  return null;
}

/**
 * Validate and normalise a parsed verdict object.
 *
 * Refuses (ok:false) only what makes the verdict unusable: not an object, an
 * unsupported contract, no agent, no valid outcome. Everything else is recorded
 * in its closest valid form and reported in `warnings`.
 *
 * @param {*} obj - the parsed block
 * @param {{agent?: string, phase?: string|number}} [opts] - the orchestrator's view:
 *   the agent it spawned (wins over the block's own claim) and the phase it asked about
 * @returns {{ok: true, verdict: Object, warnings: string[]}|{ok: false, error: string, reason: string}}
 */
function validateVerdict(obj, opts = {}) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    return { ok: false, error: 'invalid_verdict', reason: 'the pan-verdict block must hold a JSON object' };
  }
  const warnings = [];
  const contract = normaliseContract(obj.contract);
  if (!contract) {
    return {
      ok: false,
      error: 'unsupported_contract',
      reason: `contract ${JSON.stringify(obj.contract === undefined ? null : obj.contract)} is not a supported 1.x version`,
    };
  }

  const claimed = typeof obj.agent === 'string' ? obj.agent.trim() : '';
  const given = typeof opts.agent === 'string' ? opts.agent.trim() : '';
  const agent = given || claimed;
  if (!AGENT_RE.test(agent)) {
    return { ok: false, error: 'missing_agent', reason: 'no valid agent name (block "agent" or --agent)' };
  }
  if (given && claimed && given !== claimed) warnings.push(`agent_mismatch: the block says ${claimed}, recorded as ${given}`);

  const outcome = typeof obj.outcome === 'string' ? obj.outcome.trim().toLowerCase() : '';
  if (!OUTCOMES.includes(outcome)) {
    return { ok: false, error: 'invalid_outcome', reason: `outcome must be one of ${OUTCOMES.join(', ')}` };
  }

  let verdict = null;
  if (obj.verdict != null && String(obj.verdict).trim() !== '') {
    verdict = String(obj.verdict).trim();
    if (verdict.length > LIMITS.verdict) {
      verdict = verdict.slice(0, LIMITS.verdict);
      warnings.push('verdict_truncated');
    }
    const implied = KNOWN_VERDICTS[agent] && Object.prototype.hasOwnProperty.call(KNOWN_VERDICTS[agent], verdict)
      ? KNOWN_VERDICTS[agent][verdict] : null;
    if (implied && implied !== outcome) warnings.push(`outcome_mismatch: ${verdict} implies ${implied}, the block says ${outcome}`);
  }

  const phase = obj.phase == null || String(obj.phase).trim() === '' ? null : String(obj.phase).trim();
  if (phase && opts.phase != null && comparablePhase(phase) !== comparablePhase(opts.phase)) {
    warnings.push(`phase_mismatch: the block says ${phase}, recorded under ${opts.phase}`);
  }

  const score = obj.score == null ? null : truncate(cleanText(obj.score), LIMITS.score);

  let raw = [];
  if (obj.findings != null) {
    if (Array.isArray(obj.findings)) raw = obj.findings;
    else warnings.push('findings_not_an_array');
  }
  if (raw.length > LIMITS.findings) {
    warnings.push(`findings_truncated: ${raw.length} reported, ${LIMITS.findings} kept`);
    raw = raw.slice(0, LIMITS.findings);
  }
  const findings = [];
  raw.forEach((f, i) => {
    if (!f || typeof f !== 'object' || Array.isArray(f) || typeof f.summary !== 'string' || !cleanText(f.summary)) {
      warnings.push(`finding_dropped: #${i} has no summary`);
      return;
    }
    let cls = typeof f.class === 'string' ? f.class.trim().toLowerCase() : '';
    if (!FINDING_CLASSES.includes(cls)) {
      warnings.push(`unknown_class: #${i} ${JSON.stringify(f.class === undefined ? null : f.class)} recorded as quality`);
      cls = 'quality';
    }
    let severity = typeof f.severity === 'string' ? f.severity.trim().toLowerCase() : '';
    if (!SEVERITIES.includes(severity)) {
      warnings.push(`unknown_severity: #${i} ${JSON.stringify(f.severity === undefined ? null : f.severity)} recorded as info`);
      severity = 'info';
    }
    let summary = cleanText(f.summary);
    if (summary.length > LIMITS.summary) {
      summary = truncate(summary, LIMITS.summary);
      warnings.push(`summary_truncated: #${i}`);
    }
    const where = f.where == null || cleanText(f.where) === '' ? null : truncate(cleanText(f.where).replace(/\\/g, '/'), LIMITS.where);
    findings.push({ class: cls, severity, where, summary });
  });

  const notChecked = normaliseNotChecked(obj.not_checked, warnings);
  return { ok: true, verdict: { contract, agent, outcome, verdict, phase, score, findings, not_checked: notChecked }, warnings };
}

/**
 * The checks a judge could not run, each `{check, reason}` (market-ideas M23).
 * A verdict that carries them says what it did not see: a `pass` with tests that
 * never ran is recorded as exactly that, never as a plain pass. Accepts bare
 * strings as checks with no reason; drops entries with no check.
 */
function normaliseNotChecked(value, warnings) {
  if (value == null) return [];
  if (!Array.isArray(value)) {
    warnings.push('not_checked_not_an_array');
    return [];
  }
  const out = [];
  for (const entry of value.slice(0, LIMITS.not_checked)) {
    const obj = typeof entry === 'string' ? { check: entry } : (entry && typeof entry === 'object' && !Array.isArray(entry) ? entry : null);
    const check = obj ? truncate(cleanText(obj.check ?? obj.gate ?? ''), LIMITS.check) : '';
    if (!check) continue;
    const reason = obj.reason == null || cleanText(obj.reason) === '' ? null : truncate(cleanText(obj.reason), LIMITS.summary);
    out.push({ check, reason });
  }
  if (value.length > LIMITS.not_checked) warnings.push(`not_checked_truncated: ${value.length} reported, ${LIMITS.not_checked} kept`);
  return out;
}

// ─── verification.md frontmatter adapter ─────────────────────────────────────

/** The YAML between the leading `---` fences, or null. */
function frontmatterText(text) {
  const m = normaliseEol(text).match(/^---\n([\s\S]*?)\n---(?:\n|$)/);
  return m ? m[1] : null;
}

/**
 * A YAML value without its trailing comment. The verifier's templates annotate list
 * keys (`gaps: # Only if status: gaps_found`), and a model copying the template
 * copies the comment, so `# …` must not read as a value. A quoted value ends at its
 * closing quote.
 */
function stripComment(v) {
  const s = String(v == null ? '' : v).trim();
  if (s[0] === '"' || s[0] === "'") {
    const q = s[0];
    for (let i = 1; i < s.length; i++) {
      if (q === '"' && s[i] === '\\') { i++; continue; }
      if (s[i] === q) {
        if (q === "'" && s[i + 1] === "'") { i++; continue; }
        return s.slice(0, i + 1);
      }
    }
    return s;
  }
  return s.replace(/(^|\s)#.*$/, '').trim();
}

function unquote(v) {
  const s = stripComment(v);
  if (s.length >= 2 && s[0] === '"' && s[s.length - 1] === '"') {
    try { return JSON.parse(s); } catch { return s.slice(1, -1); }
  }
  if (s.length >= 2 && s[0] === "'" && s[s.length - 1] === "'") return s.slice(1, -1).replace(/''/g, "'");
  return s;
}

const KEY_VALUE_RE = /^([A-Za-z_][A-Za-z0-9_-]*):[ \t]*(.*)$/;
const ITEM_RE = /^([ \t]*)-[ \t]*(.*)$/;
const indentOf = (line) => /^[ \t]*/.exec(line)[0].length;

/**
 * A top-level YAML list of mappings, in the shape the verifier template writes:
 *
 *   gaps:
 *     - truth: "…"
 *       status: failed
 *       artifacts:
 *         - path: "src/x.ts"
 *
 * Each item comes back as its scalar fields plus `_first_path` (the first nested
 * `path:` value, for `artifacts`). PAN's general frontmatter parser reads such a
 * list as bare strings (`'truth: "…'`), so this reader exists for the adapter alone
 * rather than changing a parser every other module depends on.
 */
function listOfMappings(yaml, key) {
  const lines = yaml.split('\n');
  const start = lines.findIndex((l) => {
    const m = KEY_VALUE_RE.exec(l);
    return m && m[1] === key && indentOf(l) === 0;
  });
  if (start === -1) return [];
  const head = KEY_VALUE_RE.exec(lines[start]);
  if (stripComment(head[2]) !== '') return []; // `gaps: []` or a scalar — nothing to read
  const items = [];
  let itemIndent = -1;
  let item = null;
  let contentIndent = -1;
  let nested = null;
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const ind = indentOf(line);
    const isItem = ITEM_RE.exec(line);
    if (ind === 0 && !isItem) break; // the next top-level key
    if (isItem && (itemIndent === -1 || ind === itemIndent)) {
      if (itemIndent === -1) itemIndent = ind;
      item = {};
      items.push(item);
      contentIndent = ind + (line.length - line.replace(/^[ \t]*-[ \t]*/, '').length) - ind;
      nested = null;
      const kv = KEY_VALUE_RE.exec(isItem[2]);
      if (kv) {
        if (stripComment(kv[2]) === '') nested = kv[1];
        else item[kv[1]] = unquote(kv[2]);
      }
      continue;
    }
    if (!item) continue;
    const body = line.trim();
    if (ind === contentIndent) {
      const kv = KEY_VALUE_RE.exec(body);
      if (!kv) continue;
      if (stripComment(kv[2]) === '') { nested = kv[1]; continue; }
      item[kv[1]] = unquote(kv[2]);
      nested = null;
      continue;
    }
    if (ind > contentIndent && nested) {
      const inner = body.replace(/^-[ \t]*/, '');
      const kv = KEY_VALUE_RE.exec(inner);
      if (kv && kv[1] === 'path' && item._first_path === undefined && stripComment(kv[2]) !== '') {
        item._first_path = unquote(kv[2]);
      }
    }
  }
  return items;
}

/** A top-level scalar from the frontmatter (e.g. `status`), or null. */
function frontmatterScalar(yaml, key) {
  for (const l of yaml.split('\n')) {
    const m = KEY_VALUE_RE.exec(l);
    if (m && m[1] === key && indentOf(l) === 0) {
      const v = unquote(m[2]);
      return v === '' ? null : v;
    }
  }
  return null;
}

/**
 * Build a raw verdict object from a verification.md frontmatter (the adapter, D2).
 * `status` → verdict and outcome; `gaps[]` → missing (failed) / partial;
 * `human_verification[]` → human; `unrequested[]` (M11) → unrequested.
 * @returns {Object|null} a raw verdict for validateVerdict, or null when the text
 *   carries no verification frontmatter status
 */
function verdictFromVerificationFrontmatter(text, agent = 'pan-verifier') {
  const yaml = frontmatterText(text);
  if (yaml === null) return null;
  const status = frontmatterScalar(yaml, 'status');
  if (!status) return null;
  const table = KNOWN_VERDICTS['pan-verifier'];
  const outcome = Object.prototype.hasOwnProperty.call(table, status) ? table[status] : null;
  const findings = [];
  for (const g of listOfMappings(yaml, 'gaps')) {
    const truth = g.truth ? String(g.truth) : '';
    const reason = g.reason ? String(g.reason) : '';
    const summary = truth && reason ? `${truth} — ${reason}` : (truth || reason);
    if (!summary) continue;
    const partial = String(g.status || '').toLowerCase() === 'partial';
    findings.push({ class: partial ? 'partial' : 'missing', severity: partial ? 'medium' : 'high', where: g._first_path || null, summary });
  }
  for (const h of listOfMappings(yaml, 'human_verification')) {
    const summary = h.test ? String(h.test) + (h.expected ? ` — expected: ${h.expected}` : '') : '';
    if (summary) findings.push({ class: 'human', severity: 'info', where: null, summary });
  }
  for (const u of listOfMappings(yaml, 'unrequested')) {
    const what = u.what ? String(u.what) : (u.why ? String(u.why) : '');
    const path = u.path ? String(u.path) : null;
    const summary = what || (path ? `unrequested change to ${path}` : '');
    if (summary) findings.push({ class: 'unrequested', severity: 'low', where: path, summary });
  }
  // The test gate (M23). `not_checked` lists what the verifier could not run; a
  // `test_gate: skipped` with no tests entry there still counts as one, so a model
  // that records the gate but forgets the list cannot turn it into a plain pass.
  let notChecked = listOfMappings(yaml, 'not_checked').map((n) => ({ check: n.check || n.gate || '', reason: n.reason || null }));
  const testGateRaw = frontmatterScalar(yaml, 'test_gate');
  const testGate = testGateRaw ? String(testGateRaw).toLowerCase() : null;
  const isTests = (n) => /test/i.test(String(n.check));
  let contradicted = false;
  if (testGate === 'skipped' && !notChecked.some(isTests)) {
    notChecked.push({ check: 'tests', reason: frontmatterScalar(yaml, 'test_gate_reason') || 'the test gate was skipped' });
  } else if ((testGate === 'passed' || testGate === 'failed') && notChecked.some(isTests)) {
    // The gate ran, so a `tests` entry is the template's example copied over: the
    // recorded gate is the measurement, and the entry goes.
    notChecked = notChecked.filter((n) => !isTests(n));
    contradicted = true;
  }
  return { contract: VERDICT_CONTRACT, agent, verdict: status, outcome, findings, not_checked: notChecked, test_gate: testGate, not_checked_contradicted: contradicted };
}

/**
 * Read a judge's verdict from an artifact: the LAST `pan-verdict` block wins; with
 * no block, a verification.md frontmatter `status` is read through the adapter.
 * @param {string} text
 * @param {{agent?: string, phase?: string|number}} [opts]
 * @returns {{ok: true, verdict: Object, warnings: string[], source_kind: 'block'|'frontmatter'}
 *          |{ok: false, error: string, reason: string}}
 */
function parseVerdictText(text, opts = {}) {
  const blocks = findVerdictBlocks(text);
  if (blocks.length) {
    const last = blocks[blocks.length - 1];
    if (!last.closed) return { ok: false, error: 'unterminated_block', reason: 'the last pan-verdict block has no closing fence' };
    let obj;
    try { obj = JSON.parse(last.body); } catch (e) {
      return { ok: false, error: 'invalid_json', reason: `the last pan-verdict block is not valid JSON: ${e.message}` };
    }
    const r = validateVerdict(obj, opts);
    return r.ok ? { ...r, source_kind: 'block' } : r;
  }
  const adapted = verdictFromVerificationFrontmatter(text, opts.agent || 'pan-verifier');
  if (adapted) {
    if (!adapted.outcome) {
      return { ok: false, error: 'unknown_status', reason: `verification status "${adapted.verdict}" is not passed, gaps_found or human_needed` };
    }
    const r = validateVerdict(adapted, opts);
    if (!r.ok) return r;
    // Say when the verification does not record its test gate, or records a failed
    // gate under a pass: both make "passed" claim more than the verifier checked.
    if (!adapted.test_gate) r.warnings.push('test_gate_unrecorded: the verification does not say whether the test suite ran');
    else if (!TEST_GATE_VALUES.includes(adapted.test_gate)) r.warnings.push(`test_gate_unknown: "${adapted.test_gate}" is not passed, failed or skipped`);
    else if (adapted.test_gate === 'failed' && adapted.outcome === 'pass') r.warnings.push('test_gate_failed_under_pass: the test gate failed but the status is passed');
    if (adapted.not_checked_contradicted) r.warnings.push(`not_checked_contradicted: test_gate is ${adapted.test_gate}, so the not_checked tests entry was dropped`);
    return { ...r, source_kind: 'frontmatter' };
  }
  return { ok: false, error: 'no_verdict', reason: 'no pan-verdict block and no verification frontmatter status' };
}

/** Identity of the artifact a verdict was read from: EOL-normalised content hash. */
function recordSig(text) {
  return sha256(normaliseEol(text).replace(/\s+$/, '')).slice(0, 16);
}

/**
 * A finding's stable id: the same finding reported again keeps its id, so a
 * re-verification can say which earlier findings it no longer reports.
 */
function findingId(phase, agent, finding) {
  const summary = cleanText(finding.summary || '').toLowerCase().replace(/[.;:,!]+$/, '');
  const where = finding.where ? cleanText(finding.where).replace(/\\/g, '/') : '';
  return 'f_' + sha256([comparablePhase(phase), agent, finding.class, where, summary].join('\u0000')).slice(0, 10);
}

/** The outcome an agent's own verdict word implies, or null when it is not a known pair. */
function outcomeForVerdict(agent, verdict) {
  const table = KNOWN_VERDICTS[agent];
  return table && Object.prototype.hasOwnProperty.call(table, verdict) ? table[verdict] : null;
}

module.exports = {
  VERDICT_CONTRACT,
  OUTCOMES,
  FINDING_CLASSES,
  SEVERITIES,
  DISPOSITIONS,
  REASON_REQUIRED,
  AUTO_FIX_EXEMPT,
  KNOWN_VERDICTS,
  LIMITS,
  findVerdictBlocks,
  validateVerdict,
  verdictFromVerificationFrontmatter,
  parseVerdictText,
  recordSig,
  findingId,
  outcomeForVerdict,
  comparablePhase,
  normaliseEol,
};
