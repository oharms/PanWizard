'use strict';

const fs = require('fs');
const path = require('path');
const { output, error, safeReadFile } = require('./core.cjs');

const PLANNING_DIR = '.planning';
const MEMORY_DIR = path.join(PLANNING_DIR, 'memory');
const PATTERNS_FILE = 'distill-patterns.md';

const SAFETY_TIERS = { SAFE: 'safe', REVIEW: 'review_required', RISKY: 'risky' };
const DEFAULT_BLOAT_THRESHOLD = 2.0;
const MAX_FUNCTION_LOC = 50;
const MAX_PARAM_COUNT = 4;
const MAX_NESTING_DEPTH = 3;
const MIN_REPEATED_LINES = 5;
const PATTERN_TTL_DAYS = 90;
const MAX_PATTERNS_KEPT = 100;

const SCANNABLE_EXTS = ['.js', '.cjs', '.mjs', '.ts', '.tsx', '.jsx', '.py'];

// ─── Pass 1: Deterministic static analysis ───────────────────────────────────

function findPhantomTryCatch(content, filePath) {
  const findings = [];
  const re = /try\s*\{\s*(?:return\s+)?(JSON\.parse|JSON\.stringify|Number|String|Boolean|parseInt|parseFloat)\([^)]*\)\s*;?\s*\}\s*catch/g;
  let match;
  while ((match = re.exec(content)) !== null) {
    const line = content.slice(0, match.index).split('\n').length;
    findings.push({
      pattern: 'phantom_try_catch',
      file: filePath,
      line,
      span: match[0].slice(0, 80),
      tier: SAFETY_TIERS.REVIEW,
      loc_saved: 4,
      confidence: 0.9,
      message: `Phantom try/catch around ${match[1]}() — does not throw in this form`,
    });
  }
  return findings;
}

