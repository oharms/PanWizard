'use strict';
/**
 * Local usage census (program L9): `pan-tools usage`.
 *
 * Which of the installed commands and agents this project has used, from its own
 * files only: the cost ledger (`.planning/metrics/tokens.jsonl`: `command` and `agent`
 * per row) and the trace sessions (`.planning/optimization/traces/<sess>/session.json`:
 * `command`, `ended_at`). It reports what was used (calls, last use), what was never
 * used, and commands that were started but never finished: every trace session for
 * the command stopped without ending, the newest more than UNFINISHED_AFTER_MS ago.
 * Nothing leaves the machine.
 */
const fs = require('fs');
const path = require('path');
const { output } = require('./core.cjs');
const { readRecords } = require('./cost.cjs');
const { planningPath } = require('./utils.cjs');

// A trace session still open after this long is not "running", it stopped.
const UNFINISHED_AFTER_MS = 6 * 60 * 60 * 1000;
// The install this engine ships in: <runtime dir>/pan-wizard-core/bin/lib → <runtime dir>.
const DEFAULT_INVENTORY = path.resolve(__dirname, '..', '..', '..');

/**
 * Whether a row's timestamp is inside a window that starts at `since` (epoch ms). A row with
 * no timestamp, or one that does not parse, is kept: dropping it would hide the row silently.
 */
function inWindow(ts, since) {
  if (!ts) return true;
  const t = Date.parse(ts);
  return !Number.isFinite(t) || t >= since;
}

/** A command name as the inventory spells it: `/pan:quick`, `pan-quick`, `pan:quick` → `quick`. */
function commandName(s) {
  return String(s || '').trim().replace(/^\//, '').replace(/^pan[:-]/, '');
}

/**
 * The installed commands and agents, in every runtime's layout: commands/pan/*.md (Claude),
 * commands/pan/*.toml (Gemini), commands/pan-*.md (OpenCode), skills/pan-* (Copilot), the
 * shared .agents/skills/pan-* beside the runtime directory (Codex, and every runtime under
 * --unified-skills), and agents/pan-*.md, .toml or .agent.md (Copilot).
 */
function readInventory(root) {
  const list = (d, re) => { try { return fs.readdirSync(d).filter((f) => re.test(f)); } catch { return []; } };
  const commands = new Set(list(path.join(root, 'commands', 'pan'), /\.(md|toml)$/).map((f) => f.replace(/\.(md|toml)$/, '')));
  for (const f of list(path.join(root, 'commands'), /^pan-.*\.md$/)) commands.add(commandName(f.replace(/\.md$/, '')));
  for (const skills of [path.join(root, 'skills'), path.join(root, '..', '.agents', 'skills')]) {
    for (const d of list(skills, /^pan-/)) commands.add(commandName(d));
  }
  const agents = new Set(list(path.join(root, 'agents'), /^pan-.*\.(md|toml)$/).map((f) => f.replace(/(\.agent)?\.(md|toml)$/, '')));
  return { commands: [...commands].sort(), agents: [...agents].sort() };
}

function readSessions(cwd) {
  const dir = planningPath(cwd, 'optimization', 'traces');
  let names = [];
  try { names = fs.readdirSync(dir).filter((n) => n.startsWith('sess_')); } catch { return []; }
  const out = [];
  for (const n of names) {
    try { out.push(JSON.parse(fs.readFileSync(path.join(dir, n, 'session.json'), 'utf-8'))); } catch { /* unreadable session */ }
  }
  return out;
}

/**
 * @param {string} cwd
 * @param {{inventory?: string, inv?: {commands: string[], agents: string[]}, now?: string, since?: number}} [opts]
 *   inv: the inventory already read; since: epoch ms, older rows and sessions are left out
 */
function usageCensus(cwd, opts = {}) {
  const inventory = opts.inv || readInventory(opts.inventory || DEFAULT_INVENTORY);
  const now = opts.now ? Date.parse(opts.now) : Date.now();
  const cmds = new Map(inventory.commands.map((n) => [n, { name: n, calls: 0, last_used: null, sessions: 0, finished: 0, _lastStart: null }]));
  const agents = new Map(inventory.agents.map((n) => [n, { name: n, calls: 0, last_used: null }]));
  const later = (a, b) => (!a || (b && b > a) ? b : a);

  const since = Number.isFinite(opts.since) ? opts.since : null;
  const kept = (ts) => since === null || inWindow(ts, since);
  const rows = readRecords(cwd).filter((r) => kept(r.ts));
  for (const r of rows) {
    const c = cmds.get(commandName(r.command));
    if (c) { c.calls++; c.last_used = later(c.last_used, r.ts || null); }
    const a = agents.get(String(r.agent || ''));
    if (a) { a.calls++; a.last_used = later(a.last_used, r.ts || null); }
  }
  const sessions = readSessions(cwd).filter((s) => kept(s.started_at));
  for (const s of sessions) {
    const c = cmds.get(commandName(s.command));
    if (!c) continue;
    c.sessions++;
    if (s.ended_at) c.finished++;
    c._lastStart = later(c._lastStart, s.started_at || null);
    c.last_used = later(c.last_used, s.ended_at || s.started_at || null);
  }
  const byUse = (a, b) => b.calls - a.calls || String(b.last_used).localeCompare(String(a.last_used)) || a.name.localeCompare(b.name);
  const pub = ({ _lastStart, ...rest }) => rest;
  const cmdList = [...cmds.values()];
  const used = cmdList.filter((c) => c.calls > 0 || c.sessions > 0);
  const unfinished = used.filter((c) => c.sessions > 0 && c.finished === 0 && c._lastStart && now - Date.parse(c._lastStart) > UNFINISHED_AFTER_MS);
  const agentList = [...agents.values()];
  return {
    local_only: true,
    commands: {
      used: used.sort(byUse).map(pub),
      never_used: cmdList.filter((c) => c.calls === 0 && c.sessions === 0).map((c) => c.name).sort(),
      unfinished: unfinished.sort(byUse).map(pub),
      installed: inventory.commands.length,
    },
    agents: {
      used: agentList.filter((a) => a.calls > 0).sort(byUse),
      never_used: agentList.filter((a) => a.calls === 0).map((a) => a.name).sort(),
      installed: inventory.agents.length,
    },
    sources: { cost_rows: rows.length, trace_sessions: sessions.length },
  };
}

function cmdUsage(cwd, raw) {
  const r = usageCensus(cwd);
  output(r, raw, `${r.commands.used.length} of ${r.commands.installed} commands used, ${r.commands.unfinished.length} unfinished; ${r.agents.used.length} of ${r.agents.installed} agents used`);
}

module.exports = { usageCensus, readInventory, commandName, inWindow, cmdUsage, UNFINISHED_AFTER_MS };
