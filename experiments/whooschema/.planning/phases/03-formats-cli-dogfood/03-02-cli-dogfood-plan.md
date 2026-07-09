---
phase: 03-formats-cli-dogfood
plan: 02
type: execute
wave: 2
depends_on: ["01"]
files_modified:
  - bin/whooschema.js
  - dogfood/config.schema.json
  - dogfood/config.broken.json
  - package.json
autonomous: true
requirements: [CLI-01, CLI-02, CLI-03, CLI-04, DOG-01, DOG-02]
change_class: feature

must_haves:
  truths:
    - "`node bin/whooschema.js validate --schema <valid-schema> --data <valid-data>` exits 0 and stdout is exactly `OK\\n` (CLI-01)"
    - "`node bin/whooschema.js validate --schema <schema> --data <invalid-data>` exits 1 and stdout has one human-readable line per error formatted as `<path>: <rule> — <message>` (CLI-02)"
    - "`node bin/whooschema.js validate --schema <s> --data <d> --format json` exits 1 on invalid data and stdout is `JSON.stringify(errors) + '\\n'` (a parseable JSON array) (CLI-03)"
    - "`bin/whooschema.js` imports only from `node:util`, `node:fs/promises`, and `../src/validate.js` — NO commander/yargs/minimist dependencies (CLI-04)"
    - "`whooschema validate --schema dogfood/config.schema.json --data .planning/config.json` exits 0 and prints `OK` (DOG-01, SC-2)"
    - "`whooschema validate --schema dogfood/config.schema.json --data dogfood/config.broken.json` exits 1 and prints multiple error lines including `$.mode`, `$.depth`, and `$.workflow` paths (DOG-02)"
    - "Schema-load errors (bad regex, $ref cycle, dangling $ref) exit 2 — distinct from data-invalid (exit 1) and from usage errors (exit 2 also)"
    - "File-not-found and JSON-parse errors exit 2 with a clear stderr message"
    - "package.json declares `\"bin\": { \"whooschema\": \"./bin/whooschema.js\" }` so `npm link` / `npm install -g` installs the CLI"
    - "`bin/whooschema.js` starts with the shebang `#!/usr/bin/env node` so it is directly executable on Unix-like systems"
  artifacts:
    - path: "bin/whooschema.js"
      provides: "CLI entry point — parseArgs + file I/O + text/json output + exit codes 0/1/2 (CLI-01..04)"
      contains: "#!/usr/bin/env node"
      min_lines: 80
    - path: "dogfood/config.schema.json"
      provides: "Hand-written JSON Schema for PAN's .planning/config.json (DOG-01)"
      contains: "model_profile"
      min_lines: 30
    - path: "dogfood/config.broken.json"
      provides: "Deliberately-broken copy with 3 violations: enum (mode), type (depth), required (workflow) (DOG-02)"
      contains: "experimental"
      min_lines: 8
    - path: "package.json"
      provides: "bin field registers `whooschema` -> `./bin/whooschema.js`"
      contains: "\"bin\""
      min_lines: 20
  key_links:
    - from: "bin/whooschema.js"
      to: "src/validate.js"
      via: "import { validate } from '../src/validate.js'"
      pattern: "from ['\"]\\.\\./src/validate\\.js['\"]"
    - from: "bin/whooschema.js"
      to: "node:util parseArgs"
      via: "import { parseArgs } from 'node:util'"
      pattern: "parseArgs"
    - from: "package.json bin field"
      to: "bin/whooschema.js"
      via: "\"bin\": { \"whooschema\": \"./bin/whooschema.js\" }"
      pattern: "\"whooschema\"\\s*:\\s*\"\\./bin/whooschema\\.js\""
    - from: "dogfood/config.schema.json"
      to: ".planning/config.json"
      via: "DOG-01 manual smoke test: `node bin/whooschema.js validate --schema dogfood/config.schema.json --data .planning/config.json` -> OK"
      pattern: "model_profile"
---

<objective>
Add the `whooschema` command-line binary, the dogfood schema for PAN's own `.planning/config.json`, and a deliberately-broken copy that exercises the error-output path. Wire `bin` into `package.json` so the CLI is installable.

Purpose: The library-level `validate()` API has been complete since Phase 1+2. Phase 3 ships the *user-facing* surface — a CLI with conventional exit codes (0/1/2), a `--format json` flag for machine readers, and the dogfood proof that whooschema validates PAN's own config cleanly. This plan creates the binary and the dogfood schemas; Plan 03-03 writes the test suite that asserts the CLI's behavior contract.

