#!/usr/bin/env node
/**
 * local-schedule.cjs — the weekly checks GitHub used to run on a schedule, run by this
 * machine's Windows Task Scheduler instead (local-first plan, phase 2).
 *
 *   codescan      Sunday 03:00   a whole-tree code scan through local-ci.cjs: the CodeQL CLI
 *                                (security-extended) when installed, else Semgrep in Docker
 *   outdated      Monday 09:00   `npm outdated`, in place of Dependabot's pull requests
 *   market-watch  Monday 09:10   harness/autopilot/market-watch.cjs (the WATCH triggers)
 *
 * Usage:
 *   node scripts/local-schedule.cjs --install [--root <checkout>] [--node <node.exe>]
 *   node scripts/local-schedule.cjs --uninstall          removes exactly the tasks --install adds
 *   node scripts/local-schedule.cjs --list               the tasks, their last result, the latest reports
 *   node scripts/local-schedule.cjs --run <job>          what a task runs; also by hand
 *
 * Tasks are registered for the current user (schtasks, no admin) from an XML definition, so
 * a run missed while the machine was off starts when it is next on. Each task runs this
 * script with `--run <job>` in the checkout given by --root, by default the repository's
 * main worktree (a linked worktree is deleted when its branch lands). Reports go to
 * <checkout>/.ci-local/scheduled/<job>/ (gitignored): a <stamp>.md summary, a <stamp>.log,
 * and last-run.json, which harness/autopilot/state-of-pan.cjs links. Off Windows, --install
 * prints the equivalent crontab lines instead. Requiring this file runs nothing.
 */

'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SCRIPT_ROOT = path.resolve(__dirname, '..');
const TASK_PREFIX = 'PanWizard-';
const DAYS = { SUN: 'Sunday', MON: 'Monday', TUE: 'Tuesday', WED: 'Wednesday', THU: 'Thursday', FRI: 'Friday', SAT: 'Saturday' };
const CRON_DAY = { SUN: 0, MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6 };

const JOBS = [
  { id: 'codescan', day: 'SUN', time: '03:00', description: 'PAN Wizard: weekly whole-tree code scan (CodeQL CLI, else Semgrep in Docker)' },
  { id: 'outdated', day: 'MON', time: '09:00', description: 'PAN Wizard: weekly npm outdated report (in place of Dependabot)' },
  { id: 'market-watch', day: 'MON', time: '09:10', description: 'PAN Wizard: weekly market watcher (harness/autopilot/market-watch.cjs)' },
];

const taskName = (job) => `${TASK_PREFIX}${job.id}`;

function xmlEscape(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// The first `day` on or after `from`, at `time`, as a local timestamp without a zone (what
// Task Scheduler's StartBoundary takes).
function startBoundary(day, time, from = new Date()) {
  const d = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  while (d.getDay() !== CRON_DAY[day]) d.setDate(d.getDate() + 1);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${time}:00`;
}

/** The Task Scheduler definition for one job. Pure. */
function taskXml(job, { root, node, from }) {
  // A Task Scheduler definition is a Windows path whichever host builds it.
  const script = path.win32.join(root, 'scripts', 'local-schedule.cjs');
  return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>${xmlEscape(job.description)}</Description>
    <Author>PAN Wizard scripts/local-schedule.cjs</Author>
  </RegistrationInfo>
  <Triggers>
    <CalendarTrigger>
      <StartBoundary>${startBoundary(job.day, job.time, from)}</StartBoundary>
      <Enabled>true</Enabled>
      <ScheduleByWeek>
        <DaysOfWeek><${DAYS[job.day]} /></DaysOfWeek>
        <WeeksInterval>1</WeeksInterval>
      </ScheduleByWeek>
    </CalendarTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <StartWhenAvailable>true</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <ExecutionTimeLimit>PT4H</ExecutionTimeLimit>
    <Enabled>true</Enabled>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>${xmlEscape(node)}</Command>
      <Arguments>${xmlEscape(`"${script}" --run ${job.id}`)}</Arguments>
      <WorkingDirectory>${xmlEscape(root)}</WorkingDirectory>
    </Exec>
  </Actions>
</Task>
`;
}

/** The schtasks calls --install makes, one per job, each with the XML it registers. Pure. */
function installPlan({ root, node, from }) {
  return JOBS.map((job) => ({ name: taskName(job), xml: taskXml(job, { root, node, from }), args: ['/Create', '/TN', taskName(job), '/XML', '<xml file>', '/F'] }));
}

/** The schtasks calls --uninstall makes: a delete for every task --install creates. Pure. */
function uninstallPlan() {
  return JOBS.map((job) => ({ name: taskName(job), args: ['/Delete', '/TN', taskName(job), '/F'] }));
}

function cronLines({ root, node }) {
  return JOBS.map((job) => {
    const [h, m] = job.time.split(':').map(Number);
    return `${m} ${h} * * ${CRON_DAY[job.day]} cd '${root}' && '${node}' scripts/local-schedule.cjs --run ${job.id}`;
  });
}

const schtasks = (args) => spawnSync('schtasks', args, { encoding: 'utf8', windowsHide: true });

// The repository's main worktree: the first entry `git worktree list` prints.
function mainWorktree(cwd) {
  const r = spawnSync('git', ['worktree', 'list', '--porcelain'], { cwd, encoding: 'utf8' });
  const m = r.status === 0 && r.stdout.match(/^worktree (.+)$/m);
  return m ? path.resolve(m[1].trim()) : cwd;
}

function reportDir(root, job) {
  return path.join(root, '.ci-local', 'scheduled', job);
}

/** The latest run of each job in `root`, from its last-run.json: { job: {status, at, report} }. */
function latestReports(root) {
  const out = {};
  for (const job of JOBS) {
    try { out[job.id] = JSON.parse(fs.readFileSync(path.join(reportDir(root, job.id), 'last-run.json'), 'utf8')); } catch { /* never ran */ }
  }
  return out;
}

function stamp(d = new Date()) {
  return d.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
}

function runCapture(cmd, args, opts) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', windowsHide: true, maxBuffer: 256 * 1024 * 1024, timeout: 4 * 60 * 60 * 1000, ...opts });
  return { status: r.error ? null : r.status, out: `${r.stdout || ''}${r.stderr || ''}${r.error ? `\n${r.error.message}\n` : ''}` };
}

