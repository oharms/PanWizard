'use strict';
// @pan: ADR-0027
/**
 * Links — Doc–Code link graph scanner and lint.
 *
 * Implements ADR-0027 (Doc–Code Link Graph).
 * Spec: docs/specs/doc_code_link_graph_featureai.md
 *
 * Three lint passes share one walk pair:
 *   - Forward links: inline [[<id>]] in body + must_haves.key_links in frontmatter.
 *   - Backlink contract: docs with `require-code-mention: true` must have at
 *     least one resolving @pan: anchor.
 *   - Anchor-target existence: every @pan: anchor must resolve to a real doc.
 */

const fs = require('fs');
const path = require('path');
const { safeReadFile, toPosix, output } = require('./core.cjs');
const { extractFrontmatter, parseMustHavesBlock } = require('./frontmatter.cjs');
const { walkMarkdownFiles } = require('./doc-lint/walk.js');

const DEFAULT_DOC_ROOTS = [
  'docs',
  'pan-wizard-core/workflows',
  'pan-wizard-core/templates',
  'pan-wizard-core/references',
  'pan-wizard-core/learnings',
  'commands',
  'agents',
];

const DEFAULT_SOURCE_ROOTS = [
  'pan-wizard-core',
  'bin',
  'hooks',
  'scripts',
];

const SOURCE_EXT_TO_LEADER = {
  '.cjs':  '//',
  '.js':   '//',
  '.mjs':  '//',
  '.ts':   '//',
  '.sh':   '#',
  '.py':   '#',
  '.ps1':  '#',
  '.md':   '<!--',
  '.html': '<!--',
};

const ANCHOR_RES = {
  '//':   /^\s*\/\/\s*@pan:\s*([^\s].*?)\s*$/,
  '#':    /^\s*#\s*@pan:\s*([^\s].*?)\s*$/,
  '<!--': /^\s*<!--\s*@pan:\s*([^\s].*?)\s*(?:-->)?\s*$/,
};

const INLINE_LINK_RE = /\[\[([^\[\]\s|][^\[\]]*?)\]\]/g;
const ADR_SHORT_RE = /^ADR-(\d{4})$/i;

const SKIP_DIR_NAMES = new Set(['node_modules', '.git', 'dist', '.cache', 'coverage']);

// ─── Doc-id resolver ─────────────────────────────────────────────────────────

function slugify(s) {
  return String(s).toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
}

