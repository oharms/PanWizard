/**
 * Learn-Lint — Validate the learnings system itself.
 *
 * Catches integrity violations that erode trust in the learnings PAN ships
 * to executor / planner / verifier agents:
 *
 *  - L-001: Duplicate pattern IDs across files (silent contract collision)
 *  - L-002: Dangling pattern reference (body cites P-XXXX that doesn't exist)
 *  - L-003: Empty source_experiments while evidence prose names a known experiment
 *  - L-004: Universal-scope rule prose mentions PAN-internal terms
 *           (candidate for internal/ scope rather than universal/)
 *  - L-005: Revision marker (rN) appended in body but no supersession field
 *  - L-006: Universal-scope pattern cites an internal pattern id (dangles after install)
 *
 * These are not patterns themselves — they're integrity checks for the
 * pattern store. Wired to `pan-tools learn lint`.
 */

const fs = require('fs');
const path = require('path');

const VALID_SCOPES = ['universal', 'internal'];

/**
 * Default root for the learnings store: three levels up from lib/ — the install
 * root (`<runtime-dir>/`) or the source repo root. Both layouts keep
 * pan-wizard-core/ at that level, so this resolves correctly in either.
 *
 * Why this exists rather than defaulting to cwd: the dispatcher used
 * `--source-root || cwd`, which is only right when cwd IS the PAN source repo. In
 * a real install cwd is the user's project, where pan-wizard-core/learnings/ does
 * not exist — so `learn topics-for` returned zero topics from a store holding
 * dozens, `learn lint` reported PASS on a store it never opened, and
 * `build-index` crashed. Twenty-five shipped instruction sites across the
 * exec/plan/verify workflows tell agents to run these commands from the project
 * root, and none passes --source-root, so every one of them silently got nothing.
 * Mirrors skill-align.cjs resolveSkillRoot() and experiment.cjs PAN_SOURCE_ROOT.
 */
function resolveLearningsRoot() {
  return path.resolve(__dirname, '..', '..', '..');
}

function getLearningsDir(sourceRoot, scope) {
  return path.join(sourceRoot, 'pan-wizard-core', 'learnings', scope);
}

function readTopicFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!fmMatch) return { frontmatter: { patterns: [] }, body: content };
  const fmText = fmMatch[1];
  const body = fmMatch[2];
  const fm = parseFrontmatter(fmText);
  return { frontmatter: fm, body };
}

function parseFrontmatter(text) {
  const out = { topic: '', last_updated: '', patterns: [] };
  const lines = text.split('\n');
  let inPatterns = false;
  let current = null;
  for (const line of lines) {
    if (line === 'patterns:') { inPatterns = true; continue; }
    if (!inPatterns) {
      const m = line.match(/^([a-z_]+):\s*(.*)$/);
      if (m) out[m[1]] = m[2].trim();
      continue;
    }
    if (line.startsWith('  - id:')) {
      if (current) out.patterns.push(current);
      current = { id: line.replace(/^\s*- id:\s*/, '').trim() };
    } else if (current) {
      const m = line.match(/^\s+([a-z_]+):\s*(.*)$/);
      if (m) {
        const key = m[1];
        let val = m[2].trim();
        if (val.startsWith('[') && val.endsWith(']')) {
          val = val.slice(1, -1).split(',').map(s => s.trim()).filter(Boolean);
        }
        current[key] = val;
      }
    }
  }
  if (current) out.patterns.push(current);
  return out;
}

/**
 * Walk both scopes and collect every pattern with full body context.
 */
function collectAllPatterns(sourceRoot) {
  const all = [];
  for (const scope of VALID_SCOPES) {
    const dir = getLearningsDir(sourceRoot, scope);
    let files;
    try {
      files = fs.readdirSync(dir).filter(f => f.endsWith('.md') && f !== 'README.md');
    } catch {
      continue;
    }
    for (const file of files) {
      const filePath = path.join(dir, file);
      const { frontmatter, body } = readTopicFile(filePath);
      const topic = file.replace(/\.md$/, '');
      for (const p of frontmatter.patterns) {
        const patternBody = extractPatternBody(body, p.id);
        all.push({
          id: p.id,
          scope,
          topic,
          file: filePath,
          summary: p.summary || '',
          source_experiments: Array.isArray(p.source_experiments) ? p.source_experiments : [],
          superseded_by: p.superseded_by || null,
          superseded_id: p.superseded_id || null,
          body: patternBody,
        });
      }
    }
  }
  return all;
}

