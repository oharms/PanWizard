/**
 * Codebase — Language-aware import analysis, dependency graphs, best-practices detection
 *
 * Zero runtime dependencies: uses regex-based parsing only (no AST, no tree-sitter).
 * Supports JS/TS (v0), with extensible language registry for Python/Go/Rust/Java/C# (v1).
 */

// @pan: ADR-0021

const fs = require('fs');
const path = require('path');
const { CODEBASE_DIR, DRIFT_MAX_FILE_SIZE } = require('./constants.cjs');
const { output, error, safeReadFile, toPosix } = require('./core.cjs');
const { planningPath } = require('./utils.cjs');

// ─── Language Detection ─────────────────────────────────────────────────────

/** Extension → language mapping */
const EXTENSION_MAP = {
  '.js': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript', '.jsx': 'javascript',
  '.ts': 'typescript', '.tsx': 'typescript', '.mts': 'typescript', '.cts': 'typescript',
  '.py': 'python', '.pyw': 'python',
  '.go': 'go',
  '.rs': 'rust',
  '.java': 'java',
  '.cs': 'csharp',
};

/** Package manifest → language mapping */
const MANIFEST_MAP = {
  'package.json': 'javascript',
  'tsconfig.json': 'typescript',
  'requirements.txt': 'python',
  'pyproject.toml': 'python',
  'setup.py': 'python',
  'go.mod': 'go',
  'Cargo.toml': 'rust',
  'pom.xml': 'java',
  'build.gradle': 'java',
};

/** Directories to skip during scanning */
const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.planning',
  'coverage', '.next', '.nuxt', '__pycache__', '.venv',
  'venv', 'target', 'vendor', 'bin', '.cache',
]);

/**
 * Walk a directory recursively, collecting source files grouped by language.
 * @param {string} dir - Directory to walk
 * @param {string} baseCwd - Project root for relative paths
 * @returns {{ files_by_language: Object<string, string[]>, total: number }}
 */
function walkSourceFiles(dir, baseCwd) {
  const filesByLang = {};
  let total = 0;

  function walk(current) {
    let entries;
    try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith('.')) {
          walk(path.join(current, entry.name));
        }
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        const lang = EXTENSION_MAP[ext];
        if (lang) {
          const rel = toPosix(path.relative(baseCwd, path.join(current, entry.name)));
          if (!filesByLang[lang]) filesByLang[lang] = [];
          filesByLang[lang].push(rel);
          total++;
        }
      }
    }
  }

  walk(dir);
  return { files_by_language: filesByLang, total };
}

/**
 * Detect languages used in a codebase.
 * @param {string} cwd - Project root
 * @returns {{ primary: string|null, secondary: string[], files_by_language: Object, file_count: number }}
 */
function detectLanguages(cwd) {
  const { files_by_language, total } = walkSourceFiles(cwd, cwd);

  // Check manifests for additional signals
  for (const [manifest, lang] of Object.entries(MANIFEST_MAP)) {
    try {
      fs.accessSync(path.join(cwd, manifest));
      // Promote language if manifest exists but no source files found yet
      if (!files_by_language[lang]) files_by_language[lang] = [];
    } catch { /* manifest not found */ }
  }

  // TypeScript subsumes javascript if tsconfig.json exists
  if (files_by_language.typescript && files_by_language.javascript) {
    // Merge JS files under TypeScript project
    files_by_language.typescript = files_by_language.typescript.concat(files_by_language.javascript);
    delete files_by_language.javascript;
  }

  // Determine primary (most files) and secondary (>5% of total)
  const sorted = Object.entries(files_by_language)
    .filter(([, files]) => files.length > 0)
    .sort((a, b) => b[1].length - a[1].length);

  const primary = sorted.length > 0 ? sorted[0][0] : null;
  const threshold = Math.max(1, total * 0.05);
  const secondary = sorted.slice(1)
    .filter(([, files]) => files.length >= threshold)
    .map(([lang]) => lang);

  return { primary, secondary, files_by_language, file_count: total };
}

// ─── Import/Export Parsing ──────────────────────────────────────────────────

