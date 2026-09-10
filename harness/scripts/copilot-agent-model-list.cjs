'use strict';
// R13 probe helper (harness `sh` step): write a Copilot custom agent whose frontmatter
// carries a `model:` list and `model-policy: prefer`, the shape PAN would emit for its
// model-pinned agents. The ids below are candidates, not verified: the live gate exists
// to find out whether Copilot accepts them. Usage: node copilot-agent-model-list.cjs <ws>
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
  'model:',
  '  - claude-fable-5.1',
  '  - claude-opus-5',
  'model-policy: prefer',
  '---',
  'Reply with the single word PROBE.',
  '',
].join('\n');
fs.writeFileSync(path.join(dir, 'pan-model-probe.agent.md'), agent);
process.stdout.write(JSON.stringify({ written: path.join(dir, 'pan-model-probe.agent.md') }) + '\n');