/**
 * Find a pattern's narrative body (the section between `## P-XXX —` and the
 * next `## ` or end of file).
 */
function extractPatternBody(fileBody, patternId) {
  const escaped = patternId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(^|\\n)## ${escaped}[\\s\\S]*?(?=\\n## [A-Z]|$)`, 'i');
  const m = fileBody.match(re);
  return m ? m[0] : '';
}

/**
 * Extract a single named bold-field section from a pattern body.
 * Returns text between `**Field:**` and the next `**Other:**` block.
 */
function extractFieldSection(body, field) {
  const re = new RegExp(`\\*\\*${field}:\\*\\*([\\s\\S]*?)(?=\\n\\*\\*[A-Z]|$)`, 'i');
  const m = body.match(re);
  return m ? m[1].trim() : '';
}

const KNOWN_EXPERIMENT_TOKENS = [
  'notepadrs',
  'whoolog', 'whoocache', 'whooflow', 'whooschema', 'whoodb',
  'whoorun', 'whoograph', 'whoocsv', 'whoodag', 'whoodiff',
  'whooemoji', 'whoohash', 'whoolen', 'whoosort', 'whooo',
  'panloop', 'panloop2', 'panmd2', 'panmd3', 'panrhi',
];

const PAN_INTERNAL_TERMS = [
  /\bPAN(?:'s)?\b/,
  /\bv3\.\d+(\.\d+)?/,
  /\bpan-wizard-core\b/,
  /\bpan-tools\b/,
  /\b\.planning\//,
  /\bpan-(?:planner|executor|verifier|reviewer)\b/,
];

const PATTERN_REF_RE = /\bP-(?:[A-Z]+-)?\d+(?:-r\d+)?\b/g;

/**
 * Run all integrity checks on the collected patterns.
 *
 * Returns:
 *   {
 *     violations: [{ code, severity, pattern_id, file, message, ... }],
 *     pattern_count, file_count, scopes
 *   }
 */
function lintPatterns(patterns) {
  const violations = [];

  const idIndex = new Map(); // id -> [{scope, topic, file}, ...]
  for (const p of patterns) {
    if (!idIndex.has(p.id)) idIndex.set(p.id, []);
    idIndex.get(p.id).push({ scope: p.scope, topic: p.topic, file: p.file });
  }

  for (const [id, locations] of idIndex.entries()) {
    if (locations.length > 1) {
      violations.push({
        code: 'L-001',
        severity: 'error',
        pattern_id: id,
        message: `Pattern ID "${id}" defined in ${locations.length} places`,
        locations,
      });
    }
  }

  const knownIds = new Set(idIndex.keys());

  for (const p of patterns) {
    const refs = (p.body.match(PATTERN_REF_RE) || []).filter(r => r !== p.id);
    const dangling = [...new Set(refs)].filter(r => !knownIds.has(r));
    for (const ref of dangling) {
      violations.push({
        code: 'L-002',
        severity: 'error',
        pattern_id: p.id,
        file: p.file,
        message: `Pattern "${p.id}" references "${ref}" which is not defined in any topic file`,
        dangling_ref: ref,
      });
    }
  }

  for (const p of patterns) {
    if (p.source_experiments.length > 0) continue;
    const lower = p.body.toLowerCase();
    const cited = KNOWN_EXPERIMENT_TOKENS.filter(t => lower.includes(t.toLowerCase()));
    if (cited.length > 0) {
      violations.push({
        code: 'L-003',
        severity: 'warning',
        pattern_id: p.id,
        file: p.file,
        message: `Pattern "${p.id}" cites experiment(s) ${JSON.stringify(cited)} in evidence prose but source_experiments frontmatter is empty`,
        cited_experiments: cited,
      });
    }
  }

  for (const p of patterns) {
    if (p.scope !== 'universal') continue;
    const ruleSection = extractFieldSection(p.body, 'Rule');
    const headingMatch = p.body.match(/^\s*##\s+([^\n]+)/m);
    const heading = headingMatch ? headingMatch[1] : '';
    const scanText = `${heading}\n${ruleSection}`;
    const matches = [];
    for (const re of PAN_INTERNAL_TERMS) {
      const m = scanText.match(re);
      if (m) matches.push(m[0]);
    }
    if (matches.length > 0) {
      violations.push({
        code: 'L-004',
        severity: 'warning',
        pattern_id: p.id,
        file: p.file,
        message: `Universal-scope pattern "${p.id}" mentions PAN-internal terms ${JSON.stringify([...new Set(matches)])} in heading or Rule section — candidate for internal/ scope`,
        terms: [...new Set(matches)],
      });
    }
  }

  for (const p of patterns) {
    const revMatch = p.id.match(/^(P-[A-Z0-9]+(?:-[A-Z0-9]+)?)-r(\d+)$/);
    if (!revMatch) continue;
    const baseId = revMatch[1];
    const revNum = revMatch[2];
    const basePattern = patterns.find(x => x.file === p.file && x.id === baseId);
    if (!basePattern) continue;
    const hasSupersession = basePattern.superseded_by || basePattern.superseded_id || /supersed/i.test(basePattern.body);
    if (!hasSupersession) {
      violations.push({
        code: 'L-005',
        severity: 'warning',
        pattern_id: p.id,
        file: p.file,
        message: `Revision pattern "${p.id}" exists but base "${baseId}" has no superseded_by field in frontmatter`,
        base_id: baseId,
        revision: revNum,
      });
    }
  }

  // L-006: a universal-scope pattern citing an INTERNAL pattern id.
  //
  // This is the only rule that must run in the source repo to catch a defect that
  // only manifests after install. `internal/` is stripped when PAN is installed, so
  // a universal topic citing an internal id resolves fine here — where both scopes
  // are present — and becomes a dangling L-002 reference on every user's machine.
  // That is exactly what shipped: universal/concurrency.md cited P-1402 from
  // internal/pan-dev-bugs.md, so `learn lint` FAILED in every install while passing
  // in the repo, making the integrity gate un-greenable for users and invisible to us.
  // Checking scope-crossing directly, rather than waiting for the reference to
  // dangle, is what makes it catchable before release.
  const internalIds = new Set(patterns.filter(p => p.scope === 'internal').map(p => p.id));
  if (internalIds.size > 0) {
    for (const p of patterns) {
      if (p.scope !== 'universal') continue;
      const refs = [...new Set(p.body.match(PATTERN_REF_RE) || [])].filter(r => r !== p.id);
      for (const ref of refs.filter(r => internalIds.has(r))) {
        violations.push({
          code: 'L-006',
          severity: 'error',
          pattern_id: p.id,
          file: p.file,
          message: `Universal pattern "${p.id}" cites internal pattern "${ref}" — internal/ is stripped at install time, so this becomes a dangling reference in every install`,
          internal_ref: ref,
        });
      }
    }
  }

  return {
    violations,
    pattern_count: patterns.length,
    file_count: new Set(patterns.map(p => p.file)).size,
    scopes: VALID_SCOPES,
  };
}

/**
 * CLI entry: lint the learnings store.
 *
 * @param {string} sourceRoot
 * @param {object} opts - { scope?: 'universal'|'internal', strict?: boolean }
 */
function cmdLearnLint(sourceRoot, opts = {}) {
  const all = collectAllPatterns(sourceRoot);
  const filtered = opts.scope
    ? all.filter(p => p.scope === opts.scope)
    : all;
  const result = lintPatterns(filtered);

  const errors = result.violations.filter(v => v.severity === 'error').length;
  const warnings = result.violations.filter(v => v.severity === 'warning').length;

  result.summary = {
    total_violations: result.violations.length,
    errors,
    warnings,
    status: errors > 0 || (opts.strict && warnings > 0) ? 'fail' : 'pass',
  };

  return result;
}

module.exports = {
  cmdLearnLint,
  resolveLearningsRoot,
  collectAllPatterns,
  lintPatterns,
  extractPatternBody,
  extractFieldSection,
  KNOWN_EXPERIMENT_TOKENS,
};
