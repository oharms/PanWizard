'use strict';
/**
 * test-quality-lint.cjs — the assertion shapes that proved vacuous, as lint rules.
 *
 * Each rule came from a test that passed while the feature it named was broken
 * (audit of 2026-09-17, spec docs/specs/testing-system-redesign-2026-09.md §3.1):
 *   Q1  an OR-shaped liveness assert — `assert.ok(a.length > 0 || b.length > 0)` is
 *       satisfied by a crash with a stack trace;
 *   Q2  an in-process call to a lib module's `cmd*` function — they end in output()/
 *       error(), which exit the process, so the test child dies and node --test
 *       reports the file as one passing test;
 *   Q3  `assert.ok(true)` / `assert(true)`;
 *   Q4  a runPanTools result asserted only by `.output.length`;
 *   Q5  a platform conditional that bare-`return`s (counted as a pass) instead of
 *       `t.skip(reason)`;
 *   Q6  a wall-clock upper bound under two seconds on a spawned process;
 *   Q7  a read of the developer's real HOME / USERPROFILE / os.homedir();
 *   Q8  a committed `test.todo` (scaffold stubs must be filled before commit);
 *   Q9  an OR of bare property reads inside assert.ok — `assert.ok(a.x || a.y)` asks only
 *       whether one of them exists, which an empty object, the wrong field, or a payload
 *       that means failure all satisfy. Q1 covers the result-status fields; this covers
 *       the same vacuity for arbitrary ones.
 *
 * `lintTestSource(src, file)` is pure; tests/test-quality.test.cjs applies it to the
 * suite with tests/fixtures/test-quality-allowlist.json (entries { file, rule,
 * count, reason } — allowed occurrences per file and rule; an entry that allows more
 * than the file has is stale and fails too).
 */

function stripComments(line) {
  // Good enough for test sources: drop a trailing // comment that is not inside
  // quotes, and ignore the body lines of a /** … */ block comment.
  if (/^\s*(\*|\/\*)/.test(line)) return '';
  let inS = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inS) { if (c === '\\') i++; else if (c === inS) inS = null; continue; }
    if (c === '\'' || c === '"' || c === '`') inS = c;
    else if (c === '/' && line[i + 1] === '/') return line.slice(0, i);
  }
  return line;
}

/** Join an assert statement that spans lines until its parentheses balance (max 8 lines). */
function statementAt(lines, i) {
  let text = lines[i];
  let depth = 0;
  for (let j = i; j < Math.min(lines.length, i + 8); j++) {
    const t = stripComments(lines[j]);
    if (j > i) text += ' ' + t.trim();
    for (const c of t) { if (c === '(') depth++; else if (c === ')') depth--; }
    if (depth <= 0 && j > i) break;
    if (depth <= 0 && j === i && /\)\s*;?\s*$/.test(t)) break;
  }
  return text;
}

const TIME_WORDS = /\b(ms|elapsed|duration|took|Date\.now|hrtime|performance\.now|timing)\b/;

// The result-status fields whose bare truthiness a liveness assert ORs together:
// `result.output || result.error`, `!r.success || r.error`, `parsed.error || parsed.state`.
// A crash satisfies every one of them — stderr is non-empty. An OR between two
// content checks (`x.includes('a') || x.includes('b')`) is a legitimate either-format
// assert and is not this rule's business.
const STATUS_FIELD = /^!?\(?\s*[\w$.]*\b(success|error|output|stderr|stdout|reason|state|status)\b\s*\)?$/;
const LENGTH_LIVENESS = /^!?\(?\s*[\w$.]*\.(?:output|error|stderr|stdout)\.length\s*>\s*0\s*\)?$/;

function isLivenessOr(inner) {
  const operands = inner.split(/\|\|/).map((s) => s.trim());
  if (operands.length < 2) return false;
  const bare = operands.filter((o) => STATUS_FIELD.test(o) || LENGTH_LIVENESS.test(o));
  return bare.length >= 2;
}

