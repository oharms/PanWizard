#!/usr/bin/env node
'use strict';
// PAN guard — a pre-tool hook (program A7).
//
// Registered on the hosts with a pre-tool event that can deny a call: Claude Code
// and Codex (`PreToolUse`), Gemini CLI (`BeforeTool`) and Copilot CLI (`preToolUse`).
// OpenCode registers no hooks. The command carries `--host <runtime>`, because the
// payload and the way to deny differ per host.
//
// Rules, over the files a tool call is about to write:
//   secret_write          the written text holds a credential (known token shapes,
//                         or a long key=value secret)
//   state_write           a direct write to PAN's own state: state.md, findings.jsonl,
//                         the token ledger (pan-tools owns those)
//   judge_write           a judge (verifier, reviewer, plan-checker, design-checker)
//                         writing outside the planning tree; the payload names the
//                         agent (`agent_type`) only on hosts that say so
//   undeclared_test_edit  a test file the phase in flight does not declare in any
//                         unfinished plan's files_modified
//   unrouted_write        only when config.json `instructions.routing` is `exclusive`: a
//                         write outside the planning tree while no PAN unit of work is in
//                         flight (no unfinished plan in the current phase, no open quick
//                         task or debug session, not a PAN agent); files matching
//                         `instructions.routing_exempt` globs are left alone
//
// Mode, from the planning tree's config.json `hooks.guard`:
//   off      nothing
//   report   (default) every match is appended to <planning>/guard.jsonl, the call proceeds
//   enforce  as report, and secret_write, state_write, judge_write and unrouted_write
//            are denied (the writers of state.md go through pan-tools verbs since A7b);
//            undeclared_test_edit still only reports
//
// Inert outside a PAN project. Fail-open on anything it cannot parse; never fail-open
// on a matched deny. Never writes outside the planning tree.

const fs = require('fs');
const path = require('path');