function findUnusedImports(content, filePath) {
  const findings = [];
  const importRe = /^(?:const|let|var)\s+\{?\s*([\w,\s]+)\s*\}?\s*=\s*require\(['"]([^'"]+)['"]\)/gm;
  const esImportRe = /^import\s+(?:\{?\s*([\w,\s]+)\s*\}?\s*from\s+)?['"]([^'"]+)['"]/gm;
  const collected = [];
  let m;
  while ((m = importRe.exec(content)) !== null) collected.push({ names: m[1], line: content.slice(0, m.index).split('\n').length });
  while ((m = esImportRe.exec(content)) !== null) {
    if (m[1]) collected.push({ names: m[1], line: content.slice(0, m.index).split('\n').length });
  }
  // Strip string literals so 'fs' inside require('fs') doesn't count as a use of fs
  const stripped = content.replace(/(['"])(?:\\.|(?!\1).)*\1/g, '""');
  for (const imp of collected) {
    const names = imp.names.split(',').map(s => s.trim()).filter(Boolean);
    for (const name of names) {
      const cleanName = name.replace(/\s+as\s+\w+/, '').trim();
      if (!cleanName) continue;
      const usageRe = new RegExp('\\b' + cleanName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'g');
      const uses = (stripped.match(usageRe) || []).length;
      if (uses <= 1) {
        findings.push({
          pattern: 'unused_import',
          file: filePath,
          line: imp.line,
          span: cleanName,
          tier: SAFETY_TIERS.SAFE,
          loc_saved: 1,
          confidence: 0.95,
          message: `Unused import: ${cleanName}`,
        });
      }
    }
  }
  return findings;
}

function findMagicNumbers(content, filePath) {
  const findings = [];
  const numberRe = /(?<!\w)(\d{3,})(?!\w)/g;
  const occurrences = {};
  let m;
  while ((m = numberRe.exec(content)) !== null) {
    const num = m[1];
    if (num === '100' || num === '1000') continue;
    if (!occurrences[num]) occurrences[num] = [];
    occurrences[num].push(content.slice(0, m.index).split('\n').length);
  }
  for (const [num, lines] of Object.entries(occurrences)) {
    if (lines.length >= 3) {
      findings.push({
        pattern: 'magic_number',
        file: filePath,
        line: lines[0],
        span: num,
        tier: SAFETY_TIERS.SAFE,
        loc_saved: 0,
        confidence: 0.85,
        message: `Magic number ${num} used ${lines.length}x — extract to named constant`,
      });
    }
  }
  return findings;
}

function findLongFunctions(content, filePath) {
  const findings = [];
  const fnRe = /(?:^|\n)\s*(?:async\s+)?function\s+(\w+)\s*\([^)]*\)\s*\{/g;
  let m;
  while ((m = fnRe.exec(content)) !== null) {
    const startLine = content.slice(0, m.index).split('\n').length;
    let depth = 0;
    let i = m.index + m[0].length - 1;
    let lineCount = 0;
    for (; i < content.length; i++) {
      if (content[i] === '{') depth++;
      else if (content[i] === '}') { depth--; if (depth === 0) break; }
      else if (content[i] === '\n') lineCount++;
    }
    if (lineCount > MAX_FUNCTION_LOC) {
      findings.push({
        pattern: 'long_function',
        file: filePath,
        line: startLine,
        span: m[1],
        tier: SAFETY_TIERS.REVIEW,
        loc_saved: Math.floor(lineCount * 0.3),
        confidence: 0.75,
        message: `Function ${m[1]}() is ${lineCount} LOC (limit ${MAX_FUNCTION_LOC}) — decompose`,
      });
    }
  }
  return findings;
}

function findWideParamLists(content, filePath) {
  const findings = [];
  const fnRe = /(?:^|\n)\s*(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)/g;
  let m;
  while ((m = fnRe.exec(content)) !== null) {
    const params = m[2].split(',').map(s => s.trim()).filter(Boolean);
    if (params.length > MAX_PARAM_COUNT) {
      findings.push({
        pattern: 'wide_params',
        file: filePath,
        line: content.slice(0, m.index).split('\n').length,
        span: m[1],
        tier: SAFETY_TIERS.REVIEW,
        loc_saved: 0,
        confidence: 0.85,
        message: `Function ${m[1]}() has ${params.length} params (limit ${MAX_PARAM_COUNT}) — use opts object`,
      });
    }
  }
  return findings;
}

// ─── Pass 2: AST-style structural analysis ───────────────────────────────────

function findSingleInstanceFactories(content, filePath) {
  const findings = [];
  const classRe = /class\s+(\w+Factory)\s*\{[^}]*\}/g;
  let m;
  while ((m = classRe.exec(content)) !== null) {
    const className = m[1];
    const usageRe = new RegExp('new\\s+' + className + '\\b', 'g');
    const instances = (content.match(usageRe) || []).length;
    if (instances <= 1) {
      findings.push({
        pattern: 'single_instance_factory',
        file: filePath,
        line: content.slice(0, m.index).split('\n').length,
        span: className,
        tier: SAFETY_TIERS.REVIEW,
        loc_saved: 5,
        confidence: 0.7,
        message: `${className} is instantiated ${instances}x — replace with module function`,
      });
    }
  }
  return findings;
}

function findDeepNesting(content, filePath) {
  const findings = [];
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const indent = lines[i].match(/^(\s*)/)[1].length;
    const depth = Math.floor(indent / 2);
    if (depth > MAX_NESTING_DEPTH && lines[i].trim().match(/^(if|for|while|switch)\b/)) {
      findings.push({
        pattern: 'deep_nesting',
        file: filePath,
        line: i + 1,
        span: lines[i].trim().slice(0, 50),
        tier: SAFETY_TIERS.REVIEW,
        loc_saved: 2,
        confidence: 0.7,
        message: `Nesting depth ${depth} (limit ${MAX_NESTING_DEPTH}) — extract to function or use early return`,
      });
    }
  }
  return findings;
}

// ─── Pass 3: Graph-based cross-file analysis ─────────────────────────────────

function findRepeatedBlocks(filesContent) {
  const findings = [];
  const blockMap = {};
  for (const [filePath, content] of Object.entries(filesContent)) {
    const lines = content.split('\n');
    for (let i = 0; i + MIN_REPEATED_LINES <= lines.length; i++) {
      const block = lines.slice(i, i + MIN_REPEATED_LINES).map(l => l.trim()).join('\n');
      if (block.length < 50 || block.includes('//')) continue;
      if (!blockMap[block]) blockMap[block] = [];
      blockMap[block].push({ file: filePath, line: i + 1 });
    }
  }
  for (const [block, locations] of Object.entries(blockMap)) {
    const uniqueFiles = new Set(locations.map(l => l.file));
    if (locations.length >= 2 && uniqueFiles.size >= 2) {
      findings.push({
        pattern: 'repeated_block',
        file: locations[0].file,
        line: locations[0].line,
        span: block.slice(0, 80),
        tier: SAFETY_TIERS.REVIEW,
        loc_saved: MIN_REPEATED_LINES * (locations.length - 1),
        confidence: 0.8,
        locations,
        message: `Block of ${MIN_REPEATED_LINES} lines repeated ${locations.length}x across ${uniqueFiles.size} files — extract helper`,
      });
    }
  }
  return findings;
}

function findUnreferencedExports(filesContent) {
  const findings = [];
  const exports = {};
  const allContent = Object.values(filesContent).join('\n');
  for (const [filePath, content] of Object.entries(filesContent)) {
    const exportRe = /(?:^|\n)\s*(?:module\.exports\s*=\s*\{[^}]*?(\w+)|exports\.(\w+)\s*=|export\s+(?:const|function|class)\s+(\w+))/g;
    let m;
    while ((m = exportRe.exec(content)) !== null) {
      const name = m[1] || m[2] || m[3];
      if (!name) continue;
      exports[name] = { file: filePath, line: content.slice(0, m.index).split('\n').length };
    }
  }
  for (const [name, loc] of Object.entries(exports)) {
    const usageRe = new RegExp('\\b' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'g');
    const matches = (allContent.match(usageRe) || []).length;
    if (matches <= 1) {
      findings.push({
        pattern: 'unreferenced_export',
        file: loc.file,
        line: loc.line,
        span: name,
        tier: SAFETY_TIERS.REVIEW,
        loc_saved: 3,
        confidence: 0.85,
        message: `Export ${name} is not referenced outside its file`,
      });
    }
  }
  return findings;
}

// ─── File scanning ────────────────────────────────────────────────────────────

function gatherFiles(cwd, opts) {
  const ignore = (opts && opts.ignore) || ['node_modules', '.git', 'dist', 'build', '.planning', '.claude', '.codex', '.gemini', '.opencode', '.github'];
  const files = [];
  function walk(dir) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (ignore.includes(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && SCANNABLE_EXTS.includes(path.extname(entry.name))) {
        files.push(full);
      }
    }
  }
  walk(cwd);
  return files;
}

