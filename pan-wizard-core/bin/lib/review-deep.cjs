/**
 * Review-Deep — security + cross-check review data layer (Spec B v2 Y-2, v3.2).
 *
 * Orchestration sequence:
 *   1. pan-reviewer (already shipped)   — convention/style findings
 *   2. pan-hardener  (new, this wave)   — OWASP Top 10 + STRIDE audit
 *   3. pan-meta-reviewer (new)          — flags things (1) and (2) missed
 *
 * This module provides the DATA LAYER only:
 *   - parseReviewFindings(markdown) — extract structured findings from
 *     either a reviewer/hardener/meta-reviewer markdown output
 *   - mergeReviews(reviewer, hardener, meta) — merge the three findings
 *     sets into one consolidated list + conflict table
 *   - writeDeepReview(cwd, phaseNum, payload) — serialize the merged output
 *     to .planning/reviews/<N>/deep-review.md
 *
 * Agents publish to `review-handoff` channel via bus.cjs for audit trail.
 */

const fs = require('fs');
const path = require('path');
const { output, error, safeReadFile, toPosix } = require('./core.cjs');
const { PLANNING_DIR } = require('./constants.cjs');
const { planningPath } = require('./utils.cjs');
const { publish } = require('./bus.cjs');

const REVIEWS_DIR = 'reviews';
const SEVERITIES = ['critical', 'high', 'medium', 'low', 'info'];
const SEVERITY_WEIGHT = { critical: 4, high: 3, medium: 2, low: 1, info: 0 };

function reviewsDir(cwd) {
  return path.join(planningPath(cwd), REVIEWS_DIR);
}

/**
 * Parse structured findings from reviewer/hardener/meta-reviewer markdown.
 *
 * Expected format: each finding is a bullet under a `## Findings` heading
 * with the shape:
 *   - **[SEVERITY] category** — description. File: `path:line` — rationale.
 *
 * Recognized severities (case-insensitive): critical, high, medium, low, info.
 * Missing severity defaults to `info`.
 *
 * @param {string} content - Full markdown content
 * @param {string} source - Label for finding.source (e.g. "reviewer", "hardener")
 * @returns {Array<Object>}
 */