The CLI is intentionally minimal: one subcommand (`validate`), four flags (`--schema`, `--data`, `--format`, `--help`), exit codes (0=valid, 1=invalid data, 2=usage/file/schema error). It uses `node:util.parseArgs` only — no `commander`/`yargs`/`minimist` (CLI-04). It reads two files via `node:fs/promises`, calls `validate()`, and prints either `OK` or a list of errors. Library code never calls `process.exit` — only the binary does.

Output:
- `bin/whooschema.js` (NEW) — shebang + parseArgs subcommand-via-positional + file I/O + text/json output + correct exit codes.
- `dogfood/config.schema.json` (NEW) — hand-written JSON Schema describing PAN's `.planning/config.json` shape (mode/depth/parallelization/commit_docs/model_profile/workflow).
- `dogfood/config.broken.json` (NEW) — deliberately-broken copy with three violations: enum (mode), type (depth), required (workflow missing keys).
- `package.json` (MODIFIED) — adds `"bin": { "whooschema": "./bin/whooschema.js" }` field. NO new dependencies.
- Manual smoke test passes: `node bin/whooschema.js validate --schema dogfood/config.schema.json --data .planning/config.json` prints `OK` and exits 0.
</objective>

<execution_context>
@./.claude/pan-wizard-core/workflows/execute-plan.md
@./.claude/pan-wizard-core/templates/summary.md
</execution_context>

<context>
@.planning/project.md
@.planning/roadmap.md
@.planning/state.md
@.planning/requirements.md
@.planning/phases/03-formats-cli-dogfood/03-research.md
@.planning/research/stack.md
@.planning/research/features.md
@.planning/research/pitfalls.md
@.planning/phases/03-formats-cli-dogfood/03-01-summary.md
@src/validate.js
@.planning/config.json
@package.json

<interfaces>
<!-- Public API consumed by the CLI (locked since Phase 1) -->

```js
// src/validate.js
import { validate } from '../src/validate.js';
const r = validate(schema, data);
// r: { valid: boolean, errors: ValidationError[] }
// ValidationError: { path: string, rule: string, message: string, value: unknown, expected?: unknown }

// loadSchema (called inside validate) THROWS on:
//   - invalid regex in `pattern` (LOAD-01)
//   - $ref cycle (REF-02 / LOAD-03)
//   - dangling $ref (LOAD-03)
// The CLI must catch these and exit 2 (schema error) — NOT exit 1 (data-invalid).
```

<!-- node:util.parseArgs (verified in 03-research.md §"Pattern 2: CLI Entry Point") -->

```js
import { parseArgs } from 'node:util';
const { values, positionals } = parseArgs({
  args: process.argv.slice(2),
  options: {
    schema: { type: 'string', short: 's' },
    data:   { type: 'string', short: 'd' },
    format: { type: 'string', default: 'text' },
    help:   { type: 'boolean', short: 'h', default: false }
  },
  allowPositionals: true,
  strict: true   // unknown flags throw -> exit 2
});
// positionals[0] is the subcommand: must be 'validate' or undefined.
```

<!-- Exit-code contract (locked by 03-research.md §"Common Pitfalls" — "CLI exit code conflation") -->

| Exit code | Meaning                                  | Example trigger                                     |
|-----------|------------------------------------------|------------------------------------------------------|
| 0         | Valid                                    | data passes schema                                   |
| 1         | Data invalid                             | data fails schema (validate returns errors)          |
| 2         | Usage / file / schema error              | unknown subcommand, missing flag, file not found, JSON.parse failure, validate() throws |

<!-- Output format contract (locked by CLI-01..03) -->

text mode (default):
  - Success: stdout = "OK\n", exit 0
  - Failure: stdout = "<path>: <rule> — <message>\n" per error, exit 1

json mode (--format json):
  - Success: stdout = "OK\n", exit 0
  - Failure: stdout = JSON.stringify(errors) + "\n", exit 1
  - The JSON array MUST end with exactly one trailing newline; JSON.parse(stdout) MUST succeed.

<!-- Anti-patterns (locked) -->
- DO NOT call `process.exit` from any file in src/. Only bin/whooschema.js calls exit.
- DO NOT use `console.log` — use `process.stdout.write` (synchronous on TTY/pipe; guarantees flush before exit).
- DO NOT pretty-print the JSON output (no 2-space indent) — flat JSON.stringify is the contract.
- DO NOT add color (no chalk/kleur — zero-dep constraint, and color is noise in piped/CI use).
- DO NOT support stdin, glob, multiple --data, --watch, --version — ALL post-v1.

