'use strict';
/**
 * walk.js — recursive .md file walker with --exclude glob support.
 *
 * Synchronous (no need for async — file count is bounded; perf budget allows
 * it; matches PAN's CLI shape). Returns an array of {path, content} where
 * `path` is an absolute path with forward-slash normalization (POSIX).
 */

const fs = require('fs');
const path = require('path');

/** Normalize a path to POSIX-style forward slashes. */
function toPosix(p) {
  return p.replace(/\\/g, '/');
}

/**
 * Walk a directory recursively and return all .md files.
 *
 * @param {string} dir - absolute directory path
 * @param {object} [opts]
 * @param {Array<string>} [opts.exclude] - simple glob patterns to exclude
 *   (matches against the POSIX path; supported tokens: ** and *)
 * @returns {Array<{path: string, content: string, relativePath: string}>}
 */
function walkMarkdownFiles(dir, opts = {}) {
  const exclude = opts.exclude || [];
  const excludeRegexes = exclude.map(globToRegex);

  if (!fs.existsSync(dir)) {
    throw new Error(`directory not found: ${dir}`);
  }
  const stat = fs.statSync(dir);
  if (!stat.isDirectory()) {
    throw new Error(`not a directory: ${dir}`);
  }

  const out = [];
  const baseAbs = path.resolve(dir);
  walkRecursive(baseAbs, baseAbs, excludeRegexes, out);
  return out;
}

function walkRecursive(currentDir, baseDir, excludeRegexes, out) {
  let entries;
  try {
    entries = fs.readdirSync(currentDir, { withFileTypes: true });
  } catch (err) {
    // Permission denied, etc. — emit a synthetic entry the caller can convert
    // to a violation.
    out.push({
      path: toPosix(currentDir),
      content: null,
      relativePath: toPosix(path.relative(baseDir, currentDir)),
      readError: err.message,
    });
    return;
  }

  for (const entry of entries) {
    const fullPath = path.join(currentDir, entry.name);
    const posixFull = toPosix(fullPath);
    const relative = toPosix(path.relative(baseDir, fullPath));

    if (matchesAny(posixFull, excludeRegexes) || matchesAny(relative, excludeRegexes)) {
      continue;
    }

    if (entry.isDirectory()) {
      walkRecursive(fullPath, baseDir, excludeRegexes, out);
      continue;
    }

    if (entry.isFile() && entry.name.endsWith('.md')) {
      let content = '';
      let readError = null;
      try {
        content = fs.readFileSync(fullPath, 'utf-8');
      } catch (err) {
        readError = err.message;
      }
      out.push({
        path: posixFull,
        relativePath: relative,
        content,
        readError,
      });
    }
  }
}

function matchesAny(s, regexes) {
  for (const re of regexes) if (re.test(s)) return true;
  return false;
}

/**
 * Convert a simple glob to a RegExp.
 * Supports: ** (matches any chars including /), * (matches any chars except /)
 * Anchored to full string match.
 *
 * Convention: when `**` is followed by `/`, the slash is also optional —
 * `**\/foo.md` matches both `foo.md` (root) and `a/b/foo.md` (nested).
 * Mirrors gitignore / minimatch behavior.
 */
function globToRegex(glob) {
  let re = '^';
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i];
    if (ch === '*') {
      if (glob[i + 1] === '*') {
        // Match the standard `**\/<name>` pattern: the trailing slash is
        // optional, so `**\/foo.md` matches root-level `foo.md` too.
        if (glob[i + 2] === '/') {
          re += '(?:.*/)?';
          i += 2; // skip ** and /
        } else {
          re += '.*';
          i++; // skip next *
        }
      } else {
        re += '[^/]*';
      }
    } else if ('.+?^$()|{}[]\\'.includes(ch)) {
      re += '\\' + ch;
    } else {
      re += ch;
    }
  }
  re += '$';
  return new RegExp(re);
}

module.exports = { walkMarkdownFiles, toPosix, globToRegex };