const TOKEN_RE = /\b(?:sk-ant-[A-Za-z0-9_-]{10,}|sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[abprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{30,}|-----BEGIN (?:RSA |EC |OPENSSH |)PRIVATE KEY-----)/;
const SECRET_KV_RE = /\b(api[_-]?key|access[_-]?token|auth[_-]?token|refresh[_-]?token|client[_-]?secret|secret[_-]?key|password|passwd)\b["']?\s*[:=]\s*["']([^"'\s]{12,})["']/i;
const TEST_PATH_RE = /(^|\/)(tests?|__tests__|specs?)\//i;
const TEST_FILE_RE = /(\.(test|spec)\.[a-z0-9]+|(^|\/)test_[^/]+\.py|_test\.(py|go)|Tests?\.(java|kt|cs))$/i;
const MODES = ['off', 'report', 'enforce'];
// The agents that judge work and must not change it. Their reports go in the planning tree.
const JUDGES = new Set(['pan-verifier', 'pan-reviewer', 'pan-plan-checker', 'pan-design-checker']);
const DENIED = ['secret_write', 'state_write', 'judge_write', 'unrouted_write'];

// ─── R39: one run per hook when Claude and Copilot share a project ───────────
// Copilot CLI also runs the hooks in a repository's .claude/settings.json and
// .claude/settings.local.json. Measured 2026-09-26 (Copilot CLI 1.0.88, repository
// hooks loaded): in a project with both the Claude and the Copilot install, every
// PAN hook ran twice under Copilot — once from .github/hooks/pan.json, once from the
// Claude settings. The Copilot project copy (this file under .github/hooks) steps
// aside whenever the project's Claude settings register the same script, so the hook
// runs once, and runs again from here the moment the Claude registration is gone.
// Both files are repository hooks to Copilot and load under the same trust rule, so
// deferring never leaves zero. Only this copy defers: Claude Code never reads
// .github/hooks, Gemini and Codex never read .claude/settings.json, and a global
// Copilot copy loads where repository hooks may not. Identical in every hook
// Copilot registers — tests/copilot-hook-dedupe.test.cjs pins the copies.
function deferToClaudeRegistration(projectDir, hookFile = __filename) {
  // Assembled, not written as a literal: the installer rewrites every quoted .claude
  // literal in a hook copy to that runtime's own directory, and this one must stay Claude's.
  const claudeDir = ['.', 'claude'].join('');
  try {
    const hooksDir = path.dirname(hookFile);
    if (path.basename(hooksDir) !== 'hooks' || path.basename(path.dirname(hooksDir)) !== '.github') return false;
    if (typeof projectDir !== 'string' || !projectDir) return false;
    const script = path.basename(hookFile);
    for (const name of ['settings.json', 'settings.local.json']) {
      let settings;
      try { settings = JSON.parse(fs.readFileSync(path.join(projectDir, claudeDir, name), 'utf8')); } catch { continue; }
      const events = settings && typeof settings.hooks === 'object' ? settings.hooks : null;
      if (!events) continue;
      for (const groups of Object.values(events)) {
        if (!Array.isArray(groups)) continue;
        for (const group of groups) {
          const handlers = group && Array.isArray(group.hooks) ? group.hooks : [];
          if (handlers.some((h) => h && typeof h.command === 'string' && h.command.includes(script))) return true;
        }
      }
    }
  } catch { /* fail open: run this copy */ }
  return false;
}


function planningDirName() {
  const raw = process.env.PAN_PLANNING_DIR || '';
  if (raw.trim()) {
    const rel = raw.trim().replace(/\\/g, '/');
    const bad = rel.startsWith('/') || /^[A-Za-z]:/.test(rel) || rel.split('/').includes('..');
    if (!bad) return rel;
  }
  const track = (process.env.PAN_TRACK || '').trim();
  if (track && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(track)) return `.planning/tracks/${track}`;
  return '.planning';
}

function readJson(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}

/** A value that is a placeholder, not a credential. */
function isPlaceholder(v) {
  return /^(?:\$\{|\$[A-Z_]|process\.env|os\.environ|<|xxx|your[_-]|changeme|example|dummy|placeholder|redacted|\*+$)/i.test(v);
}

function hasSecret(text) {
  if (typeof text !== 'string' || !text) return false;
  if (TOKEN_RE.test(text)) return true;
  const m = text.match(SECRET_KV_RE);
  return !!(m && !isPlaceholder(m[2]) && /\d/.test(m[2]) && /[A-Za-z]/.test(m[2]));
}

/**
 * The tool call as `{tool, writes: [{path, text}], command}`, whatever the host.
 * Claude/Codex/Gemini send `tool_name` + `tool_input`; Copilot sends `toolName` +
 * `toolArgs` (a JSON string).
 */
function normalise(payload) {
  const p = payload && typeof payload === 'object' ? payload : {};
  const tool = String(p.tool_name || p.toolName || p.tool || '');
  let input = p.tool_input || p.toolArgs || p.input || {};
  if (typeof input === 'string') { try { input = JSON.parse(input); } catch { input = { command: input }; } }
  if (!input || typeof input !== 'object') input = {};
  const writes = [];
  const file = input.file_path || input.filePath || input.path || input.notebook_path || input.absolute_path;
  const texts = [input.content, input.new_string, input.newString, input.new_source, input.file_text, input.text]
    .concat(Array.isArray(input.edits) ? input.edits.map((e) => e && (e.new_string || e.newString)) : [])
    .filter((t) => typeof t === 'string');
  if (typeof file === 'string' && file && (texts.length || /write|edit|create|replace|notebook/i.test(tool))) {
    writes.push({ path: file, text: texts.join('\n') });
  }
  const command = typeof input.command === 'string' ? input.command : (Array.isArray(input.command) ? input.command.join(' ') : '');
  // Codex edits files through apply_patch: the patch names its files and carries the text.
  if (/\*\*\* (?:Add|Update) File: /.test(command)) {
    let cur = null;
    for (const line of command.split(/\r?\n/)) {
      const m = line.match(/^\*\*\* (?:Add|Update) File: (.+)$/);
      if (m) { cur = { path: m[1].trim(), text: '' }; writes.push(cur); continue; }
      if (cur && line.startsWith('+')) cur.text += line.slice(1) + '\n';
    }
  }
  const agent = String(p.agent_type || p.subagent_type || p.agentType || '') || null;
  return { tool, writes, command, agent };
}

/** Project-relative POSIX path, or null when the path is outside the project. */
function rel(projectDir, p) {
  const abs = path.resolve(projectDir, p);
  const r = path.relative(projectDir, abs).replace(/\\/g, '/');
  return r.startsWith('..') || path.isAbsolute(r) ? null : r;
}

function isTestFile(r) {
  return TEST_PATH_RE.test(r) || TEST_FILE_RE.test(r);
}

/** files_modified of the unfinished plans of the phase state.md names, or null when none is in flight. */
function declaredFiles(projectDir, planningRel) {
  let state;
  try { state = fs.readFileSync(path.join(projectDir, planningRel, 'state.md'), 'utf8'); } catch { return null; }
  const m = state.match(/\*\*Current Phase:\*\*[ \t]*([0-9]+(?:\.[0-9]+)?)/i) || state.match(/^Phase:[ \t]*([0-9]+(?:\.[0-9]+)?)/m);
  if (!m) return null;
  const want = String(parseFloat(m[1]));
  const phasesDir = path.join(projectDir, planningRel, 'phases');
  let dir;
  try { dir = fs.readdirSync(phasesDir).find((d) => { const n = d.match(/^(\d+(?:\.\d+)?)-/); return n && String(parseFloat(n[1])) === want; }); } catch { return null; }
  if (!dir) return null;
  const full = path.join(phasesDir, dir);
  const names = fs.readdirSync(full);
  const done = new Set(names.filter((n) => n.endsWith('-summary.md')).map((n) => n.replace(/-summary\.md$/, '')));
  const out = new Set();
  let plans = 0;
  for (const n of names.filter((x) => x.endsWith('-plan.md'))) {
    if (done.has(n.replace(/-plan\.md$/, ''))) continue;
    plans++;
    const text = fs.readFileSync(path.join(full, n), 'utf8').replace(/\r\n/g, '\n');
    const fm = text.match(/^---\n([\s\S]*?)\n---/);
    if (!fm) continue;
    const inline = fm[1].match(/^files_modified:[ \t]*\[([^\]]*)\]/m);
    if (inline) inline[1].split(',').map((s) => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean).forEach((f) => out.add(f.replace(/^\.\//, '')));
    const block = fm[1].match(/^files_modified:[ \t]*\n((?:[ \t]+-.*\n?)+)/m);
    if (block) block[1].split('\n').map((l) => l.replace(/^[ \t]+-[ \t]*/, '').trim().replace(/^["']|["']$/g, '')).filter(Boolean).forEach((f) => out.add(f.replace(/^\.\//, '')));
  }
  return plans ? out : null;
}

/** A routing_exempt glob as a RegExp over project-relative POSIX paths (`*`, `**`, `?`). */
function globRe(glob) {
  let re = '';
  const g = String(glob).replace(/\\/g, '/').replace(/^\.\//, '');
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === '*' && g[i + 1] === '*') { re += '.*'; i++; if (g[i + 1] === '/') i++; }
    else if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else re += /[.+^${}()|[\]\\]/.test(c) ? '\\' + c : c;
  }
  return new RegExp('^' + re + '$');
}

/**
 * Whether a PAN unit of work is in flight: an unfinished plan in the phase state.md
 * names, an open quick task (a plan with no summary), or an unresolved debug session.
 * Throws on what it cannot read beyond a missing directory; the caller fails open.
 */
function workInFlight(projectDir, planningRel) {
  if (declaredFiles(projectDir, planningRel)) return true;
  const list = (d) => { try { return fs.readdirSync(d); } catch (e) { if (e.code === 'ENOENT') return []; throw e; } };
  const quick = path.join(projectDir, planningRel, 'quick');
  for (const task of list(quick)) {
    let names;
    try { names = fs.readdirSync(path.join(quick, task)); } catch (e) { if (e.code === 'ENOTDIR') continue; throw e; }
    const done = new Set(names.filter((n) => n.endsWith('-summary.md')).map((n) => n.replace(/-summary\.md$/, '')));
    if (names.some((n) => n.endsWith('-plan.md') && !done.has(n.replace(/-plan\.md$/, '')))) return true;
  }
  return list(path.join(projectDir, planningRel, 'debug')).some((n) => n.endsWith('.md'));
}

/** unrouted_write: in exclusive routing, the writes outside the planning tree while nothing PAN runs is in flight. */
function unroutedWrites(call, projectDir, planningRel, cfg) {
  const instructions = cfg && cfg.instructions;
  if (!instructions || instructions.routing !== 'exclusive' || !call.writes.length) return [];
  if (call.agent && call.agent.startsWith('pan-')) return [];
  const exempt = (Array.isArray(instructions.routing_exempt) ? instructions.routing_exempt : [])
    .filter((g) => typeof g === 'string' && g).map(globRe);
  const outside = call.writes.map((w) => rel(projectDir, w.path))
    .filter((r) => r && r !== planningRel && !r.startsWith(`${planningRel}/`) && !exempt.some((re) => re.test(r)));
  if (!outside.length) return [];
  try { if (workInFlight(projectDir, planningRel)) return []; } catch { return []; } // fail open
  return outside.map((r) => ({ rule: 'unrouted_write', path: r }));
}

/** The rule matches for one normalised call. */
function evaluate(call, projectDir, planningRel, cfg = {}) {
  const hits = [];
  const declared = call.writes.length ? declaredFiles(projectDir, planningRel) : null;
  const ownState = new Set([`${planningRel}/state.md`, `${planningRel}/findings.jsonl`, `${planningRel}/metrics/tokens.jsonl`]);
  for (const w of call.writes) {
    const r = rel(projectDir, w.path);
    if (hasSecret(w.text)) hits.push({ rule: 'secret_write', path: r || w.path });
    if (!r) continue;
    if (ownState.has(r)) hits.push({ rule: 'state_write', path: r });
    if (call.agent && JUDGES.has(call.agent) && !(r === planningRel || r.startsWith(`${planningRel}/`))) hits.push({ rule: 'judge_write', path: r, agent: call.agent });
    if (declared && isTestFile(r) && !declared.has(r)) hits.push({ rule: 'undeclared_test_edit', path: r });
  }
  hits.push(...unroutedWrites(call, projectDir, planningRel, cfg));
  return hits;
}

function decide(hits, mode) {
  if (mode !== 'enforce') return null;
  for (const rule of DENIED) {
    const hit = hits.find((h) => h.rule === rule);
    if (hit) return hit;
  }
  return null;
}

/** The host whose deny format this call needs: Copilot by payload shape, else the --host flag. */
function hostOf(payload, flagHost) {
  const p = payload && typeof payload === 'object' ? payload : {};
  if (typeof p.toolName === 'string' && p.tool_name === undefined) return 'copilot';
  return flagHost;
}

function denyReason(deny) {
  if (deny.rule === 'state_write') {
    return `PAN guard: ${deny.path} is PAN's own state. Write it through pan-tools (\`pan-tools state init|section|apply|patch|update\`, \`findings record\`), which keeps it consistent, then retry. (hooks.guard: enforce)`;
  }
  if (deny.rule === 'unrouted_write') {
    return `PAN guard: this project does its work through PAN (instructions.routing: exclusive), and no PAN task is in flight for ${deny.path}. Start one with the quick command (or debug for a bug fix), then retry. (hooks.guard: enforce)`;
  }
  if (deny.rule === 'judge_write') {
    return `PAN guard: ${deny.agent} is a judge and does not change the work it judges (${deny.path}). Report the defect in your verdict instead; your own report goes in the planning tree. (hooks.guard: enforce)`;
  }
  return `PAN guard: this write puts a credential into ${deny.path}. Keep secrets out of the repository (an environment variable or a local, ignored file), then retry. (hooks.guard: enforce)`;
}

function main() {
  const flagHost = (process.argv[process.argv.indexOf('--host') + 1] || 'claude').toLowerCase();
  let raw = '';
  try { raw = fs.readFileSync(0, 'utf8'); } catch { return; }
  let payload;
  try { payload = JSON.parse(raw); } catch { return; } // fail open
  const projectDir = (payload && (payload.cwd || payload.workspace || payload.project_dir)) || process.env.CLAUDE_PROJECT_DIR || process.cwd();
  if (deferToClaudeRegistration(projectDir)) return; // the Claude registration covers this call under Copilot
  // The payload names the host better than the registration does: Copilot sends its own
  // camelCase payload (toolName, toolArgs) even to a hook registered in .claude/settings.json,
  // and denies only on the JSON decision, so a Copilot payload gets Copilot's deny whatever
  // --host says. The flag decides for the snake_case hosts (Claude Code, Codex, Gemini).
  const host = hostOf(payload, flagHost);
  const planningRel = planningDirName();
  const planning = path.join(projectDir, planningRel);
  if (!fs.existsSync(planning)) return; // not a PAN project
  const cfg = readJson(path.join(planning, 'config.json')) || {};
  const mode = MODES.includes(cfg.hooks && cfg.hooks.guard) ? cfg.hooks.guard : 'report';
  if (mode === 'off') return;
  let hits = [];
  try { hits = evaluate(normalise(payload), projectDir, planningRel, cfg); } catch { return; } // fail open
  if (!hits.length) return;
  const deny = decide(hits, mode);
  try {
    const ts = new Date().toISOString();
    const lines = hits.map((h) => JSON.stringify({ ts, host, mode, rule: h.rule, path: h.path, tool: normalise(payload).tool, action: deny && h === deny ? 'denied' : 'reported' }));
    fs.appendFileSync(path.join(planning, 'guard.jsonl'), lines.join('\n') + '\n');
  } catch { /* the log is best effort; a deny below still stands */ }
  if (!deny) return;
  const reason = denyReason(deny);
  if (host === 'copilot') {
    process.stdout.write(JSON.stringify({ permissionDecision: 'deny', permissionDecisionReason: reason }) + '\n');
    return;
  }
  process.stderr.write(reason + '\n');
  process.exitCode = 2;
}

if (require.main === module) main();

module.exports = { normalise, evaluate, decide, hasSecret, declaredFiles, isTestFile, hostOf, deferToClaudeRegistration, workInFlight, globRe };