<!-- PAN .planning/config.json shape (verified by direct read of file) -->

```json
{
  "mode": "yolo",
  "depth": "quick",
  "parallelization": true,
  "commit_docs": true,
  "model_profile": "balanced",
  "workflow": {
    "research": true,
    "plan_check": true,
    "verifier": true,
    "auto_advance": true
  }
}
```
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Create bin/whooschema.js (CLI binary with shebang + parseArgs + exit codes)</name>
  <files>bin/whooschema.js</files>
  <action>
Create the new file `bin/whooschema.js` with executable shebang and the full CLI logic. Closes CLI-01..04.

The file MUST:
1. Start with the shebang `#!/usr/bin/env node` on the very first line (no BOM, no leading comment).
2. Use `node:util.parseArgs` only (CLI-04 is non-negotiable — no commander/yargs/minimist).
3. Distinguish exit codes 0 (valid) / 1 (data-invalid) / 2 (usage/file/schema error).
4. Use `process.stdout.write` and `process.stderr.write` (NOT `console.log` — flush guarantee).
5. Catch ALL three failure layers separately:
   - parseArgs throw → exit 2 with HELP
   - file read failure (ENOENT etc) → exit 2 with stderr message
   - JSON.parse failure → exit 2 with stderr message
   - validate() throw (schema error: bad regex, $ref cycle, dangling) → exit 2 with stderr message
   - validate() returns `{valid:false}` → exit 1 with error lines on stdout

Reference implementation (from 03-research.md §"Pattern 2: CLI Entry Point" — write this file mostly verbatim, do NOT add color/version/stdin/glob/etc.):

```js
#!/usr/bin/env node
// bin/whooschema.js
//
// Subcommand-via-positional pattern (parseArgs cannot do native subcommands).
// Exit codes:
//   0 — valid (CLI-01)
//   1 — invalid data (CLI-02)
//   2 — usage / load / file-read / JSON-parse error (distinct from data-invalid)
//
// Output:
//   default (text):  "OK\n" on success, one "$path: rule — message" line per error on failure
//   --format json:   "OK\n" on success, JSON.stringify(errors) + "\n" on failure
//
// Locked design: NO commander/yargs/minimist (CLI-04). NO chalk (zero-dep).
// Library code in src/ never calls process.exit — only this binary does.

import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { validate } from '../src/validate.js';

const HELP = `Usage: whooschema validate --schema <file> --data <file> [--format text|json]

Options:
  --schema, -s <file>   Path to JSON Schema file (Draft-07 subset)
  --data,   -d <file>   Path to JSON data file to validate
  --format       <text|json>   Output format (default: text)
  --help,   -h          Show this help

Exit codes: 0=valid, 1=invalid data, 2=usage/file/parse error`;

async function main() {
  let parsed;
  try {
    parsed = parseArgs({
      args: process.argv.slice(2),
      options: {
        schema: { type: 'string', short: 's' },
        data:   { type: 'string', short: 'd' },
        format: { type: 'string', default: 'text' },
        help:   { type: 'boolean', short: 'h', default: false }
      },
      allowPositionals: true,
      strict: true
    });
  } catch (e) {
    process.stderr.write(`whooschema: ${e.message}\n${HELP}\n`);
    process.exit(2);
  }

  const { values, positionals } = parsed;

  if (values.help) {
    process.stdout.write(HELP + '\n');
    process.exit(0);
  }

  if (positionals.length === 0) {
    process.stderr.write(HELP + '\n');
    process.exit(2);
  }

  if (positionals[0] !== 'validate') {
    process.stderr.write(`whooschema: unknown subcommand "${positionals[0]}"\n${HELP}\n`);
    process.exit(2);
  }

  if (!values.schema || !values.data) {
    process.stderr.write(`whooschema: --schema and --data are required\n${HELP}\n`);
    process.exit(2);
  }

  if (values.format !== 'text' && values.format !== 'json') {
    process.stderr.write(`whooschema: --format must be "text" or "json"\n`);
    process.exit(2);
  }

  // File reads + JSON parses with helpful error messages on failure.
  let schema, data;
  try {
    schema = JSON.parse(await readFile(values.schema, 'utf8'));
  } catch (e) {
    process.stderr.write(`whooschema: failed to read schema "${values.schema}": ${e.message}\n`);
    process.exit(2);
  }
  try {
    data = JSON.parse(await readFile(values.data, 'utf8'));
  } catch (e) {
    process.stderr.write(`whooschema: failed to read data "${values.data}": ${e.message}\n`);
    process.exit(2);
  }

  // validate() throws on schema errors (bad regex, $ref cycle, dangling) — exit 2,
  // distinct from exit 1 (data-invalid). CI scripts depend on this distinction.
  let result;
  try {
    result = validate(schema, data);
  } catch (e) {
    process.stderr.write(`whooschema: schema error: ${e.message}\n`);
    process.exit(2);
  }

  if (result.valid) {
    process.stdout.write('OK\n');
    process.exit(0);
  }

  if (values.format === 'json') {
    process.stdout.write(JSON.stringify(result.errors) + '\n');
  } else {
    for (const err of result.errors) {
      process.stdout.write(`${err.path}: ${err.rule} — ${err.message}\n`);
    }
  }
  process.exit(1);
}

main().catch((e) => {
  process.stderr.write(`whooschema: unexpected error: ${e.stack || e.message}\n`);
  process.exit(2);
});
```

