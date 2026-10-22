// scripts/local-schedule.cjs — the weekly checks moved from GitHub's schedule to the Windows
// Task Scheduler. The schtasks calls are built by pure functions and checked here with a fake
// schtasks: what --install registers, that --uninstall removes exactly that and nothing else,
// and that requiring the module runs nothing.

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SCRIPT = path.join(__dirname, '..', 'scripts', 'local-schedule.cjs');
const S = require(SCRIPT);

const ROOT = 'C:\\Work\\R&D <pan>';
const NODE = 'C:\\Program Files\\nodejs\\node.exe';
const FROM = new Date(2026, 9, 22, 12, 0, 0); // a Thursday

describe('local-schedule: the task definitions', () => {
  test('three weekly jobs, each a PanWizard- task that runs this script with --run <job> in the checkout', () => {
    const plan = S.installPlan({ root: ROOT, node: NODE, from: FROM });
    assert.deepEqual(plan.map(p => p.name), ['PanWizard-codescan', 'PanWizard-outdated', 'PanWizard-market-watch']);
    for (const [i, p] of plan.entries()) {
      const job = S.JOBS[i];
      assert.deepEqual(p.args, ['/Create', '/TN', p.name, '/XML', '<xml file>', '/F']);
      assert.match(p.xml, /<Command>C:\\Program Files\\nodejs\\node\.exe<\/Command>/);
      assert.ok(p.xml.includes(`<Arguments>&quot;C:\\Work\\R&amp;D &lt;pan&gt;\\scripts\\local-schedule.cjs&quot; --run ${job.id}</Arguments>`), p.xml);
      assert.ok(p.xml.includes('<WorkingDirectory>C:\\Work\\R&amp;D &lt;pan&gt;</WorkingDirectory>'), 'the root is XML-escaped');
      assert.match(p.xml, /<StartWhenAvailable>true<\/StartWhenAvailable>/, 'a run missed while the machine was off starts later');
      assert.match(p.xml, /<RunLevel>LeastPrivilege<\/RunLevel>/, 'no admin');
      assert.match(p.xml, /<LogonType>InteractiveToken<\/LogonType>/, 'the current user, no stored password');
      assert.match(p.xml, /<WeeksInterval>1<\/WeeksInterval>/);
    }
    assert.match(plan[0].xml, /<DaysOfWeek><Sunday \/><\/DaysOfWeek>/);
    assert.match(plan[0].xml, /<StartBoundary>2026-10-25T03:00:00<\/StartBoundary>/, 'the next Sunday at 03:00');
    assert.match(plan[1].xml, /<StartBoundary>2026-10-26T09:00:00<\/StartBoundary>/);
    assert.match(plan[2].xml, /<StartBoundary>2026-10-26T09:10:00<\/StartBoundary>/);
  });

  test('--uninstall deletes exactly the tasks --install creates', () => {
    const made = S.installPlan({ root: ROOT, node: NODE, from: FROM }).map(p => p.name);
    const gone = S.uninstallPlan().map(p => p.name);
    assert.deepEqual(gone, made);
    for (const p of S.uninstallPlan()) assert.deepEqual(p.args, ['/Delete', '/TN', p.name, '/F']);
  });

  test('cron lines for the same schedule off Windows', () => {
    assert.deepEqual(S.cronLines({ root: '/r', node: '/n' }), [
      "0 3 * * 0 cd '/r' && '/n' scripts/local-schedule.cjs --run codescan",
      "0 9 * * 1 cd '/r' && '/n' scripts/local-schedule.cjs --run outdated",
      "10 9 * * 1 cd '/r' && '/n' scripts/local-schedule.cjs --run market-watch",
    ]);
  });
});

