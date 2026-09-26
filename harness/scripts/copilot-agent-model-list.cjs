'use strict';
// R13 probe helper (harness `sh` step): write a Copilot custom agent whose frontmatter
// carries a `models:` priority list and `model-policy: preferred`, the shape PAN would
// emit for its model-pinned agents (the list sat under the singular `model:` until
// 2026-09-26; Copilot's reference names the list field `models`). The ids are Copilot's own (dotted), as its /models list
// names them (read 2026-09-26, CLI 1.0.88). `model-policy: prefer`, which this probe
// used until then, made Copilot refuse to load the agent: 'Expected "preferred" or
// "required"'. Usage: node copilot-agent-model-list.cjs <ws>
const fs = require('fs');
const path = require('path');
const ws = process.argv[2];
if (!ws) { process.stderr.write('usage: copilot-agent-model-list.cjs <workspace>\n'); process.exit(2); }
const dir = path.join(ws, '.github', 'agents');
fs.mkdirSync(dir, { recursive: true });
const agent = [
  '---',
  'name: pan-model-probe',
  'description: PAN harness probe - a custom agent with a model fallback list (R13).',
  'models:',
  '  - claude-opus-5.5',
  '  - claude-opus-5',
  'model-policy: preferred',
  '---',
  'Reply with the single word PROBE.',
  '',
].join('\n');
fs.writeFileSync(path.join(dir, 'pan-model-probe.agent.md'), agent);
process.stdout.write(JSON.stringify({ written: path.join(dir, 'pan-model-probe.agent.md') }) + '\n');