/** Import regex pattern factories per language (fresh instances avoid g-flag state leaks) */
function getImportPatterns(lang) {
  if (lang === 'javascript' || lang === 'typescript') {
    return [
      { re: /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g, type: 'require' },
      { re: /import\s+.*?from\s+['"]([^'"]+)['"]/g, type: 'esm' },
      { re: /(?:^|[\s;=])import\s*\(\s*['"]([^'"]+)['"]\s*\)/g, type: 'dynamic' },
    ];
  }
  return [];
}

/** Export regex pattern factories per language */
function getExportPatterns(lang) {
  if (lang === 'javascript' || lang === 'typescript') {
    return [
      { re: /module\.exports\s*=/g, type: 'cjs-default' },
      { re: /exports\.(\w+)\s*=/g, type: 'cjs-named' },
      { re: /export\s+default\s+(?:function|class|const|let|var)?\s*(\w*)/g, type: 'esm-default' },
      { re: /export\s+(?:function|class|const|let|var)\s+(\w+)/g, type: 'esm-named' },
      { re: /export\s*\{([^}]+)\}/g, type: 'esm-destructured' },
    ];
  }
  return [];
}

/**
 * Strip single-line and multi-line comments from source code.
 * @param {string} content - Source code
 * @returns {string} Content with comments replaced by whitespace (preserving line count)
 */
function stripComments(content) {
  // Replace multi-line comments with equivalent newlines
  let result = content.replace(/\/\*[\s\S]*?\*\//g, (match) => match.replace(/[^\n]/g, ' '));
  // Replace single-line comments
  result = result.replace(/\/\/.*$/gm, '');
  return result;
}

/**
 * Parse import statements from a file.
 * @param {string} filePath - Absolute path to source file
 * @param {string} lang - Language identifier
 * @returns {Array<{ source: string, line: number, type: string }>}
 */
function parseImports(filePath, lang) {
  const patterns = getImportPatterns(lang);
  if (patterns.length === 0) return [];

  const content = safeReadFile(filePath);
  if (!content) return [];

  const stripped = stripComments(content);
  const lines = stripped.split('\n');
  const results = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const { re, type } of patterns) {
      re.lastIndex = 0;
      let match;
      while ((match = re.exec(line)) !== null) {
        results.push({ source: match[1], line: i + 1, type });
      }
    }
  }
  return results;
}

/**
 * Parse export statements from a file.
 * @param {string} filePath - Absolute path to source file
 * @param {string} lang - Language identifier
 * @returns {Array<{ name: string, type: string, line: number, default: boolean }>}
 */
function parseExports(filePath, lang) {
  const patterns = getExportPatterns(lang);
  if (patterns.length === 0) return [];

  const content = safeReadFile(filePath);
  if (!content) return [];

  const stripped = stripComments(content);
  const lines = stripped.split('\n');
  const results = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const { re, type } of patterns) {
      re.lastIndex = 0;
      let match;
      while ((match = re.exec(line)) !== null) {
        if (type === 'cjs-default') {
          results.push({ name: 'default', type, line: i + 1, default: true });
        } else if (type === 'esm-destructured') {
          const names = match[1].split(',').map(s => s.trim().split(/\s+as\s+/)[0].trim()).filter(Boolean);
          for (const name of names) {
            results.push({ name, type, line: i + 1, default: false });
          }
        } else if (type === 'esm-default') {
          results.push({ name: match[1] || 'default', type, line: i + 1, default: true });
        } else {
          results.push({ name: match[1], type, line: i + 1, default: false });
        }
      }
    }
  }
  return results;
}

// ─── Dependency Graph ───────────────────────────────────────────────────────

/** Common file extensions to try when resolving imports */
const RESOLVE_EXTENSIONS = ['.js', '.cjs', '.mjs', '.ts', '.tsx', '.jsx'];

/**
 * Resolve an import source to an actual file path.
 * @param {string} source - Import source (e.g., './module', '../utils')
 * @param {string} importerDir - Directory of the importing file
 * @param {string} cwd - Project root
 * @returns {string|null} Resolved relative path or null
 */
function resolveImport(source, importerDir, cwd) {
  // Skip non-relative imports (node_modules, builtins)
  if (!source.startsWith('.')) return null;

  const resolved = path.resolve(importerDir, source);

  // Try exact match
  try { if (fs.statSync(resolved).isFile()) return toPosix(path.relative(cwd, resolved)); } catch { /* */ }

  // Try with extensions
  for (const ext of RESOLVE_EXTENSIONS) {
    try { if (fs.statSync(resolved + ext).isFile()) return toPosix(path.relative(cwd, resolved + ext)); } catch { /* */ }
  }

  // Try index files
  for (const ext of RESOLVE_EXTENSIONS) {
    const indexPath = path.join(resolved, 'index' + ext);
    try { if (fs.statSync(indexPath).isFile()) return toPosix(path.relative(cwd, indexPath)); } catch { /* */ }
  }

  return null;
}