// Each job returns { status: 'pass'|'fail'|'report', summary: markdown, log }.
const RUNNERS = {
  codescan(root) {
    const out = path.join(reportDir(root, 'codescan'), 'ci-local');
    const r = runCapture(process.execPath, [path.join(root, 'scripts', 'local-ci.cjs'), '--root', root, '--out', out, '--only', 'codescan', '--codescan-all'], { cwd: root });
    let gate = null;
    try { gate = JSON.parse(fs.readFileSync(path.join(out, 'report.json'), 'utf8')).gates.find((g) => g.id === 'codescan'); } catch { /* no report */ }
    const status = r.status === 0 ? (gate && gate.status === 'skip' ? 'skip' : 'pass') : 'fail';
    return { status, log: r.out, summary: `- ${gate ? `${gate.title}: ${gate.status.toUpperCase()}${gate.detail ? ` — ${gate.detail}` : ''}` : `local-ci exited ${r.status}`}\n- gate log: ${gate && gate.log ? path.join(out, 'logs', 'codescan.log') : '—'}\n` };
  },
  outdated(root) {
    // npm outdated exits 1 when anything is outdated: that is the report, not a failure.
    const r = runCapture('npm outdated --json --long', [], { cwd: root, shell: true });
    let data = {};
    try { data = JSON.parse(r.out.slice(r.out.indexOf('{'))); } catch { if (r.status !== 0 && r.status !== 1) return { status: 'fail', log: r.out, summary: `- npm outdated failed (exit ${r.status})\n` }; }
    const names = Object.keys(data).sort();
    const lines = names.length
      ? ['| Package | Type | Current | Wanted | Latest |', '|---|---|---|---|---|', ...names.map((n) => { const p = data[n]; return `| ${n} | ${p.type || ''} | ${p.current || '—'} | ${p.wanted} | ${p.latest} |`; })]
      : ['- every dependency is current'];
    return { status: names.length ? 'report' : 'pass', log: r.out, summary: lines.join('\n') + '\n' };
  },
  'market-watch'(root) {
    const r = runCapture(process.execPath, [path.join(root, 'harness', 'autopilot', 'market-watch.cjs')], { cwd: root });
    return { status: r.status === 0 ? 'pass' : 'fail', log: r.out, summary: `- exit ${r.status}; fired triggers go to harness/autopilot/state/inbox.md\n\n\`\`\`\n${r.out.trim().split(/\r?\n/).slice(-20).join('\n')}\n\`\`\`\n` };
  },
};

function runJob(id, root) {
  const job = JOBS.find((j) => j.id === id);
  if (!job) throw new Error(`unknown job ${id}; one of ${JOBS.map((j) => j.id).join(', ')}`);
  const dir = reportDir(root, id);
  fs.mkdirSync(dir, { recursive: true });
  const at = new Date();
  const s = stamp(at);
  const r = RUNNERS[id](root);
  const report = path.join(dir, `${s}.md`);
  fs.writeFileSync(path.join(dir, `${s}.log`), r.log);
  fs.writeFileSync(report, `# ${id} — ${at.toISOString()}\n\nStatus: **${r.status}**\n\n${r.summary}`);
  const last = { job: id, status: r.status, at: at.toISOString(), report: path.relative(root, report).replace(/\\/g, '/') };
  fs.writeFileSync(path.join(dir, 'last-run.json'), JSON.stringify(last, null, 2) + '\n');
  return last;
}