Implementation notes:
- The em-dash `—` (U+2014) in the text output format `<path>: <rule> — <message>` is intentional. Do NOT replace with `-` or `--` — Plan 03-03 will assert this character.
- `strict: true` in parseArgs means unknown flags will throw, which is caught above and converted to exit 2 — that is correct.
- After Task 1, run a manual smoke test: `node bin/whooschema.js --help` should print HELP and exit 0. `node bin/whooschema.js` (no args) should print HELP to stderr and exit 2. The verify command below covers more cases.
- File expected size: 90-110 lines including the HELP block and header comment.
- The shebang `#!/usr/bin/env node` is required for `npm link` to work as an executable on Unix-like systems. Windows uses the `.cmd` shim that npm generates from the `bin` field — same shebang convention applies.
- Do NOT add a `--version` flag (post-v1 — see 03-research.md §"Open Questions" Q5).
- Do NOT support `--watch`, glob inputs, stdin, or multiple `--data` files (all post-v1).

Commit message: `feat(phase-03-02): add bin/whooschema.js CLI binary (CLI-01..04)`
  </action>
  <verify>
    <automated tier="T1">node -e "import('node:fs/promises').then(async ({readFile, mkdir, rm, writeFile}) => { const { spawnSync } = await import('node:child_process'); const { resolve } = await import('node:path'); const tmp = resolve('.tmp-cli-smoke'); await mkdir(tmp, { recursive: true }); const sValid = resolve(tmp, 's.json'); const dValid = resolve(tmp, 'd.json'); const dInvalid = resolve(tmp, 'di.json'); const sBad = resolve(tmp, 'sbad.json'); await writeFile(sValid, JSON.stringify({type:'string'})); await writeFile(dValid, JSON.stringify('hello')); await writeFile(dInvalid, JSON.stringify(42)); await writeFile(sBad, JSON.stringify({pattern:'['})); /* CLI-01: valid -> 0 + OK */ let r = spawnSync('node', ['bin/whooschema.js','validate','--schema',sValid,'--data',dValid], {encoding:'utf8'}); if (r.status !== 0) throw new Error('CLI-01 fail: status=' + r.status + ' stderr=' + r.stderr); if (!/^OK\s*$/.test(r.stdout)) throw new Error('CLI-01 fail: stdout=' + JSON.stringify(r.stdout)); /* CLI-02: invalid data -> 1 + one line per error containing path/rule */ r = spawnSync('node', ['bin/whooschema.js','validate','--schema',sValid,'--data',dInvalid], {encoding:'utf8'}); if (r.status !== 1) throw new Error('CLI-02 status: expected 1 got ' + r.status); if (!/\$:\s*type\s*[—-]/.test(r.stdout)) throw new Error('CLI-02 stdout shape: ' + JSON.stringify(r.stdout)); /* CLI-03: --format json -> 1 + parseable JSON array */ r = spawnSync('node', ['bin/whooschema.js','validate','--schema',sValid,'--data',dInvalid,'--format','json'], {encoding:'utf8'}); if (r.status !== 1) throw new Error('CLI-03 status: ' + r.status); if (!r.stdout.endsWith('\n')) throw new Error('CLI-03: must end with \\n'); const parsed = JSON.parse(r.stdout); if (!Array.isArray(parsed)) throw new Error('CLI-03: stdout must be JSON array'); if (parsed[0].rule !== 'type') throw new Error('CLI-03: array[0].rule expected type, got ' + parsed[0].rule); /* schema error -> exit 2 (NOT 1) */ r = spawnSync('node', ['bin/whooschema.js','validate','--schema',sBad,'--data',dValid], {encoding:'utf8'}); if (r.status !== 2) throw new Error('schema-error must exit 2, got ' + r.status + ' stderr=' + r.stderr); /* unknown subcommand -> exit 2 */ r = spawnSync('node', ['bin/whooschema.js','foo'], {encoding:'utf8'}); if (r.status !== 2) throw new Error('unknown subcommand must exit 2'); /* file-not-found -> exit 2 */ r = spawnSync('node', ['bin/whooschema.js','validate','--schema','/nonexistent','--data','/nope'], {encoding:'utf8'}); if (r.status !== 2) throw new Error('file-not-found must exit 2'); /* missing required flag -> exit 2 */ r = spawnSync('node', ['bin/whooschema.js','validate'], {encoding:'utf8'}); if (r.status !== 2) throw new Error('missing flags must exit 2'); /* --help -> exit 0 */ r = spawnSync('node', ['bin/whooschema.js','--help'], {encoding:'utf8'}); if (r.status !== 0) throw new Error('--help must exit 0'); /* Use rm to clean up */ await rm(tmp, { recursive: true, force: true }); console.log('OK CLI-01..04 + exit-code distinction (0/1/2) verified'); })"</automated>
  </verify>
  <done>`bin/whooschema.js` exists with the `#!/usr/bin/env node` shebang on line 1. Imports only from `node:util`, `node:fs/promises`, and `../src/validate.js` (CLI-04). The verify command above passes all checks: CLI-01 (valid → exit 0 + `OK`), CLI-02 (invalid → exit 1 + one line per error), CLI-03 (`--format json` → exit 1 + JSON.parse-able stdout ending with `\n`), schema-error → exit 2 (distinct from data-invalid), unknown subcommand → exit 2, file-not-found → exit 2, missing flag → exit 2, `--help` → exit 0. The change is committed as one atomic commit.</done>