function fileHasSection(filePath, section) {
  const content = safeReadFile(filePath);
  if (!content) return false;
  const target = slugify(section);
  const lines = content.split('\n');
  for (const line of lines) {
    const m = line.match(/^#{1,6}\s+(.+?)\s*$/);
    if (m && slugify(m[1]) === target) return true;
  }
  return false;
}

function resolveDocId(rawId, cwd) {
  if (!rawId || !rawId.trim()) return { resolved: false, reason: 'empty id' };
  let id = rawId.trim();
  let section = null;
  const hashIdx = id.indexOf('#');
  if (hashIdx !== -1) {
    section = id.slice(hashIdx + 1).trim();
    id = id.slice(0, hashIdx).trim();
  }

  // ADR-NNNN shortcut → glob docs/decisions/ADR-NNNN-*.md
  const adrMatch = id.match(ADR_SHORT_RE);
  if (adrMatch) {
    const num = adrMatch[1];
    const decisionsDir = path.join(cwd, 'docs', 'decisions');
    let entries = [];
    try {
      entries = fs.readdirSync(decisionsDir);
    } catch {
      return { resolved: false, reason: 'docs/decisions/ not found' };
    }
    const candidates = entries.filter(f =>
      f.toLowerCase().startsWith(`adr-${num}-`) && f.endsWith('.md')
    );
    if (candidates.length === 0) {
      return { resolved: false, reason: `no ADR-${num}-*.md found` };
    }
    if (candidates.length > 1) {
      return { resolved: false, reason: `ambiguous ADR-${num}: ${candidates.join(', ')}` };
    }
    const relPath = toPosix(path.join('docs', 'decisions', candidates[0]));
    if (section) {
      const fullPath = path.join(cwd, 'docs', 'decisions', candidates[0]);
      if (fileHasSection(fullPath, section)) {
        return { resolved: true, path: relPath, section };
      }
      return { resolved: true, path: relPath, section, sectionMissing: true };
    }
    return { resolved: true, path: relPath };
  }

  // Direct .md path
  if (id.endsWith('.md')) {
    const fullPath = path.join(cwd, id);
    try { fs.accessSync(fullPath); }
    catch { return { resolved: false, reason: `${id} not found` }; }
    if (section) {
      if (fileHasSection(fullPath, section)) {
        return { resolved: true, path: toPosix(id), section };
      }
      return { resolved: true, path: toPosix(id), section, sectionMissing: true };
    }
    return { resolved: true, path: toPosix(id) };
  }

  // Try <id>.md, then <id>/README.md
  const candidates = [`${id}.md`, path.join(id, 'README.md')];
  for (const cand of candidates) {
    const fullPath = path.join(cwd, cand);
    try {
      fs.accessSync(fullPath);
      const relCand = toPosix(cand);
      if (section) {
        if (fileHasSection(fullPath, section)) {
          return { resolved: true, path: relCand, section };
        }
        return { resolved: true, path: relCand, section, sectionMissing: true };
      }
      return { resolved: true, path: relCand };
    } catch { /* try next */ }
  }
  return { resolved: false, reason: `${id} (tried ${id}.md and ${id}/README.md)` };
}

// ─── Forward-link scanner ────────────────────────────────────────────────────

function stripInlineCodeSpans(line) {
  // Replace `...` spans (and ``...`` etc.) with placeholders so [[...]] inside
  // backticks is not picked up as a real link.
  return line.replace(/(`+)([^`]|(?!\1)`)*?\1/g, m => ' '.repeat(m.length));
}

function parseInlineLinks(text) {
  const out = [];
  const lines = text.split('\n');
  let inFence = false;
  let fenceMarker = '';
  let inFrontmatter = false;
  let frontmatterDone = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Skip leading YAML frontmatter (--- on line 1, then content, then closing ---).
    // Only the leading block; subsequent --- in body is unaffected.
    if (i === 0 && line.trim() === '---') { inFrontmatter = true; continue; }
    if (inFrontmatter && !frontmatterDone) {
      if (line.trim() === '---') { inFrontmatter = false; frontmatterDone = true; }
      continue;
    }
    // Toggle fenced-code-block state on lines opening/closing ``` or ~~~
    const fenceMatch = line.match(/^(\s{0,3})(```+|~~~+)(.*)$/);
    if (fenceMatch) {
      const marker = fenceMatch[2];
      if (!inFence) { inFence = true; fenceMarker = marker[0]; continue; }
      if (marker[0] === fenceMarker) { inFence = false; fenceMarker = ''; continue; }
    }
    if (inFence) continue;
    const stripped = stripInlineCodeSpans(line);
    INLINE_LINK_RE.lastIndex = 0;
    let m;
    while ((m = INLINE_LINK_RE.exec(stripped)) !== null) {
      out.push({ rawId: m[1].trim(), line: i + 1 });
    }
  }
  return out;
}

function safeWalkDocs(rootAbs) {
  try {
    return walkMarkdownFiles(rootAbs, { exclude: ['**/node_modules/**'] });
  } catch {
    return null;
  }
}

function scanForwardLinks(docRoots, cwd) {
  const out = [];
  for (const root of docRoots) {
    const fullDir = path.isAbsolute(root) ? root : path.join(cwd, root);
    const files = safeWalkDocs(fullDir);
    if (!files) continue;
    for (const file of files) {
      if (file.readError) continue;
      const relPath = toPosix(path.relative(cwd, file.path));
      for (const link of parseInlineLinks(file.content)) {
        out.push({
          source: relPath,
          sourceLine: link.line,
          rawId: link.rawId,
          via: 'inline',
        });
      }
      try {
        const keyLinks = parseMustHavesBlock(file.content, 'key_links');
        for (const link of keyLinks) {
          if (typeof link === 'string') continue;
          out.push({
            source: relPath,
            sourceLine: 0,
            rawId: link.to || '',
            via: 'key_links',
            from: link.from || '',
            pattern: link.pattern || '',
          });
        }
      } catch { /* malformed frontmatter — skip */ }
    }
  }
  return out;
}

// ─── Source-anchor scanner ───────────────────────────────────────────────────

function leaderForFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return SOURCE_EXT_TO_LEADER[ext] || null;
}

function parseAnchorLine(line, leader) {
  const re = ANCHOR_RES[leader];
  if (!re) return null;
  const m = line.match(re);
  return m ? m[1].trim() : null;
}

function walkSourceFiles(rootDir, out) {
  let entries;
  try {
    entries = fs.readdirSync(rootDir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIP_DIR_NAMES.has(entry.name)) continue;
      walkSourceFiles(path.join(rootDir, entry.name), out);
      continue;
    }
    if (!entry.isFile()) continue;
    const leader = leaderForFile(entry.name);
    if (!leader) continue;
    out.push({ path: path.join(rootDir, entry.name), leader });
  }
}

function scanAnchors(sourceRoots, cwd) {
  const out = [];
  const files = [];
  for (const root of sourceRoots) {
    const fullDir = path.isAbsolute(root) ? root : path.join(cwd, root);
    walkSourceFiles(fullDir, files);
  }
  for (const { path: fp, leader } of files) {
    const content = safeReadFile(fp);
    if (!content) continue;
    const lines = content.split('\n');
    const relPath = toPosix(path.relative(cwd, fp));
    for (let i = 0; i < lines.length; i++) {
      const id = parseAnchorLine(lines[i], leader);
      if (id !== null) {
        out.push({ source: relPath, sourceLine: i + 1, rawId: id, leader });
      }
    }
  }
  return out;
}

// ─── Lint passes ─────────────────────────────────────────────────────────────

function runForwardPass(forwardLinks, cwd) {
  const findings = [];
  for (const link of forwardLinks) {
    if (link.via === 'inline') {
      const r = resolveDocId(link.rawId, cwd);
      if (!r.resolved) {
        findings.push({
          code: 'F-001',
          severity: 'error',
          source: link.source,
          source_line: link.sourceLine,
          target: link.rawId,
          detail: r.reason || 'unresolved',
        });
      } else if (r.sectionMissing) {
        findings.push({
          code: 'F-002',
          severity: 'error',
          source: link.source,
          source_line: link.sourceLine,
          target: link.rawId,
          detail: `Section "#${r.section}" not found in ${r.path}`,
        });
      }
      continue;
    }
    if (link.via === 'key_links') {
      if (link.from) {
        try { fs.accessSync(path.join(cwd, link.from)); }
        catch {
          findings.push({
            code: 'F-003', severity: 'warning',
            source: link.source, source_line: 0, target: link.from,
            detail: `key_links.from path does not exist: ${link.from}`,
          });
        }
      }
      if (link.rawId) {
        try { fs.accessSync(path.join(cwd, link.rawId)); }
        catch {
          findings.push({
            code: 'F-003', severity: 'warning',
            source: link.source, source_line: 0, target: link.rawId,
            detail: `key_links.to path does not exist: ${link.rawId}`,
          });
        }
      }
      if (link.pattern) {
        try { new RegExp(link.pattern); }
        catch (e) {
          findings.push({
            code: 'F-004', severity: 'warning',
            source: link.source, source_line: 0, target: link.rawId,
            detail: `Invalid regex in key_links.pattern: ${e.message}`,
          });
        }
      }
    }
  }
  return findings;
}

function runBacklinkPass(docRoots, anchors, cwd) {
  const findings = [];

  // Index: resolved doc path → array of anchor source files
  const anchorIdx = new Map();
  for (const a of anchors) {
    const r = resolveDocId(a.rawId, cwd);
    if (!r.resolved) continue;
    if (!anchorIdx.has(r.path)) anchorIdx.set(r.path, []);
    anchorIdx.get(r.path).push(a.source);
  }

  for (const root of docRoots) {
    const fullDir = path.isAbsolute(root) ? root : path.join(cwd, root);
    const files = safeWalkDocs(fullDir);
    if (!files) continue;
    for (const file of files) {
      if (file.readError) continue;
      const fm = extractFrontmatter(file.content);
      const requireMention = fm['require-code-mention'];
      if (requireMention !== true && requireMention !== 'true') continue;
      const relPath = toPosix(path.relative(cwd, file.path));
      const sources = anchorIdx.get(relPath) || [];
      if (sources.length === 0) {
        findings.push({
          code: 'B-001', severity: 'error',
          source: relPath, source_line: 0, target: null,
          detail: 'require-code-mention is true but no @pan: anchors resolve to this doc',
        });
        continue;
      }
      const unique = new Set(sources);
      if (unique.size === 1) {
        findings.push({
          code: 'B-002', severity: 'warning',
          source: relPath, source_line: 0, target: [...unique][0],
          detail: `Only one source file anchors this doc (${[...unique][0]})`,
        });
      }
    }
  }
  return findings;
}

function runAnchorTargetPass(anchors, cwd) {
  const findings = [];
  for (const a of anchors) {
    if (!a.rawId) {
      findings.push({
        code: 'A-004', severity: 'warning',
        source: a.source, source_line: a.sourceLine,
        target: null, detail: '@pan: anchor has empty id',
      });
      continue;
    }
    const r = resolveDocId(a.rawId, cwd);
    if (!r.resolved) {
      findings.push({
        code: 'A-001', severity: 'error',
        source: a.source, source_line: a.sourceLine,
        target: a.rawId, detail: r.reason || 'unresolved',
      });
    } else if (r.sectionMissing) {
      findings.push({
        code: 'A-002', severity: 'warning',
        source: a.source, source_line: a.sourceLine,
        target: a.rawId,
        detail: `Section "#${r.section}" not found in ${r.path}`,
      });
    }
  }
  return findings;
}

function countBacklinkContracts(docRoots, cwd) {
  let n = 0;
  for (const root of docRoots) {
    const fullDir = path.isAbsolute(root) ? root : path.join(cwd, root);
    const files = safeWalkDocs(fullDir);
    if (!files) continue;
    for (const file of files) {
      if (file.readError) continue;
      const fm = extractFrontmatter(file.content);
      const v = fm['require-code-mention'];
      if (v === true || v === 'true') n++;
    }
  }
  return n;
}

function countDocFiles(docRoots, cwd) {
  let n = 0;
  for (const root of docRoots) {
    const fullDir = path.isAbsolute(root) ? root : path.join(cwd, root);
    const files = safeWalkDocs(fullDir);
    if (files) n += files.length;
  }
  return n;
}

function countSourceFiles(sourceRoots, cwd) {
  const acc = [];
  for (const root of sourceRoots) {
    const fullDir = path.isAbsolute(root) ? root : path.join(cwd, root);
    walkSourceFiles(fullDir, acc);
  }
  return acc.length;
}

// ─── Top-level validateAll ───────────────────────────────────────────────────

function validateAll(cwd, opts = {}) {
  const docRoots = opts.docRoots || DEFAULT_DOC_ROOTS;
  const sourceRoots = opts.sourceRoots || DEFAULT_SOURCE_ROOTS;
  const strict = !!opts.strict;

  const forwardLinks = scanForwardLinks(docRoots, cwd);
  const anchors = scanAnchors(sourceRoots, cwd);

  const findings = [];
  findings.push(...runForwardPass(forwardLinks, cwd));
  findings.push(...runBacklinkPass(docRoots, anchors, cwd));
  findings.push(...runAnchorTargetPass(anchors, cwd));

  const errors = findings.filter(f => f.severity === 'error').length;
  const warnings = findings.filter(f => f.severity === 'warning').length;
  // Per spec §5.2: B-002 is informational and does not flip status under --strict.
  const strictWarnings = findings.filter(f => f.severity === 'warning' && f.code !== 'B-002').length;
  let status;
  if (errors > 0) status = 'fail';
  else if (strict && strictWarnings > 0) status = 'fail';
  else status = 'pass';

  return {
    ok: status === 'pass',
    summary: {
      total_findings: findings.length,
      errors,
      warnings,
      status,
      doc_files_scanned: countDocFiles(docRoots, cwd),
      source_files_scanned: countSourceFiles(sourceRoots, cwd),
      anchors_found: anchors.length,
      forward_links_found: forwardLinks.length,
      backlink_contracts_checked: countBacklinkContracts(docRoots, cwd),
    },
    findings,
  };
}

function cmdLinksValidate(cwd, opts = {}) {
  const result = validateAll(cwd, opts);
  // Bypass core.output() because it unconditionally exits 0; we need exit 1
  // when status is "fail" so CI / hooks can detect violations.
  if (opts.raw) {
    const lines = [
      `Links: ${result.summary.status.toUpperCase()}`,
      ``,
      `Doc files scanned:    ${result.summary.doc_files_scanned}`,
      `Source files scanned: ${result.summary.source_files_scanned}`,
      `Forward links:        ${result.summary.forward_links_found}`,
      `Anchors:              ${result.summary.anchors_found}`,
      `Backlink contracts:   ${result.summary.backlink_contracts_checked}`,
      ``,
      `Errors:   ${result.summary.errors}`,
      `Warnings: ${result.summary.warnings}`,
      ``,
    ];
    for (const f of result.findings) {
      const where = f.source_line ? `${f.source}:${f.source_line}` : f.source;
      lines.push(`[${f.severity.toUpperCase()}] ${f.code} ${where}: ${f.detail}`);
    }
    process.stdout.write(lines.join('\n'));
  } else {
    process.stdout.write(JSON.stringify(result, null, 2));
  }
  process.exit(result.summary.status === 'fail' ? 1 : 0);
}

module.exports = {
  validateAll,
  cmdLinksValidate,
  scanForwardLinks,
  scanAnchors,
  resolveDocId,
  parseAnchorLine,
  parseInlineLinks,
  DEFAULT_DOC_ROOTS,
  DEFAULT_SOURCE_ROOTS,
};