/**
 * Build a dependency graph from import analysis.
 * @param {string} cwd - Project root
 * @returns {{ nodes: string[], edges: Array<{from: string, to: string}>, adjacency: Object<string, string[]> }}
 */
function buildDependencyGraph(cwd) {
  const { files_by_language } = detectLanguages(cwd);
  const nodeSet = new Set();
  const edges = [];
  const adjacency = {};

  for (const [lang, files] of Object.entries(files_by_language)) {
    for (const relPath of files) {
      const absPath = path.join(cwd, relPath);

      // Skip large files
      try {
        const stat = fs.statSync(absPath);
        if (stat.size > DRIFT_MAX_FILE_SIZE) continue;
      } catch { continue; }

      nodeSet.add(relPath);
      if (!adjacency[relPath]) adjacency[relPath] = [];

      const imports = parseImports(absPath, lang);
      const importerDir = path.dirname(absPath);

      for (const imp of imports) {
        const resolved = resolveImport(imp.source, importerDir, cwd);
        if (resolved && resolved !== relPath) {
          nodeSet.add(resolved);
          if (!adjacency[relPath].includes(resolved)) {
            adjacency[relPath].push(resolved);
            edges.push({ from: relPath, to: resolved });
          }
        }
      }
    }
  }

  return { nodes: Array.from(nodeSet), edges, adjacency };
}

// ─── Circular Dependency Detection ──────────────────────────────────────────

/**
 * Find circular dependencies using DFS cycle detection.
 * @param {{ adjacency: Object<string, string[]> }} graph - Dependency graph
 * @returns {Array<string[]>} Array of cycles (each cycle is an array of file paths)
 */
function findCircularDeps(graph) {
  const { adjacency } = graph;
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = {};
  const cycles = [];

  for (const node of Object.keys(adjacency)) {
    color[node] = WHITE;
  }

  function dfs(node, pathStack) {
    color[node] = GRAY;
    pathStack.push(node);

    const neighbors = adjacency[node] || [];
    for (const neighbor of neighbors) {
      if (color[neighbor] === GRAY) {
        // Found cycle — extract from pathStack
        const cycleStart = pathStack.indexOf(neighbor);
        const cycle = pathStack.slice(cycleStart).concat(neighbor);
        cycles.push(cycle);
      } else if (color[neighbor] === WHITE || color[neighbor] === undefined) {
        dfs(neighbor, pathStack);
      }
    }

    pathStack.pop();
    color[node] = BLACK;
  }

  for (const node of Object.keys(adjacency)) {
    if (color[node] === WHITE) {
      dfs(node, []);
    }
  }

  return cycles;
}

// ─── Entry Points & Orphans ─────────────────────────────────────────────────

/**
 * Find entry points (files with no incoming edges).
 * @param {{ nodes: string[], adjacency: Object }} graph
 * @returns {string[]}
 */
function findEntryPoints(graph) {
  const { nodes, adjacency } = graph;
  const hasIncoming = new Set();

  for (const deps of Object.values(adjacency)) {
    for (const dep of deps) {
      hasIncoming.add(dep);
    }
  }

  return nodes.filter(n => !hasIncoming.has(n));
}

/**
 * Find orphan modules (files that export but are never imported).
 * @param {string} cwd - Project root
 * @param {{ nodes: string[], adjacency: Object }} graph
 * @returns {string[]}
 */
function findOrphanExports(cwd, graph) {
  const hasIncoming = new Set();

  for (const deps of Object.values(graph.adjacency)) {
    for (const dep of deps) {
      hasIncoming.add(dep);
    }
  }

  const orphans = [];
  for (const node of graph.nodes) {
    if (hasIncoming.has(node)) continue;

    // Check if file has exports but no outgoing edges (completely disconnected exporter)
    const outgoing = graph.adjacency[node] || [];
    if (outgoing.length > 0) continue; // Has imports — likely an entry point, not orphan

    const absPath = path.join(cwd, node);
    const lang = EXTENSION_MAP[path.extname(node).toLowerCase()] || 'javascript';
    const exports = parseExports(absPath, lang);
    if (exports.length > 0) {
      orphans.push(node);
    }
  }

  return orphans;
}