function install({ root, node, exec = schtasks, from }) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-schedule-'));
  const done = [];
  try {
    for (const step of installPlan({ root, node, from })) {
      const file = path.join(tmp, `${step.name}.xml`);
      // Task Scheduler reads its XML as UTF-16 with a byte-order mark.
      fs.writeFileSync(file, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(step.xml, 'utf16le')]));
      const r = exec(step.args.map((a) => (a === '<xml file>' ? file : a)));
      if (r.status !== 0) throw new Error(`schtasks ${step.args.slice(0, 3).join(' ')}: ${(r.stderr || r.stdout || '').trim()}`);
      done.push(step.name);
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  return done;
}

function uninstall({ exec = schtasks } = {}) {
  const removed = [];
  for (const step of uninstallPlan()) {
    if (exec(['/Query', '/TN', step.name]).status !== 0) continue;
    const r = exec(step.args);
    if (r.status !== 0) throw new Error(`schtasks /Delete ${step.name}: ${(r.stderr || r.stdout || '').trim()}`);
    removed.push(step.name);
  }
  return removed;
}

function list({ root, exec = schtasks }) {
  const latest = latestReports(root);
  const lines = [];
  for (const job of JOBS) {
    const q = exec(['/Query', '/TN', taskName(job), '/FO', 'LIST', '/V']);
    const field = (k) => ((q.stdout || '').match(new RegExp(`^${k}:\\s*(.*)$`, 'm')) || [])[1] || '—';
    // 267011 is SCHED_S_TASK_HAS_NOT_RUN; its Last Run Time is a 1999 placeholder.
    const last = field('Last Result') === '267011' ? 'never run' : `${field('Last Run Time')} (result ${field('Last Result')})`;
    lines.push(q.status === 0
      ? `${taskName(job)}  ${DAYS[job.day]} ${job.time}  next: ${field('Next Run Time')}  last: ${last}`
      : `${taskName(job)}  not installed`);
    const l = latest[job.id];
    lines.push(`  latest report: ${l ? `${l.at.slice(0, 16)} ${l.status} — ${l.report}` : 'none yet'}`);
  }
  return lines.join('\n');
}

function main(argv) {
  const get = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
  const root = path.resolve(get('--root') || mainWorktree(SCRIPT_ROOT));
  const node = get('--node') || process.execPath;
  if (argv.includes('--run')) {
    const last = runJob(get('--run'), root);
    console.log(`${last.job}: ${last.status} — ${last.report}`);
    return last.status === 'fail' ? 1 : 0;
  }
  if (argv.includes('--list')) {
    if (process.platform !== 'win32') { console.log(cronLines({ root, node }).join('\n')); return 0; }
    console.log(list({ root }));
    return 0;
  }
  if (argv.includes('--uninstall')) {
    if (process.platform !== 'win32') { console.log('remove these lines with `crontab -e`:\n' + cronLines({ root, node }).join('\n')); return 0; }
    const removed = uninstall();
    console.log(removed.length ? `removed: ${removed.join(', ')}` : 'nothing to remove');
    return 0;
  }
  if (argv.includes('--install')) {
    if (/fnm_multishells/i.test(node)) { console.error(`local-schedule: ${node} is an fnm session shim that disappears with its shell; pass --node <a stable node.exe>`); return 2; }
    if (!fs.existsSync(path.join(root, 'scripts', 'local-schedule.cjs'))) console.error(`local-schedule: warning — ${root} has no scripts/local-schedule.cjs yet (it lands with this branch); the tasks fail until it does`);
    if (process.platform !== 'win32') { console.log('add these lines with `crontab -e`:\n' + cronLines({ root, node }).join('\n')); return 0; }
    const done = install({ root, node });
    console.log(`installed for ${os.userInfo().username}, running in ${root}: ${done.join(', ')}`);
    console.log(list({ root }));
    return 0;
  }
  console.error('usage: local-schedule.cjs --install [--root DIR] [--node PATH] | --uninstall | --list | --run <codescan|outdated|market-watch>');
  return 2;
}

module.exports = { JOBS, TASK_PREFIX, taskName, taskXml, installPlan, uninstallPlan, cronLines, startBoundary, latestReports, reportDir, runJob, install, uninstall, list, main };

if (require.main === module) process.exit(main(process.argv.slice(2)));