</task>

<task type="auto">
  <name>Task 2: Create dogfood/config.schema.json + dogfood/config.broken.json + wire bin field in package.json</name>
  <files>dogfood/config.schema.json, dogfood/config.broken.json, package.json</files>
  <action>
Three artifacts in this single task — they are tightly coupled (the schema describes what `.planning/config.json` looks like; the broken file is a hand-edited copy that violates the schema; package.json registers the CLI). Closes DOG-01 (smoke), DOG-02 (broken-copy artifact), and finalizes the CLI installability.

**Step 2a — Create `dogfood/config.schema.json`:**

Write a hand-authored JSON Schema describing the actual shape of PAN's `.planning/config.json` (verified shape from 03-research.md §"Pattern 3"). This MUST validate the real `.planning/config.json` to OK.

Content (write verbatim — do NOT pretty-print differently or change keys):

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "PAN .planning/config.json",
  "description": "Hand-written schema for PAN's planning config. Used as the dogfood target — whooschema validates this against the real PAN config to prove the library handles a non-trivial real-world schema cleanly. (DOG-01 / DOG-02)",
  "type": "object",
  "required": ["mode", "depth", "parallelization", "commit_docs", "model_profile", "workflow"],
  "properties": {
    "mode": { "type": "string", "enum": ["yolo", "interactive"] },
    "depth": { "type": "string", "enum": ["quick", "standard", "deep"] },
    "parallelization": { "type": "boolean" },
    "commit_docs": { "type": "boolean" },
    "model_profile": { "type": "string", "enum": ["fast", "balanced", "thorough"] },
    "workflow": {
      "type": "object",
      "required": ["research", "plan_check", "verifier", "auto_advance"],
      "properties": {
        "research": { "type": "boolean" },
        "plan_check": { "type": "boolean" },
        "verifier": { "type": "boolean" },
        "auto_advance": { "type": "boolean" }
      },
      "additionalProperties": false
    }
  },
  "additionalProperties": false
}
```

Notes:
- `additionalProperties: false` on both the root and `workflow` is the contract that catches typos in keys. Do NOT relax these.
- The `enum` values are inferred from the actual config + likely PAN conventions (per 03-research.md §"Open Questions" Q3). If a future PAN config introduces new modes/depths/profiles, this schema can be widened in a later iteration.
- The schema uses ONLY Draft-07 keywords whooschema supports (type, required, properties, enum, additionalProperties). It does NOT use $ref (the dogfood target is small; $ref would be over-engineering for a single config).

**Step 2b — Create `dogfood/config.broken.json`:**

Write a deliberately-broken copy with three distinct violations. Each violation is a different rule (`enum`, `type`, `required`) so the error output exercises multiple error shapes:

```json
{
  "mode": "experimental",
  "depth": 5,
  "parallelization": true,
  "commit_docs": true,
  "model_profile": "balanced",
  "workflow": {
    "research": true
  }
}
```

Violations encoded:
- `$.mode` = `"experimental"` → fails `enum: ["yolo","interactive"]` (rule: `enum`).
- `$.depth` = `5` → fails `type: "string"` (rule: `type`).
- `$.workflow` is missing 3 required keys: `plan_check`, `verifier`, `auto_advance` → 3 separate `required` violations on `$.workflow`.

When run through the CLI, this MUST produce 5 errors total (1 enum + 1 type + 3 required), sorted by path lex order.

**Step 2c — Modify `package.json` to add the `bin` field:**

Use the Read tool first to confirm current contents, then write the file with the new `bin` field added. The current `package.json` (verified by direct read) is:

```json
{
  "name": "whooschema",
  "version": "0.1.0",
  "description": "Zero-dependency JSON Schema Draft-07 validator with JSONPath error paths",
  "type": "module",
  "engines": { "node": ">=18" },
  "license": "MIT",
  "main": "./src/validate.js",
  "exports": {
    ".": {
      "import": "./src/validate.js",
      "types": "./index.d.ts"
    }
  },
  "types": "./index.d.ts",
  "files": ["src/", "index.d.ts"],
  "scripts": {
    "test": "node --test"
  },
  "keywords": ["json-schema", "validation", "jsonpath", "zero-dependencies"],
  "publishConfig": { "provenance": true }
}
```

Add the `bin` field (between `types` and `files` is a natural location, but exact JSON key order does not matter — pick anywhere that yields valid JSON). Also UPDATE `files` to include `bin/` so the binary ships in npm tarballs:

```json
  "bin": { "whooschema": "./bin/whooschema.js" },
  "files": ["src/", "bin/", "index.d.ts"],
