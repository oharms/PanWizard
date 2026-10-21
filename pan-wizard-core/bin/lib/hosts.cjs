'use strict';
/**
 * One host table (program A0): how PAN runs each host CLI.
 *
 *   runner    the autonomous runner (experiments; the autodev launch builds on it):
 *             `buildArgs(prompt, opts)` for a run that acts on its own, and `shell`
 *             ('win32' launches the npm .cmd shim through a shell on Windows, where
 *             spawnSync cannot resolve it). null: no adapter is written yet.
 *   family    the model family the host runs by default; the cross-family review lane
 *             (R4) exists to get a second opinion from a different one. Copilot and
 *             OpenCode route to several vendors, so theirs names the router.
 *   review    the cross-family review lane (R4): a read-only run, `promptVia` and
 *             `args(prompt)`. No flag that writes or auto-approves tools: the reviewer
 *             reads the change it is given and answers with a verdict block.
 *   headless  the harness's model steps: `promptVia` ('stdin' | 'arg'), `args(prompt)`
 *             for hosts whose JSON is not parsed yet, and `parse: true` for the one
 *             whose output and usage PAN reads (Claude Code; its argv is built by the
 *             harness with the step's options).
 *
 * runner.cjs and harness/src/model.cjs used to keep their own tables, and a host change
 * had to be made twice. tests/hosts.test.cjs pins the argv both produce.
 */

const HOSTS = Object.freeze({
  claude: Object.freeze({
    bin: 'claude',
    family: 'anthropic',
    review: Object.freeze({ promptVia: 'stdin', args: () => ['-p', '--allowedTools', 'Read,Grep,Glob', '--output-format', 'text'] }),
    runner: Object.freeze({
      bin: 'claude',
      buildArgs: (prompt, opts) => {
        const args = ['-p', '--dangerously-skip-permissions'];
        if (opts && opts.captureMetrics) args.push('--output-format', 'json');
        args.push(prompt);
        return args;
      },
      shell: 'win32',
    }),
    headless: Object.freeze({ bin: 'claude', promptVia: 'stdin', parse: true }),
  }),
  codex: Object.freeze({
    bin: 'codex',
    family: 'openai',
    review: Object.freeze({ promptVia: 'stdin', args: () => ['exec', '--sandbox', 'read-only', '--skip-git-repo-check', '-'] }),
    runner: Object.freeze({ bin: 'codex', buildArgs: (prompt) => ['exec', prompt], shell: 'win32' }),
    // `codex exec -` reads the prompt from stdin; --json streams JSONL events.
    headless: Object.freeze({ bin: 'codex', promptVia: 'stdin', args: () => ['exec', '--json', '--skip-git-repo-check', '--dangerously-bypass-approvals-and-sandbox', '-'] }),
  }),
  copilot: Object.freeze({
    bin: 'copilot',
    family: 'github',
    // No --allow-all-tools: a non-interactive run is refused any tool it would ask about.
    review: Object.freeze({ promptVia: 'arg', args: (p) => ['-p', p] }),
    // No autonomous adapter yet: `copilot -p` exists, but nothing is written around it.
    runner: null,
    // `-p` takes the prompt as an argument; --output-format json is JSONL.
    headless: Object.freeze({ bin: 'copilot', promptVia: 'arg', args: (p) => ['-p', p, '--output-format', 'json', '--allow-all-tools', '--allow-all-paths'] }),
  }),
  gemini: Object.freeze({
    bin: 'gemini',
    family: 'google',
    // Headless `-p` appends standard input to its prompt; default approval refuses writes.
    review: Object.freeze({ promptVia: 'stdin', args: () => ['-p', 'Review the change on standard input. Reply with the pan-verdict block only.'] }),
    runner: Object.freeze({ bin: 'gemini', buildArgs: (prompt) => ['-p', '--yolo', prompt], shell: 'win32' }),
    // `-p` runs headless; -o json; --approval-mode yolo auto-approves tools.
    headless: Object.freeze({ bin: 'gemini', promptVia: 'arg', args: (p) => ['-p', p, '-o', 'json', '--approval-mode', 'yolo'] }),
  }),
  opencode: Object.freeze({
    bin: 'opencode',
    family: 'opencode',
    review: Object.freeze({ promptVia: 'arg', args: (p) => ['run', p] }),
    runner: Object.freeze({ bin: 'opencode', buildArgs: (prompt) => [prompt], shell: 'win32' }),
    // `run <message..>` with --format json (raw JSON events).
    headless: Object.freeze({ bin: 'opencode', promptVia: 'arg', args: (p) => ['run', '--format', 'json', p] }),
  }),
});

/** The runner adapters by host, as runner.cjs exposes them (RUNTIME_RUNNERS). */
function runnerTable() {
  return Object.freeze(Object.fromEntries(Object.entries(HOSTS).map(([k, h]) => [k, h.runner])));
}

/** The headless model-step entries by host, as the harness exposes them (MODEL_RUNTIMES). */
function headlessTable() {
  return Object.fromEntries(Object.entries(HOSTS).map(([k, h]) => [k, h.headless]));
}

module.exports = { HOSTS, runnerTable, headlessTable };