function loadFiles(filePaths, cwd) {
  const out = {};
  for (const f of filePaths) {
    const content = safeReadFile(f);
    if (content) out[path.relative(cwd, f).replace(/\\/g, '/')] = content;
  }
  return out;
}

// ─── Main scan: runs all 5 passes ─────────────────────────────────────────────

function distillScan(cwd, opts) {
  const filePaths = gatherFiles(cwd, opts);
  const filesContent = loadFiles(filePaths, cwd);
  const allFindings = [];

  for (const [filePath, content] of Object.entries(filesContent)) {
    allFindings.push(...findPhantomTryCatch(content, filePath));
    allFindings.push(...findUnusedImports(content, filePath));
    allFindings.push(...findMagicNumbers(content, filePath));
    allFindings.push(...findLongFunctions(content, filePath));
    allFindings.push(...findWideParamLists(content, filePath));
    allFindings.push(...findSingleInstanceFactories(content, filePath));
    allFindings.push(...findDeepNesting(content, filePath));
  }
  allFindings.push(...findRepeatedBlocks(filesContent));
  allFindings.push(...findUnreferencedExports(filesContent));

  return {
    findings: allFindings,
    files_scanned: filePaths.length,
    by_pattern: groupByPattern(allFindings),
    by_tier: groupByTier(allFindings),
    total_loc_saved: allFindings.reduce((s, f) => s + (f.loc_saved || 0), 0),
  };
}

function groupByPattern(findings) {
  const map = {};
  for (const f of findings) map[f.pattern] = (map[f.pattern] || 0) + 1;
  return map;
}

function groupByTier(findings) {
  const map = { safe: 0, review_required: 0, risky: 0 };
  for (const f of findings) map[f.tier] = (map[f.tier] || 0) + 1;
  return map;
}

// ─── Bloat budget ────────────────────────────────────────────────────────────

function computeBloatBudget(touchedLoc, findings, threshold) {
  const t = threshold || DEFAULT_BLOAT_THRESHOLD;
  const removableLoc = findings.reduce((s, f) => s + (f.loc_saved || 0), 0);
  const essentialLoc = Math.max(1, touchedLoc - removableLoc);
  const ratio = touchedLoc / essentialLoc;
  return {
    touched_loc: touchedLoc,
    essential_loc: essentialLoc,
    removable_loc: removableLoc,
    ratio: Number(ratio.toFixed(2)),
    threshold: t,
    over_budget: ratio > t,
  };
}

// ─── Pass 5: Cross-session memory ────────────────────────────────────────────