function parseReviewFindings(content, source) {
  if (typeof content !== 'string' || !content) return [];
  const findings = [];
  const lines = content.split('\n');
  let inFindings = false;
  for (const line of lines) {
    if (/^##\s+Findings\s*$/i.test(line)) { inFindings = true; continue; }
    if (inFindings && /^##\s+/.test(line)) { inFindings = false; continue; }
    if (!inFindings) continue;

    const m = line.match(/^-\s+(?:\*\*\[(critical|high|medium|low|info)\]\s*([^*]*?)\*\*\s*[-—:]\s*)?(.+)$/i);
    if (!m) continue;
    const severity = (m[1] || 'info').toLowerCase();
    const category = (m[2] || 'general').trim();
    const rest = m[3].trim();

    // Optional `File: path:line — rationale.`
    const fileMatch = rest.match(/File:\s*`?([^:`\s]+)(?::(\d+))?`?\s*[-—]?\s*(.*)$/i);
    const description = fileMatch ? rest.slice(0, fileMatch.index).trim().replace(/[.\s]+$/, '') : rest;
    const file = fileMatch ? fileMatch[1] : null;
    const lineNum = fileMatch && fileMatch[2] ? Number(fileMatch[2]) : null;
    const rationale = fileMatch ? (fileMatch[3] || null) : null;

    findings.push({
      source,
      severity,
      category,
      description,
      file,
      line: lineNum,
      rationale,
    });
  }
  return findings;
}

/**
 * Merge findings from the three reviewers into a consolidated list plus
 * a conflict table. A "conflict" is when the meta-reviewer explicitly
 * disputes a reviewer/hardener finding (meta source mentions `dispute` or
 * `overstated`) or adds a finding that reviewer/hardener missed.
 *
 * @param {Array|string} reviewer - reviewer findings array OR markdown content
 * @param {Array|string} hardener - hardener findings array OR markdown content
 * @param {Array|string} [meta]   - optional meta-reviewer findings
 * @returns {Object} Merged payload
 */
function mergeReviews(reviewer, hardener, meta) {
  const r = Array.isArray(reviewer) ? reviewer : parseReviewFindings(reviewer || '', 'reviewer');
  const h = Array.isArray(hardener) ? hardener : parseReviewFindings(hardener || '', 'hardener');
  const m = Array.isArray(meta) ? meta : parseReviewFindings(meta || '', 'meta-reviewer');

  const findings = [...r, ...h, ...m].sort((a, b) => {
    const wa = SEVERITY_WEIGHT[a.severity] ?? 0;
    const wb = SEVERITY_WEIGHT[b.severity] ?? 0;
    if (wa !== wb) return wb - wa;
    return (a.file || '').localeCompare(b.file || '');
  });

  // Conflicts: any meta-reviewer finding whose description contains keywords
  // suggesting disagreement, OR any meta finding on a file+line the other
  // sources didn't flag.
  const conflicts = [];
  for (const mf of m) {
    // "missed" is genuinely ambiguous — a meta describing a finding as
    // "missed issue" is an addition, not a dispute. Restrict dispute keywords
    // to ones that explicitly signal disagreement with a prior finding.
    const kw = /\b(dispute|overstated|incorrectly|false\s*positive|overrated|underrated)\b/i;
    if (kw.test(mf.description)) {
      conflicts.push({
        type: 'meta_dispute',
        finding: mf,
      });
      continue;
    }
    // Missed: meta raises something reviewer+hardener didn't on same file.
    if (mf.file) {
      const othersFoundThisFile = [...r, ...h].some(x => x.file === mf.file && x.line === mf.line);
      if (!othersFoundThisFile) {
        conflicts.push({
          type: 'meta_addition',
          finding: mf,
        });
      }
    }
  }

  const coverage = {
    total: findings.length,
    by_source: {
      reviewer: r.length,
      hardener: h.length,
      meta_reviewer: m.length,
    },
    by_severity: SEVERITIES.reduce((acc, s) => { acc[s] = findings.filter(f => f.severity === s).length; return acc; }, {}),
  };

  // Verdict: highest-severity finding drives the verdict.
  let verdict;
  if (coverage.by_severity.critical > 0) verdict = 'block';
  else if (coverage.by_severity.high > 0) verdict = 'review_required';
  else if (coverage.by_severity.medium > 0) verdict = 'fix_before_merge';
  else if (coverage.by_severity.low > 0) verdict = 'ok_with_minor';
  else verdict = 'ok';

  return { findings, conflicts, coverage, verdict };
}

/**
 * Write the merged deep-review report to .planning/reviews/<phase>/deep-review.md.
 * Returns the written path.
 *
 * @param {string} cwd - Project root
 * @param {string} phaseNum - Phase number (e.g. "07")
 * @param {Object} payload - mergeReviews() output
 * @param {Object} [opts] - {timestamp, audit_channel}
 * @returns {{written: true, file: string}|{error: string}}
 */
function writeDeepReview(cwd, phaseNum, payload, opts) {
  if (!phaseNum) return { error: 'phaseNum required' };
  const targetDir = path.join(reviewsDir(cwd), String(phaseNum));
  try {
    fs.mkdirSync(targetDir, { recursive: true });
  } catch (e) {
    return { error: `Failed to create ${targetDir}: ${e.message}` };
  }

  const lines = [];
  lines.push('---');
  lines.push('type: deep-review');
  lines.push(`phase: ${phaseNum}`);
  lines.push(`generated: ${opts?.timestamp || new Date().toISOString()}`);
  lines.push(`verdict: ${payload.verdict}`);
  lines.push('---');
  lines.push('');
  lines.push(`# Deep Review — Phase ${phaseNum}`);
  lines.push('');
  lines.push(`**Verdict:** ${payload.verdict}`);
  lines.push('');
  lines.push('## Coverage');
  lines.push(`- Total findings: ${payload.coverage.total}`);
  lines.push(`- By source: reviewer=${payload.coverage.by_source.reviewer}, hardener=${payload.coverage.by_source.hardener}, meta=${payload.coverage.by_source.meta_reviewer}`);
  lines.push(`- By severity: ${SEVERITIES.map(s => `${s}=${payload.coverage.by_severity[s]}`).join(', ')}`);
  lines.push('');

  if (payload.findings.length > 0) {
    lines.push('## Findings');
    lines.push('');
    lines.push('| Severity | Source | Category | Description | File |');
    lines.push('|----------|--------|----------|-------------|------|');
    for (const f of payload.findings) {
      const loc = f.file ? `\`${f.file}${f.line ? `:${f.line}` : ''}\`` : '—';
      const desc = f.description.replace(/\|/g, '\\|');
      lines.push(`| ${f.severity} | ${f.source} | ${f.category} | ${desc} | ${loc} |`);
    }
    lines.push('');
  } else {
    lines.push('## Findings');
    lines.push('');
    lines.push('_No findings — all three reviewers returned clean._');
    lines.push('');
  }

  if (payload.conflicts.length > 0) {
    lines.push('## Conflicts & additions from meta-reviewer');
    lines.push('');
    for (const c of payload.conflicts) {
      const locLine = c.finding.file ? ` at \`${c.finding.file}${c.finding.line ? `:${c.finding.line}` : ''}\`` : '';
      lines.push(`- **${c.type}** — ${c.finding.description}${locLine}`);
    }
    lines.push('');
  }

  const file = path.join(targetDir, 'deep-review.md');
  try {
    fs.writeFileSync(file, lines.join('\n'), 'utf-8');
  } catch (e) {
    return { error: `Failed to write ${file}: ${e.message}` };
  }

  // Audit trail on the review-handoff bus channel (best-effort).
  if (opts?.audit_channel !== false) {
    try {
      publish(cwd, 'review-handoff', {
        phase: phaseNum,
        verdict: payload.verdict,
        finding_count: payload.coverage.total,
        conflict_count: payload.conflicts.length,
        file: toPosix(path.relative(cwd, file)),
      }, { source: 'pan-meta-reviewer' });
    } catch { /* non-blocking */ }
  }

  return { written: true, file: toPosix(path.relative(cwd, file)) };
}

// ─── CLI wrappers ───────────────────────────────────────────────────────────

function cmdReviewDeepMerge(cwd, phaseNum, opts, raw) {
  if (!phaseNum) error('Usage: review-deep merge <phase> --reviewer-file X --hardener-file Y [--meta-file Z]');
  const reviewerContent = opts.reviewerFile ? safeReadFile(opts.reviewerFile) : '';
  const hardenerContent = opts.hardenerFile ? safeReadFile(opts.hardenerFile) : '';
  const metaContent = opts.metaFile ? safeReadFile(opts.metaFile) : '';
  if (!reviewerContent && !hardenerContent && !metaContent) {
    output({ error: 'No input files provided or readable' }, raw);
    return;
  }
  const payload = mergeReviews(reviewerContent, hardenerContent, metaContent);
  const result = writeDeepReview(cwd, phaseNum, payload);
  if (result.error) { output(result, raw); return; }
  output({ ...result, verdict: payload.verdict, coverage: payload.coverage, conflicts: payload.conflicts.length }, raw);
}

function cmdReviewDeepAnalyze(cwd, phaseNum, opts, raw) {
  // Returns the merged payload WITHOUT writing a file. Useful for piping.
  if (!phaseNum) error('Usage: review-deep analyze <phase> --reviewer-file X --hardener-file Y [--meta-file Z]');
  const reviewerContent = opts.reviewerFile ? safeReadFile(opts.reviewerFile) : '';
  const hardenerContent = opts.hardenerFile ? safeReadFile(opts.hardenerFile) : '';
  const metaContent = opts.metaFile ? safeReadFile(opts.metaFile) : '';
  output(mergeReviews(reviewerContent, hardenerContent, metaContent), raw);
}

module.exports = {
  parseReviewFindings,
  mergeReviews,
  writeDeepReview,
  cmdReviewDeepMerge,
  cmdReviewDeepAnalyze,
  SEVERITIES,
  SEVERITY_WEIGHT,
  REVIEWS_DIR,
};