const RULES = [
  {
    id: 'Q1',
    title: 'OR-shaped liveness assert',
    fix: 'assert the exit code and parse the JSON payload (or assert each branch on its own)',
    detect(lines) {
      const out = [];
      lines.forEach((raw, i) => {
        const line = stripComments(raw);
        if (!/\bassert(?:\.ok)?\s*\(/.test(line)) return;
        const stmt = statementAt(lines, i);
        // The asserted expression: everything before the message argument.
        let inner = stmt.slice(stmt.indexOf('(') + 1).replace(/\)\s*;?\s*$/, '');
        const msg = inner.search(/,\s*(['"`])/);
        if (msg >= 0) inner = inner.slice(0, msg);
        if (isLivenessOr(inner)) out.push({ line: i + 1, text: raw.trim() });
      });
      return out;
    },
  },
  {
    id: 'Q2',
    title: 'in-process call to a lib cmd* function',
    fix: 'go through runPanTools (or the module’s pure functions) — cmd* functions end in output()/error(), which exit the process',
    detect(lines) {
      const out = [];
      lines.forEach((raw, i) => {
        const line = stripComments(raw);
        if (/\bcmd[A-Z][A-Za-z0-9]*\s*\(/.test(line) && !/^\s*(const|let|var)\s+\{/.test(line)) out.push({ line: i + 1, text: raw.trim() });
      });
      return out;
    },
  },
  {
    id: 'Q3',
    title: 'assert(true)',
    fix: 'assert a specific value',
    detect(lines) {
      const out = [];
      lines.forEach((raw, i) => { if (/\bassert(?:\.ok)?\(\s*true\s*[,)]/.test(stripComments(raw))) out.push({ line: i + 1, text: raw.trim() }); });
      return out;
    },
  },
  {
    id: 'Q4',
    title: 'CLI output asserted only by its length',
    fix: 'parse the JSON payload and assert its fields; assert success/exit code',
    detect(lines) {
      const out = [];
      lines.forEach((raw, i) => { if (/assert\.ok\(\s*[A-Za-z_$][\w$.]*\.output\.length\s*[><!=]/.test(stripComments(raw))) out.push({ line: i + 1, text: raw.trim() }); });
      return out;
    },
  },
  {
    id: 'Q5',
    title: 'platform conditional that bare-returns',
    fix: 'use t.skip(reason) so the skip is reported, never counted as a pass',
    detect(lines) {
      const out = [];
      lines.forEach((raw, i) => {
        const line = stripComments(raw);
        if (!/process\.platform/.test(line) || !/\bif\s*\(/.test(line)) return;
        const window = [line, lines[i + 1] || '', lines[i + 2] || ''].map(stripComments).join(' ');
        if (/\bskip\s*\(/.test(window) || /\btodo\s*\(/.test(window)) return;
        if (/\)\s*\{?\s*return\b/.test(line) || /^\s*return\s*;?\s*\}?\s*$/.test(stripComments(lines[i + 1] || ''))) out.push({ line: i + 1, text: raw.trim() });
      });
      return out;
    },
  },
  {
    id: 'Q6',
    title: 'wall-clock upper bound under two seconds',
    fix: 'assert the behaviour, not the speed; if timing is the contract, bound it generously and allowlist with the reason',
    detect(lines) {
      const out = [];
      lines.forEach((raw, i) => {
        const line = stripComments(raw);
        if (!/\bassert(?:\.ok)?\s*\(/.test(line) || !TIME_WORDS.test(line)) return;
        const m = /<\s*=?\s*(\d{2,4})\b/.exec(line);
        if (m && Number(m[1]) < 2000) out.push({ line: i + 1, text: raw.trim() });
      });
      return out;
    },
  },
  {
    id: 'Q7',
    title: 'read of the real HOME',
    fix: 'sandbox with withFakeHome() from tests/helpers.cjs, or pass an explicit config dir',
    detect(lines) {
      const out = [];
      lines.forEach((raw, i) => {
        const line = stripComments(raw);
        if (/os\.homedir\(\)|process\.env\.(?:HOME|USERPROFILE)\b(?!\s*=[^=])/.test(line)) out.push({ line: i + 1, text: raw.trim() });
      });
      return out;
    },
  },
  {
    id: 'Q8',
    title: 'committed todo',
    fix: 'fill the stub or delete it; todo stubs are scaffold output, not tests',
    detect(lines) {
      const out = [];
      lines.forEach((raw, i) => { if (/\b(?:test|it|describe)\.todo\s*\(|\{\s*todo\s*:/.test(stripComments(raw))) out.push({ line: i + 1, text: raw.trim() }); });
      return out;
    },
  },
  {
    id: 'Q9',
    title: 'OR of bare property reads in assert.ok',
    fix: 'assert the specific field and its expected value, not that one of several exists',
    detect(lines) {
      const out = [];
      lines.forEach((raw, i) => {
        const line = stripComments(raw);
        const m = line.match(/assert\.ok\(\s*([^;]*?)\s*(?:,\s*['"`][^;]*)?\)\s*;/);
        if (!m || !m[1].includes('||')) return;
        const expr = m[1];
        // A comparison, a call, a negation or a length check is making a claim about a
        // value; only a bare existence test is vacuous in this way.
        if (/[=<>]|\(|\)|!|\.length|typeof|Array\.isArray/.test(expr)) return;
        const operands = expr.split('||').map((s) => s.trim());
        if (operands.length < 2) return;
        if (!operands.every((o) => /^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)+$/.test(o))) return;
        out.push({ line: i + 1, text: raw.trim() });
      });
      return out;
    },
  },
];

/** Findings for one test source: [{ rule, title, fix, line, text }]. */
function lintTestSource(src, file = '') {
  const lines = src.split(/\r?\n/);
  const findings = [];
  for (const rule of RULES) {
    for (const f of rule.detect(lines)) findings.push({ rule: rule.id, title: rule.title, fix: rule.fix, file, line: f.line, text: f.text });
  }
  return findings;
}

/**
 * Apply an allowlist ([{ file, rule, count, reason }]) to findings.
 * Returns { remaining, stale } — stale entries allow more than the file has, or
 * carry no reason. Both fail the suite: an allowlist is a debt register, not a bin.
 */
function applyAllowlist(findings, allowlist) {
  const remaining = [];
  const stale = [];
  const byKey = new Map();
  for (const f of findings) { const k = `${f.file}|${f.rule}`; byKey.set(k, (byKey.get(k) || []).concat(f)); }
  const seen = new Set();
  for (const entry of allowlist || []) {
    const k = `${entry.file}|${entry.rule}`;
    seen.add(k);
    const have = (byKey.get(k) || []).length;
    if (!entry.reason || !String(entry.reason).trim()) stale.push({ ...entry, why: 'no reason given' });
    else if (have === 0) stale.push({ ...entry, why: 'file has no such finding any more — remove the entry' });
    else if (have < (entry.count || 0)) stale.push({ ...entry, why: `allows ${entry.count} but the file has ${have} — lower the count` });
    else if (have > (entry.count || 0)) remaining.push(...(byKey.get(k) || []).slice(entry.count || 0));
  }
  for (const [k, list] of byKey) if (!seen.has(k)) remaining.push(...list);
  return { remaining, stale };
}

module.exports = { RULES, lintTestSource, applyAllowlist, stripComments };
