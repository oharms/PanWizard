'use strict';
/**
 * One next-action router (program L7): `pan-tools next-action`.
 *
 * progress, resume and transition each kept their own routing table over the same
 * facts. They now ask this verb, which reads the disk (roadmap.md and the phase
 * directories) into the snapshot the MCP orchestrator's state machine
 * (mcp/orchestrator.cjs `nextAction`) keys on, and maps its decision to the command
 * that carries it out.
 *
 * Run facts on disk: a phase is `verified` when it has a verification file, and
 * finished (`merged` in the state machine's words) when its roadmap checkbox is ticked,
 * which `phase complete` does. Two interactive routes come before the machine: diagnosed
 * UAT gaps are planned first, and a project between milestones (roadmap but no
 * requirements.md) starts the next one.
 */

const fs = require('fs');
const path = require('path');
const { output } = require('./core.cjs');
const { planningPath } = require('./utils.cjs');
const { enumerateRoadmapPhases, enrichPhaseWithDiskStatus } = require('./roadmap.cjs');
const { nextAction } = require('../../mcp/orchestrator.cjs');

function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function phaseDir(cwd, number) {
  const root = path.join(planningPath(cwd), 'phases');
  const num = String(number);
  const padded = num.includes('.') ? num : num.padStart(2, '0');
  try {
    const d = fs.readdirSync(root, { withFileTypes: true })
      .find((e) => e.isDirectory() && (e.name === padded || e.name.startsWith(`${padded}-`) || e.name.startsWith(`${num}-`)));
    return d ? path.join(root, d.name) : null;
  } catch { return null; }
}

function listDir(dir) {
  try { return fs.readdirSync(dir); } catch { return []; }
}

/**
 * The state machine's snapshot, read from disk.
 * @returns {{phases: Array<{number, status, verified, merged, uat_gaps}>, roadmap: boolean, requirements: boolean}}
 */
function diskSnapshot(cwd) {
  const planning = planningPath(cwd);
  let content = null;
  try { content = fs.readFileSync(path.join(planning, 'roadmap.md'), 'utf8').replace(/\r\n/g, '\n'); } catch {}
  const requirements = fs.existsSync(path.join(planning, 'requirements.md'));
  if (content === null) return { phases: [], roadmap: false, requirements };
  const phases = enumerateRoadmapPhases(content).map((raw) => {
    const p = enrichPhaseWithDiskStatus(cwd, raw);
    const dir = phaseDir(cwd, p.number);
    const files = dir ? listDir(dir) : [];
    const ticked = new RegExp(`-\\s*\\[x\\]\\s*.*Phase\\s+${escapeRegex(p.number)}\\b`, 'i').test(content);
    const uatGaps = files.filter((f) => /uat\.md$/i.test(f)).some((f) => {
      try { return /^status:\s*diagnosed\s*$/m.test(fs.readFileSync(path.join(dir, f), 'utf8')); } catch { return false; }
    });
    return {
      number: p.number,
      status: p.disk_status === 'no_directory' ? 'empty' : p.disk_status,
      verified: files.some((f) => f === 'verification.md' || f.endsWith('-verification.md')),
      merged: ticked,
      uat_gaps: uatGaps,
    };
  });
  return { phases, roadmap: true, requirements };
}

const COMMANDS = {
  plan: (n) => `/pan:plan-phase ${n}`,
  execute: (n) => `/pan:exec-phase ${n}`,
  verify: (n) => `/pan:verify-phase ${n}`,
  complete_phase: (n) => `pan-tools phase complete ${n}`,
  plan_gaps: (n) => `/pan:plan-phase ${n} --gaps`,
  audit_milestone: () => '/pan:milestone-audit',
  new_milestone: () => '/pan:milestone-new',
  new_project: () => '/pan:new-project',
};

/**
 * Decide the next step for the project at `cwd`.
 * @returns {{action: string, phase: string|null, reason: string, command: string|null, done: boolean}}
 */
function routeNextAction(cwd) {
  const snap = diskSnapshot(cwd);
  const result = (action, phase, reason, done = false) => ({
    action, phase: phase == null ? null : String(phase), reason,
    command: COMMANDS[action] ? COMMANDS[action](phase) : null, done,
  });
  if (!snap.roadmap) return result('new_project', null, 'no_roadmap');
  if (!snap.requirements) return result('new_milestone', null, 'between_milestones');

  const open = snap.phases.find((p) => !(p.verified && p.merged));
  if (open && open.uat_gaps) return result('plan_gaps', open.number, 'uat_gaps_diagnosed');

  const d = nextAction({ phases: snap.phases });
  if (d.action === 'request_merge') return result('complete_phase', d.args.phase, d.reason);
  if (d.action === 'stop' && d.reason === 'all_complete') return result('audit_milestone', null, 'all_phases_complete');
  if (d.action === 'stop') return result('stop', null, d.reason, d.done);
  return result(d.action, d.args && d.args.phase, d.reason);
}

function cmdNextAction(cwd, raw) {
  const r = routeNextAction(cwd);
  output(r, raw, r.command || r.action);
}

module.exports = { diskSnapshot, routeNextAction, cmdNextAction };