function readPatternsMemory(cwd) {
  const filePath = path.join(cwd, MEMORY_DIR, PATTERNS_FILE);
  const content = safeReadFile(filePath);
  if (!content) return { patterns: [], file: filePath };
  const patterns = [];
  const re = /^- \[(\d{4}-\d{2}-\d{2})\] `([^`]+)` in `([^`]+)`(?:\s*—\s*(.*))?$/gm;
  let m;
  while ((m = re.exec(content)) !== null) {
    patterns.push({ date: m[1], pattern: m[2], file: m[3], note: m[4] || '' });
  }
  return { patterns, file: filePath };
}

function detectRegressedPatterns(currentFindings, memory) {
  const regressed = [];
  for (const f of currentFindings) {
    const prior = memory.patterns.find(p => p.pattern === f.pattern && p.file === f.file);
    if (prior) {
      regressed.push({
        ...f,
        regressed: true,
        previously_resolved: prior.date,
        message: f.message + ` (REGRESSED — last resolved ${prior.date})`,
      });
    }
  }
  return regressed;
}

function writePatternsMemory(cwd, findings, opts) {
  const dir = path.join(cwd, MEMORY_DIR);
  try { fs.mkdirSync(dir, { recursive: true }); } catch {}
  const filePath = path.join(dir, PATTERNS_FILE);
  const existing = readPatternsMemory(cwd).patterns;
  const today = new Date().toISOString().slice(0, 10);
  const cutoff = new Date(Date.now() - PATTERN_TTL_DAYS * 86400000).toISOString().slice(0, 10);

  const fresh = existing.filter(p => p.date >= cutoff);
  const newEntries = findings.map(f => ({
    date: today,
    pattern: f.pattern,
    file: f.file,
    note: f.message ? f.message.slice(0, 60) : '',
  }));

  const dedup = {};
  for (const p of [...fresh, ...newEntries]) {
    dedup[`${p.pattern}:${p.file}`] = p;
  }
  const all = Object.values(dedup).slice(-MAX_PATTERNS_KEPT);

  const lines = [
    '---',
    'name: distill-patterns',
    'description: Cross-session memory of AI-bloat patterns detected and resolved',
    'type: project',
    '---',
    '',
    '## Pattern History',
    '',
    ...all.map(p => `- [${p.date}] \`${p.pattern}\` in \`${p.file}\`${p.note ? ' — ' + p.note : ''}`),
    '',
  ];
  try {
    fs.writeFileSync(filePath, lines.join('\n'), 'utf-8');
    return { written: true, file: filePath, count: all.length };
  } catch (e) {
    return { written: false, error: e.message };
  }
}

// ─── CLI dispatchers ──────────────────────────────────────────────────────────

function cmdDistillScan(cwd, opts, raw) {
  const result = distillScan(cwd, opts);
  output(result, raw, `${result.findings.length} finding(s) across ${result.files_scanned} file(s)`);
}

function cmdDistillAnalyze(cwd, opts, raw) {
  const scan = distillScan(cwd, opts);
  const memory = readPatternsMemory(cwd);
  const regressed = detectRegressedPatterns(scan.findings, memory);
  const touched = (opts && opts.touchedLoc) ? parseInt(opts.touchedLoc, 10) : scan.findings.length * 10;
  const budget = computeBloatBudget(touched, scan.findings, opts && opts.bloatThreshold);
  output({
    ...scan,
    regressed_count: regressed.length,
    regressed,
    bloat_budget: budget,
    memory_file: memory.file,
    prior_patterns: memory.patterns.length,
  }, raw, `${scan.findings.length} findings | bloat ratio: ${budget.ratio}x | regressed: ${regressed.length}`);
}

function cmdDistillReport(cwd, opts, raw) {
  const scan = distillScan(cwd, opts);
  const writeResult = writePatternsMemory(cwd, scan.findings, opts);
  output({
    findings_count: scan.findings.length,
    by_tier: scan.by_tier,
    by_pattern: scan.by_pattern,
    memory: writeResult,
  }, raw, writeResult.written ? `Wrote ${writeResult.count} patterns to ${writeResult.file}` : 'Memory write failed');
}

function cmdDistill(cwd, subcommand, args, raw) {
  const getOpt = (flag, def) => {
    const i = args.indexOf(flag);
    return i !== -1 && i + 1 < args.length ? args[i + 1] : def;
  };
  const opts = {
    bloatThreshold: getOpt('--bloat-threshold', null),
    touchedLoc: getOpt('--touched-loc', null),
  };
  switch (subcommand) {
    case 'scan': return cmdDistillScan(cwd, opts, raw);
    case 'analyze': return cmdDistillAnalyze(cwd, opts, raw);
    case 'report': return cmdDistillReport(cwd, opts, raw);
    default: error('Unknown distill subcommand: ' + subcommand + '. Available: scan, analyze, report');
  }
}

module.exports = {
  cmdDistill,
  cmdDistillScan,
  cmdDistillAnalyze,
  cmdDistillReport,
  distillScan,
  computeBloatBudget,
  readPatternsMemory,
  writePatternsMemory,
  detectRegressedPatterns,
  findPhantomTryCatch,
  findUnusedImports,
  findMagicNumbers,
  findLongFunctions,
  findWideParamLists,
  findSingleInstanceFactories,
  findDeepNesting,
  findRepeatedBlocks,
  findUnreferencedExports,
  SAFETY_TIERS,
  DEFAULT_BLOAT_THRESHOLD,
  MAX_FUNCTION_LOC,
  MAX_PARAM_COUNT,
  MAX_NESTING_DEPTH,
  MIN_REPEATED_LINES,
  PATTERN_TTL_DAYS,
};