describe('local-schedule: against a fake schtasks', () => {
  function fakeSchtasks(existing) {
    const calls = [];
    const tasks = new Set(existing);
    const exec = (args) => {
      calls.push(args);
      const name = args[args.indexOf('/TN') + 1];
      if (args[0] === '/Create') {
        const xml = fs.readFileSync(args[args.indexOf('/XML') + 1]);
        assert.deepEqual([...xml.subarray(0, 2)], [0xff, 0xfe], 'UTF-16 with a byte-order mark');
        assert.match(xml.subarray(2).toString('utf16le'), /<Task version=/);
        tasks.add(name);
        return { status: 0, stdout: 'SUCCESS', stderr: '' };
      }
      if (args[0] === '/Query') return tasks.has(name) ? { status: 0, stdout: `TaskName: \\${name}\nNext Run Time: 25/10/2026 03:00:00\nLast Run Time: N/A\nLast Result: 267011\n`, stderr: '' } : { status: 1, stdout: '', stderr: 'ERROR: The system cannot find the file specified.' };
      if (args[0] === '/Delete') { tasks.delete(name); return { status: 0, stdout: 'SUCCESS', stderr: '' }; }
      return { status: 1, stdout: '', stderr: 'unexpected' };
    };
    return { exec, calls, tasks };
  }

  test('install registers the three tasks; uninstall removes them and leaves every other task alone', () => {
    const f = fakeSchtasks(['SomeoneElse', 'PanWizard-unrelated-name']);
    const done = S.install({ root: ROOT, node: NODE, exec: f.exec, from: FROM });
    assert.deepEqual(done, ['PanWizard-codescan', 'PanWizard-outdated', 'PanWizard-market-watch']);
    assert.equal(f.tasks.size, 5);
    const removed = S.uninstall({ exec: f.exec });
    assert.deepEqual(removed, done);
    assert.deepEqual([...f.tasks].sort(), ['PanWizard-unrelated-name', 'SomeoneElse']);
    assert.ok(f.calls.every(a => a[0] !== '/Delete' || done.includes(a[2])), 'nothing else is deleted');
  });

  test('uninstall with nothing installed deletes nothing', () => {
    const f = fakeSchtasks([]);
    assert.deepEqual(S.uninstall({ exec: f.exec }), []);
    assert.equal(f.calls.filter(a => a[0] === '/Delete').length, 0);
  });

  test('a failed create stops the install and says which', () => {
    const exec = (args) => (args[0] === '/Create' ? { status: 1, stdout: '', stderr: 'ERROR: Access is denied.' } : { status: 1 });
    assert.throws(() => S.install({ root: ROOT, node: NODE, exec, from: FROM }), /Access is denied/);
  });

  test('--list shows each task and its latest report', () => {
    const f = fakeSchtasks(['PanWizard-codescan']);
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-sched-list-'));
    fs.mkdirSync(S.reportDir(root, 'outdated'), { recursive: true });
    fs.writeFileSync(path.join(S.reportDir(root, 'outdated'), 'last-run.json'), JSON.stringify({ job: 'outdated', status: 'report', at: '2026-10-19T09:00:04.000Z', report: '.ci-local/scheduled/outdated/x.md' }));
    const out = S.list({ root, exec: f.exec });
    assert.match(out, /PanWizard-codescan {2}Sunday 03:00 {2}next: 25\/10\/2026 03:00:00/);
    assert.match(out, /PanWizard-outdated {2}not installed/);
    assert.match(out, /latest report: 2026-10-19T09:00 report — \.ci-local\/scheduled\/outdated\/x\.md/);
    fs.rmSync(root, { recursive: true, force: true });
  });
});

describe('local-schedule: running a job', () => {
  test('--run outdated writes a dated report and last-run.json that latestReports finds', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-sched-run-'));
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'p', version: '0.0.0' }));
    const last = S.runJob('outdated', root);
    assert.equal(last.status, 'pass', JSON.stringify(last));
    assert.match(last.report, /^\.ci-local\/scheduled\/outdated\/\d{8}-\d{6}\.md$/);
    assert.match(fs.readFileSync(path.join(root, last.report), 'utf8'), /every dependency is current/);
    assert.deepEqual(S.latestReports(root).outdated, last);
    assert.throws(() => S.runJob('nope', root), /unknown job/);
    fs.rmSync(root, { recursive: true, force: true });
  });

  test('requiring the module runs nothing', () => {
    const probe = `const cp = require('child_process'); let n = 0;
for (const k of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) cp[k] = () => { n++; throw new Error('ran ' + k); };
require(${JSON.stringify(SCRIPT)}); process.stdout.write(String(n));`;
    const r = spawnSync(process.execPath, ['-e', probe], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout, '0');
  });

  test('the CLI refuses an fnm session shim as the node to schedule', () => {
    const r = spawnSync(process.execPath, [SCRIPT, '--install', '--node', 'C:\\Users\\u\\AppData\\Local\\fnm_multishells\\123\\node.exe', '--root', os.tmpdir()], { encoding: 'utf8' });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /fnm session shim/);
  });
});