```

Final `package.json` (write whole file verbatim):

```json
{
  "name": "whooschema",
  "version": "0.1.0",
  "description": "Zero-dependency JSON Schema Draft-07 validator with JSONPath error paths",
  "type": "module",
  "engines": { "node": ">=18" },
  "license": "MIT",
  "main": "./src/validate.js",
  "bin": { "whooschema": "./bin/whooschema.js" },
  "exports": {
    ".": {
      "import": "./src/validate.js",
      "types": "./index.d.ts"
    }
  },
  "types": "./index.d.ts",
  "files": ["src/", "bin/", "index.d.ts"],
  "scripts": {
    "test": "node --test"
  },
  "keywords": ["json-schema", "validation", "jsonpath", "zero-dependencies"],
  "publishConfig": { "provenance": true }
}
```

Do NOT:
- Add any runtime `dependencies` (zero-dep is non-negotiable).
- Add any `devDependencies` yet (the `bench` script comes in Plan 03-03; tape/etc. are NOT used).
- Bump the version (Plan 03-03 may bump after the bench passes; this plan does not).

**Smoke test (run AFTER all three files exist):**

The dogfood DOG-01 smoke test MUST pass:
```
node bin/whooschema.js validate --schema dogfood/config.schema.json --data .planning/config.json
```
Expected: stdout `OK`, exit code 0. If it fails, the dogfood schema is wrong (most likely an enum mismatch with the real config) — adjust the schema, NOT the real config.

The DOG-02 broken-copy smoke test MUST exit 1 with multiple error lines covering `$.mode`, `$.depth`, and `$.workflow`:
```
node bin/whooschema.js validate --schema dogfood/config.schema.json --data dogfood/config.broken.json
```
Expected: exit 1, stdout contains lines mentioning `$.mode: enum`, `$.depth: type`, and at least one `$.workflow: required` line.

Commit message: `feat(phase-03-02): add dogfood schema + broken copy + bin field (DOG-01, DOG-02)`
  </action>
  <verify>
    <automated tier="T1">node -e "import('node:child_process').then(async ({ spawnSync }) => { const fs = await import('node:fs'); /* package.json bin field */ const pkg = JSON.parse(fs.readFileSync('package.json','utf8')); if (!pkg.bin || pkg.bin.whooschema !== './bin/whooschema.js') throw new Error('package.json bin field wrong: ' + JSON.stringify(pkg.bin)); if (!pkg.files || !pkg.files.includes('bin/')) throw new Error('package.json files must include bin/: ' + JSON.stringify(pkg.files)); if (pkg.dependencies && Object.keys(pkg.dependencies).length > 0) throw new Error('zero-dep violation: dependencies present: ' + JSON.stringify(pkg.dependencies)); /* dogfood/config.schema.json parses */ const schema = JSON.parse(fs.readFileSync('dogfood/config.schema.json','utf8')); if (schema.type !== 'object') throw new Error('schema.type must be object'); if (!Array.isArray(schema.required)) throw new Error('schema.required must be array'); if (schema.additionalProperties !== false) throw new Error('schema.additionalProperties must be false'); /* dogfood/config.broken.json parses + has the 3 violation hooks */ const broken = JSON.parse(fs.readFileSync('dogfood/config.broken.json','utf8')); if (broken.mode !== 'experimental') throw new Error('broken.mode must be experimental (enum violation hook)'); if (broken.depth !== 5) throw new Error('broken.depth must be number 5 (type violation hook)'); if (!broken.workflow || typeof broken.workflow !== 'object' || ('plan_check' in broken.workflow)) throw new Error('broken.workflow must be missing plan_check (required violation hook)'); /* DOG-01 smoke: real config OK */ let r = spawnSync('node', ['bin/whooschema.js','validate','--schema','dogfood/config.schema.json','--data','.planning/config.json'], { encoding:'utf8' }); if (r.status !== 0) throw new Error('DOG-01 smoke fail: status=' + r.status + ' stderr=' + r.stderr + ' stdout=' + r.stdout); if (!/^OK\s*$/.test(r.stdout)) throw new Error('DOG-01 stdout: ' + JSON.stringify(r.stdout)); /* DOG-02 smoke: broken copy fails with multiple errors */ r = spawnSync('node', ['bin/whooschema.js','validate','--schema','dogfood/config.schema.json','--data','dogfood/config.broken.json'], { encoding:'utf8' }); if (r.status !== 1) throw new Error('DOG-02 smoke fail: expected exit 1 got ' + r.status + ' stderr=' + r.stderr); if (!/\$\.mode\s*:\s*enum/.test(r.stdout)) throw new Error('DOG-02: missing $.mode: enum line. stdout=' + JSON.stringify(r.stdout)); if (!/\$\.depth\s*:\s*type/.test(r.stdout)) throw new Error('DOG-02: missing $.depth: type line. stdout=' + JSON.stringify(r.stdout)); if (!/\$\.workflow.*required/.test(r.stdout)) throw new Error('DOG-02: missing $.workflow required line. stdout=' + JSON.stringify(r.stdout)); /* DOG-02 also works in JSON mode */ r = spawnSync('node', ['bin/whooschema.js','validate','--schema','dogfood/config.schema.json','--data','dogfood/config.broken.json','--format','json'], { encoding:'utf8' }); if (r.status !== 1) throw new Error('DOG-02 json mode status: ' + r.status); const parsed = JSON.parse(r.stdout); if (!Array.isArray(parsed) || parsed.length < 3) throw new Error('DOG-02 json: expected >=3 errors, got: ' + JSON.stringify(parsed)); console.log('OK DOG-01 (real config valid) + DOG-02 (broken copy invalid with text + json output) + package.json bin field'); })"</automated>
  </verify>
  <done>`dogfood/config.schema.json` exists and is a valid JSON Schema with `additionalProperties: false`. `dogfood/config.broken.json` exists with the 3 deliberate violations (enum on mode, type on depth, missing required keys in workflow). `package.json` has `"bin": { "whooschema": "./bin/whooschema.js" }`, `files: [...,"bin/",...]`, and zero `dependencies`. The DOG-01 smoke test passes — `whooschema validate --schema dogfood/config.schema.json --data .planning/config.json` exits 0 and prints `OK`. The DOG-02 smoke test exits 1 and prints lines for `$.mode: enum`, `$.depth: type`, and `$.workflow: required` (at least one). The same DOG-02 case in `--format json` mode produces a JSON-parseable stdout with 3+ error objects. The change is committed as one atomic commit.</done>
</task>

</tasks>

<verification>
After both tasks:

1. `node --test` from project root: 61 passing tests, 0 failures (no Phase 3 tests yet — those come in Plan 03-03; existing Phase 1+2 tests must NOT regress).
2. CLI exit-code contract verified end-to-end:
   - `whooschema validate --schema <valid> --data <valid>` → 0 + `OK\n`  (CLI-01)
   - `whooschema validate --schema <valid> --data <invalid>` → 1 + error lines  (CLI-02)
   - `whooschema validate --schema <s> --data <d> --format json` → 1 + JSON.parse-able stdout  (CLI-03)
   - `whooschema validate --schema <bad-regex>.json --data <any>` → 2 (NOT 1) — schema error distinct from data-invalid
   - `whooschema foo` → 2 with HELP — unknown subcommand
   - `whooschema --help` → 0 with HELP
   - `whooschema validate` (no flags) → 2 with HELP — missing required flags
3. CLI imports verified manually (CLI-04): `bin/whooschema.js` imports only from `node:util`, `node:fs/promises`, `../src/validate.js`. No commander/yargs/minimist anywhere in `package.json` or `bin/`.
4. DOG-01 verified: `whooschema validate --schema dogfood/config.schema.json --data .planning/config.json` exits 0 + `OK`.
5. DOG-02 verified: `whooschema validate --schema dogfood/config.schema.json --data dogfood/config.broken.json` exits 1 with at least 5 errors (1 enum + 1 type + 3 required); JSON mode output is parseable.
6. `package.json` declares `bin` field; `npm link` would now install `whooschema` as an executable.
7. Two atomic commits — `feat(phase-03-02): add bin/whooschema.js ...` and `feat(phase-03-02): add dogfood schema + broken copy + bin field ...`.
</verification>

<success_criteria>
- [ ] `bin/whooschema.js` exists with shebang `#!/usr/bin/env node` on line 1
- [ ] CLI uses `parseArgs` from `node:util` only — verified by inspecting imports
- [ ] CLI exit codes: 0 (valid), 1 (data-invalid), 2 (usage / file / schema error) — distinct
- [ ] Text output format: `OK\n` on success, `<path>: <rule> — <message>\n` per error on failure
- [ ] JSON output format: `OK\n` on success, `JSON.stringify(errors) + '\n'` on failure (parseable)
- [ ] `dogfood/config.schema.json` validates `.planning/config.json` to OK (DOG-01)
- [ ] `dogfood/config.broken.json` produces ≥3 error lines covering `$.mode`, `$.depth`, `$.workflow` (DOG-02)
- [ ] `package.json` has `bin: { whooschema: "./bin/whooschema.js" }` and `files` includes `bin/`
- [ ] `package.json` has zero runtime dependencies (Object.keys(pkg.dependencies||{}).length === 0)
- [ ] All 61 Phase 1+2 tests still pass: `node --test`
- [ ] CLI-01..04 + DOG-01 + DOG-02 are demonstrably closed via manual smoke tests
- [ ] Two atomic commits (one per task)
</success_criteria>