// ─── Mermaid Graph Generation ───────────────────────────────────────────────

/**
 * Generate a Mermaid dependency graph.
 * @param {{ nodes: string[], edges: Array<{from: string, to: string}> }} graph
 * @param {number} [maxNodes=15] - Maximum nodes to show
 * @returns {string} Mermaid graph source
 */
function generateMermaidGraph(graph, maxNodes = 15) {
  const { nodes, edges } = graph;
  if (nodes.length === 0) return 'graph LR\n    empty[No modules found]';

  // Score nodes by total edge count (incoming + outgoing)
  const edgeCount = {};
  for (const node of nodes) edgeCount[node] = 0;
  for (const { from, to } of edges) {
    edgeCount[from] = (edgeCount[from] || 0) + 1;
    edgeCount[to] = (edgeCount[to] || 0) + 1;
  }

  // Pick top N nodes
  const topNodes = Object.entries(edgeCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxNodes)
    .map(([node]) => node);

  const topSet = new Set(topNodes);

  // Build Mermaid
  const lines = ['graph LR'];
  const nodeIds = {};
  let idCounter = 0;

  function nodeId(name) {
    if (!nodeIds[name]) {
      nodeIds[name] = `N${idCounter++}`;
    }
    return nodeIds[name];
  }

  function shortName(filepath) {
    const parts = filepath.split('/');
    return parts[parts.length - 1].replace(/\.\w+$/, '');
  }

  for (const { from, to } of edges) {
    if (topSet.has(from) && topSet.has(to)) {
      lines.push(`    ${nodeId(from)}[${shortName(from)}] --> ${nodeId(to)}[${shortName(to)}]`);
    }
  }

  if (nodes.length > maxNodes) {
    lines.push(`    note[... and ${nodes.length - maxNodes} more modules]`);
  }

  return lines.join('\n');
}

// ─── Best Practices Detection ───────────────────────────────────────────────

/**
 * Detect best practices in a codebase across 5 categories.
 * @param {string} cwd - Project root
 * @returns {{ categories: Array, score: number, recommendations: string[] }}
 */
function detectBestPractices(cwd) {
  const { files_by_language, file_count } = detectLanguages(cwd);
  const categories = [];
  const recommendations = [];

  // Flatten all source files
  const allFiles = [];
  for (const files of Object.values(files_by_language)) {
    allFiles.push(...files);
  }

  // Sample up to 30 files for detailed analysis
  const sampleFiles = allFiles.slice(0, 30);
  const sampleContents = [];
  for (const rel of sampleFiles) {
    const content = safeReadFile(path.join(cwd, rel));
    if (content) sampleContents.push({ path: rel, content });
  }

  // Category 1: Error Handling
  const errorCat = detectErrorHandling(sampleContents);
  categories.push(errorCat);
  if (errorCat.score < 7) recommendations.push(...errorCat.recommendations);

  // Category 2: Testing
  const testCat = detectTestingPractices(cwd, file_count);
  categories.push(testCat);
  if (testCat.score < 7) recommendations.push(...testCat.recommendations);

  // Category 3: Naming Conventions
  const namingCat = detectNamingConventions(sampleContents);
  categories.push(namingCat);
  if (namingCat.score < 7) recommendations.push(...namingCat.recommendations);

  // Category 4: Security
  const secCat = detectSecurityPractices(cwd, sampleContents);
  categories.push(secCat);
  if (secCat.score < 7) recommendations.push(...secCat.recommendations);

  // Category 5: Performance
  const perfCat = detectPerformancePractices(sampleContents);
  categories.push(perfCat);
  if (perfCat.score < 7) recommendations.push(...perfCat.recommendations);

  const score = categories.length > 0
    ? Math.round(categories.reduce((sum, c) => sum + c.score, 0) / categories.length * 10) / 10
    : 0;

  return { categories, score, recommendations };
}

