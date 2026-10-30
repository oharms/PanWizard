'use strict';
/**
 * What must never leave a project in a report PAN prints for sharing (`/pan:feedback`).
 *
 * `scanText(text, canaries)` lists the rules a text breaks: credential shapes (the union
 * of the token and key-value patterns the trace logger and the guard hook use, which
 * tests/redact.test.cjs keeps in step with both), Bearer headers, long mixed
 * alphanumeric runs, email addresses, URLs, absolute and home paths, IP addresses, and
 * the project's own canaries (its directory name, git remote, branch, git user, OS user
 * and host, phase slugs). It names rules, never the matched text, so a refusal can be
 * printed and reported without leaking what it refused.
 *
 * Detection only: the hooks keep their own patterns (the guard's is narrower on purpose,
 * so it does not deny a legitimate write), and nothing here rewrites text.
 */
const os = require('os');
const path = require('path');
const { execGit } = require('./core.cjs');

// Every token shape either hook recognises.
const TOKEN_RE = /\b(?:sk-ant-[A-Za-z0-9_-]{10,}|sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[abprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{30,}|eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,})|-----BEGIN (?:RSA |EC |OPENSSH |)PRIVATE KEY-----/;
const SECRET_KV_RE = /\b(api[_-]?key|access[_-]?token|auth[_-]?token|refresh[_-]?token|client[_-]?secret|secret[_-]?key|token|secret|password|passwd|pwd|authorization)["']?\s*[:=]\s*["']?[^\s"',;&]{4,}/i;

const RULES = [
  { rule: 'token', re: TOKEN_RE },
  { rule: 'secret_key_value', re: SECRET_KV_RE },
  { rule: 'bearer', re: /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/i },
  // A long run of letters and digits mixed is a key or a hash; PAN's report emits neither.
  { rule: 'long_mixed_run', re: /[A-Za-z0-9+/=_-]{32,}/, test: (m) => /\d/.test(m) && /[A-Za-z]/.test(m) },
  { rule: 'email', re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/ },
  { rule: 'url', re: /\b(?:https?|ftp|ssh|git):\/\/[^\s)>\]]+/i },
  { rule: 'windows_path', re: /\b[A-Za-z]:[\\/][^\s|`]+/ },
  { rule: 'unix_path', re: /(?:^|[\s(`"'])\/(?:home|Users|root|var|etc|opt|srv|mnt|tmp|private|Volumes)\/[^\s|`]*/ },
  { rule: 'home_path', re: /(?:^|[\s(`"'])~[\\/][^\s|`]+/ },
  { rule: 'unc_path', re: /\\\\[A-Za-z0-9._-]+\\/ },
  { rule: 'ipv4', re: /\b(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}\b/ },
  { rule: 'ipv6', re: /\b(?:[0-9a-f]{1,4}:){4,7}[0-9a-f]{1,4}\b/i },
];

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The names of the rules `text` breaks (each once), plus `canary:<kind>` for each
 * project canary it contains (whole word, case-insensitive). `allowed` lists exact
 * substrings that are fine to contain (the report's own fixed link, say).
 * @param {string} text
 * @param {{canaries?: Array<{kind: string, value: string}>, allowed?: string[]}} [opts]
 * @returns {string[]}
 */
function scanText(text, opts = {}) {
  let t = String(text == null ? '' : text);
  for (const a of opts.allowed || []) t = t.split(a).join(' ');
  const hits = [];
  for (const r of RULES) {
    const re = new RegExp(r.re.source, r.re.flags.includes('g') ? r.re.flags : r.re.flags + 'g');
    let m;
    while ((m = re.exec(t))) {
      if (!r.test || r.test(m[0])) { hits.push(r.rule); break; }
      if (m[0].length === 0) re.lastIndex++;
    }
  }
  for (const c of opts.canaries || []) {
    if (!c || !c.value) continue;
    if (new RegExp(`(^|[^A-Za-z0-9])${escapeRe(c.value)}($|[^A-Za-z0-9])`, 'i').test(t)) hits.push(`canary:${c.kind}`);
  }
  return [...new Set(hits)];
}

/**
 * What identifies this project or person, read at run time, for scanText's canaries.
 * Values shorter than four characters are left out (too many false hits).
 * @param {string} cwd
 * @param {{phaseSlugs?: string[]}} [opts]
 */
function projectCanaries(cwd, opts = {}) {
  const out = [];
  const add = (kind, value) => {
    const v = String(value || '').trim();
    if (v.length >= 4) out.push({ kind, value: v });
  };
  add('project_dir', path.basename(path.resolve(cwd)));
  const git = (args) => { const r = execGit(cwd, args); return r.exitCode === 0 ? r.stdout.trim() : ''; };
  const remote = git(['config', '--get', 'remote.origin.url']);
  if (remote) {
    add('git_remote', remote);
    // owner and repository from https://host/owner/repo(.git) or git@host:owner/repo(.git)
    const m = remote.match(/[/:]([^/:]+)\/([^/]+?)(?:\.git)?\/?$/);
    if (m) { add('git_owner', m[1]); add('git_repo', m[2]); }
    const h = remote.match(/^(?:[a-z]+:\/\/)?(?:[^@/]+@)?([^/:]+)/i);
    if (h && !/^(github\.com|gitlab\.com|bitbucket\.org)$/i.test(h[1])) add('git_host', h[1]);
  }
  add('git_branch', git(['rev-parse', '--abbrev-ref', 'HEAD']).replace(/^HEAD$/, ''));
  add('git_user', git(['config', '--get', 'user.name']));
  add('git_email', git(['config', '--get', 'user.email']));
  try { add('os_user', os.userInfo().username); } catch { /* no user info */ }
  add('host', os.hostname());
  for (const s of opts.phaseSlugs || []) add('phase_name', s);
  return out;
}

module.exports = { scanText, projectCanaries, TOKEN_RE, SECRET_KV_RE, RULE_NAMES: RULES.map((r) => r.rule) };