<output>
After completion, create `.planning/phases/03-formats-cli-dogfood/03-02-summary.md` documenting:
- New file `bin/whooschema.js`: shebang + parseArgs subcommand-via-positional + 3-tier exit codes (0/1/2) + text/json output.
- New file `dogfood/config.schema.json`: hand-written schema; `additionalProperties: false` at both levels; locked enum sets for mode/depth/model_profile.
- New file `dogfood/config.broken.json`: 3 violations encoded (enum on mode, type on depth, missing required keys in workflow).
- Modified file `package.json`: added `bin` field, added `bin/` to `files` array, NO new dependencies.
- DOG-01 smoke result: `OK` against the real `.planning/config.json` (exit 0).
- DOG-02 smoke result: error count and which errors fired (e.g. "5 errors: 1 enum at $.mode, 1 type at $.depth, 3 required at $.workflow").
- Confirmation that all 61 Phase 1+2 tests still pass (no regressions).
- Notes for Plan 03-03:
  - The CLI test file (`test/cli.test.js`) should spawn `bin/whooschema.js` via `spawnSync` and assert on stdout/stderr/exit code — see 03-research.md §"Test pattern for CLI" for the test list (~6 tests).
  - The dogfood test file (`test/dogfood.test.js`) should reference `dogfood/config.schema.json` + the real `.planning/config.json` for DOG-01, and `dogfood/config.broken.json` for DOG-02 (~2 tests).
  - The benchmark script (`scripts/bench.js`) is independent of this plan — it builds a synthetic 1MB doc + 200-line schema and asserts <200ms via Date.now().
</output>