function detectErrorHandling(samples) {
  let tryCatchCount = 0;
  let functionCount = 0;
  const findings = [];

  for (const { path: fp, content } of samples) {
    const tryCatches = (content.match(/\btry\s*\{/g) || []).length;
    const functions = (content.match(/\bfunction\s+\w+|=>\s*\{|\bconst\s+\w+\s*=\s*(?:async\s+)?\(/g) || []).length;
    tryCatchCount += tryCatches;
    functionCount += functions;
  }

  const ratio = functionCount > 0 ? tryCatchCount / functionCount : 0;
  const score = Math.min(10, Math.round(ratio * 20));
  const recs = [];
  if (ratio < 0.3) recs.push('Add try-catch to more functions, especially async operations');

  return { name: 'Error Handling', score, detected_patterns: [`try-catch ratio: ${Math.round(ratio * 100)}%`], recommendations: recs };
}

function detectTestingPractices(cwd, sourceFileCount) {
  const patterns = ['*.test.*', '*.spec.*', '__tests__/**'];
  let testFileCount = 0;

  try {
    const entries = fs.readdirSync(cwd, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === 'tests' || entry.name === '__tests__' || entry.name === 'test') {
        try {
          const testDir = path.join(cwd, entry.name);
          const testFiles = fs.readdirSync(testDir).filter(f => f.endsWith('.test.cjs') || f.endsWith('.test.js') || f.endsWith('.test.ts') || f.endsWith('.spec.js') || f.endsWith('.spec.ts'));
          testFileCount += testFiles.length;
        } catch { /* */ }
      }
    }
  } catch { /* */ }

  // Check for test framework config
  let hasConfig = false;
  for (const cfg of ['jest.config.js', 'jest.config.ts', 'vitest.config.ts', 'vitest.config.js', '.mocharc.yml', '.mocharc.json']) {
    try { fs.accessSync(path.join(cwd, cfg)); hasConfig = true; break; } catch { /* */ }
  }
  // node:test doesn't need config — check package.json for test script
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf-8'));
    if (pkg.scripts && pkg.scripts.test) hasConfig = true;
  } catch { /* */ }

  const ratio = sourceFileCount > 0 ? testFileCount / sourceFileCount : 0;
  const score = Math.min(10, Math.round((ratio * 10) + (hasConfig ? 3 : 0) + (testFileCount > 0 ? 2 : 0)));
  const recs = [];
  if (!hasConfig) recs.push('Add test framework configuration');
  if (testFileCount === 0) recs.push('Create test files for source modules');

  return { name: 'Testing', score, detected_patterns: [`${testFileCount} test files found`, hasConfig ? 'Test config present' : 'No test config'], recommendations: recs };
}

function detectNamingConventions(samples) {
  let consistent = 0;
  let total = 0;
  const filePatterns = new Set();

  for (const { path: fp } of samples) {
    const filename = fp.split('/').pop().replace(/\.\w+$/, '');
    total++;
    if (/^[a-z][a-z0-9-]*$/.test(filename)) { consistent++; filePatterns.add('kebab-case'); }
    else if (/^[a-z][a-zA-Z0-9]*$/.test(filename)) { consistent++; filePatterns.add('camelCase'); }
    else if (/^[A-Z][a-zA-Z0-9]*$/.test(filename)) { consistent++; filePatterns.add('PascalCase'); }
    else if (/^[a-z][a-z0-9_]*$/.test(filename)) { consistent++; filePatterns.add('snake_case'); }
  }

  const ratio = total > 0 ? consistent / total : 0;
  const singlePattern = filePatterns.size <= 2;
  const score = Math.min(10, Math.round(ratio * 7 + (singlePattern ? 3 : 0)));
  const recs = [];
  if (filePatterns.size > 2) recs.push('Standardize file naming convention — multiple patterns detected');

  return { name: 'Naming Conventions', score, detected_patterns: [`File patterns: ${Array.from(filePatterns).join(', ')}`], recommendations: recs };
}

function detectSecurityPractices(cwd, samples) {
  let score = 5; // Start at baseline
  const patterns = [];
  const recs = [];

  // Check for .gitignore with .env
  const gitignore = safeReadFile(path.join(cwd, '.gitignore'));
  if (gitignore && /\.env/.test(gitignore)) { score += 2; patterns.push('.env in .gitignore'); }
  else { recs.push('Add .env to .gitignore'); }

  // Check for .env.example
  try { fs.accessSync(path.join(cwd, '.env.example')); score += 1; patterns.push('.env.example exists'); } catch { /* */ }

  // Check for hardcoded secrets patterns in code
  let secretsFound = 0;
  for (const { content } of samples) {
    if (/(?:password|secret|api_key|token)\s*=\s*['"][^'"]{8,}/i.test(content)) {
      secretsFound++;
    }
  }
  if (secretsFound === 0) { score += 2; patterns.push('No hardcoded secrets detected'); }
  else { score -= 2; recs.push(`Found ${secretsFound} files with potential hardcoded secrets`); }

  return { name: 'Security', score: Math.max(0, Math.min(10, score)), detected_patterns: patterns, recommendations: recs };
}

function detectPerformancePractices(samples) {
  let score = 5;
  const patterns = [];
  const recs = [];

  let hasMemoization = false;
  let hasLazyLoading = false;

  for (const { content } of samples) {
    if (/\buseMemo\b|\buseCallback\b|\bmemoize\b/.test(content)) hasMemoization = true;
    if (/\blazy\s*\(|\bimport\s*\(/.test(content)) hasLazyLoading = true;
  }

  if (hasMemoization) { score += 2; patterns.push('Memoization patterns detected'); }
  if (hasLazyLoading) { score += 2; patterns.push('Lazy loading detected'); }
  if (!hasMemoization && !hasLazyLoading) { recs.push('Consider memoization or lazy loading for performance'); }

  return { name: 'Performance', score: Math.min(10, score), detected_patterns: patterns.length > 0 ? patterns : ['No specific performance patterns detected'], recommendations: recs };
}

// ─── Lowercase Codebase Doc Helper ──────────────────────────────────────────

/**
 * Find a codebase document, checking lowercase first then UPPERCASE.
 * @param {string} cwd - Project root
 * @param {string} docName - Document name without path (e.g., 'conventions.md')
 * @returns {string|null} Full path to found document, or null
 */
function findCodebaseDoc(cwd, docName) {
  const codebaseDir = path.join(planningPath(cwd), CODEBASE_DIR);
  // Try lowercase first
  const lowercase = path.join(codebaseDir, docName.toLowerCase());
  const content = safeReadFile(lowercase);
  if (content !== null) return lowercase;

  // Try UPPERCASE fallback
  const uppercase = path.join(codebaseDir, docName.toUpperCase());
  const upperContent = safeReadFile(uppercase);
  if (upperContent !== null) return uppercase;

  return null;
}

// ─── CLI Commands ───────────────────────────────────────────────────────────

/**
 * CLI: Detect languages in codebase.
 * @param {string} cwd - Project root
 * @param {boolean} raw - Raw output flag
 */
function cmdDetectLanguages(cwd, raw) {
  const result = detectLanguages(cwd);
  output(result, raw);
}

/**
 * CLI: Analyze imports and build dependency graph.
 * @param {string} cwd - Project root
 * @param {boolean} raw - Raw output flag
 * @param {string[]} args - Additional arguments (--files f1,f2)
 */
function cmdAnalyzeImports(cwd, raw, args) {
  const graph = buildDependencyGraph(cwd);
  const circularDeps = findCircularDeps(graph);
  const entryPoints = findEntryPoints(graph);
  const orphans = findOrphanExports(cwd, graph);
  const { primary } = detectLanguages(cwd);
  const mermaid = generateMermaidGraph(graph);

  const result = {
    language: primary,
    modules: graph.nodes.length,
    imports: graph.edges.length,
    circular_deps: circularDeps,
    entry_points: entryPoints,
    orphan_modules: orphans,
    dependency_graph: mermaid,
  };

  output(result, raw);
}

/**
 * CLI: Detect best practices.
 * @param {string} cwd - Project root
 * @param {boolean} raw - Raw output flag
 */
function cmdBestPractices(cwd, raw) {
  const result = detectBestPractices(cwd);
  output(result, raw);
}

// ─── E-2: Repo token-size estimation (Opus 4.7 single-shot map-codebase) ────

/**
 * Estimate total token count of source files in a repository.
 *
 * Uses CHARS_PER_TOKEN as a rough approximation (no tokenizer shipped).
 * Walks source files via walkSourceFiles (respects SKIP_DIRS) plus a curated
 * set of "planning" files the map-codebase agent actually reads (top-level
 * README, package.json, CLAUDE.md, docs/ top level).
 *
 * Returns enough info for map-codebase to choose between single-shot mode
 * (all files fit in 1M context) and sharded mode (6-way parallel today).
 *
 * @param {string} cwd - Project root
 * @param {Object} [opts]
 * @param {number} [opts.threshold=700000] - Single-shot cutoff (tokens)
 * @param {boolean} [opts.include_docs=true] - Whether to include docs/*.md top level
 * @returns {{
 *   total_bytes: number,
 *   total_tokens: number,
 *   threshold: number,
 *   mode: 'single-shot'|'sharded',
 *   file_count: number,
 *   languages: Object<string, number>
 * }}
 */
function estimateRepoTokenSize(cwd, opts) {
  const { CHARS_PER_TOKEN } = require('./constants.cjs');
  const threshold = (opts && typeof opts.threshold === 'number' && opts.threshold > 0)
    ? opts.threshold
    : 700000;
  const includeDocs = !opts || opts.include_docs !== false;

  let totalBytes = 0;
  let fileCount = 0;
  const languages = {};

  // Source files via the existing walker — respects gitignore-like skip list.
  const walked = walkSourceFiles(cwd, cwd);
  for (const [lang, files] of Object.entries(walked.files_by_language)) {
    for (const relPath of files) {
      const abs = path.join(cwd, relPath);
      try {
        const stat = fs.statSync(abs);
        totalBytes += stat.size;
        languages[lang] = (languages[lang] || 0) + stat.size;
        fileCount += 1;
      } catch { /* file may have been removed between walk and stat — ignore */ }
    }
  }

  // Curated top-level planning files the agent actually reads.
  const planningCandidates = [
    'README.md',
    'CLAUDE.md',
    'AGENTS.md',
    'package.json',
    'pyproject.toml',
    'go.mod',
    'Cargo.toml',
  ];
  for (const rel of planningCandidates) {
    try {
      const stat = fs.statSync(path.join(cwd, rel));
      if (stat.isFile()) {
        totalBytes += stat.size;
        languages.docs = (languages.docs || 0) + stat.size;
        fileCount += 1;
      }
    } catch { /* missing — expected */ }
  }

  // docs/*.md at top level only (avoid recursing into specs/decisions/archive).
  if (includeDocs) {
    const docsDir = path.join(cwd, 'docs');
    try {
      const entries = fs.readdirSync(docsDir, { withFileTypes: true });
      for (const e of entries) {
        if (!e.isFile() || !e.name.endsWith('.md')) continue;
        try {
          const stat = fs.statSync(path.join(docsDir, e.name));
          totalBytes += stat.size;
          languages.docs = (languages.docs || 0) + stat.size;
          fileCount += 1;
        } catch { /* ignore */ }
      }
    } catch { /* no docs dir — expected in greenfield */ }
  }

  const totalTokens = Math.ceil(totalBytes / CHARS_PER_TOKEN);
  const mode = totalTokens <= threshold ? 'single-shot' : 'sharded';

  return {
    total_bytes: totalBytes,
    total_tokens: totalTokens,
    threshold,
    mode,
    file_count: fileCount,
    languages,
  };
}

function cmdEstimateRepoSize(cwd, raw, args) {
  const thresholdIdx = Array.isArray(args) ? args.indexOf('--threshold') : -1;
  const threshold = thresholdIdx !== -1 && args[thresholdIdx + 1]
    ? Number(args[thresholdIdx + 1])
    : undefined;
  const noDocs = Array.isArray(args) && args.includes('--no-docs');
  const opts = {};
  if (threshold && Number.isFinite(threshold) && threshold > 0) opts.threshold = threshold;
  if (noDocs) opts.include_docs = false;
  const result = estimateRepoTokenSize(cwd, opts);
  output(result, raw);
}

// ─── Exports ────────────────────────────────────────────────────────────────

module.exports = {
  // Core analysis
  detectLanguages,
  parseImports,
  parseExports,
  buildDependencyGraph,
  findCircularDeps,
  findEntryPoints,
  findOrphanExports,
  generateMermaidGraph,
  detectBestPractices,
  // Helper
  findCodebaseDoc,
  stripComments,
  walkSourceFiles,
  resolveImport,
  // CLI commands
  cmdDetectLanguages,
  cmdAnalyzeImports,
  cmdBestPractices,
  cmdEstimateRepoSize,
  // E-2
  estimateRepoTokenSize,
};
