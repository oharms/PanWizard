/**
 * An update never overwrites what a project wrote inside PAN's sections.
 *
 * Reported from a field project (2026-10-21): updating PAN replaced the project's own
 * text in AGENTS.md's PAN section (its work list lives in docs/pm/tracker/, not
 * .planning/) with PAN's generic text, and the CLAUDE.md compact instructions and the
 * context monitor told the session to keep `.planning/state.md`, which that project
 * does not have.
 *
 * PAN now replaces a section only when its text is one PAN generated (the current one,
 * or an earlier release's, by hash). An edited section is kept and the installer says
 * so. The compact instructions and the monitor name state.md only where it applies.
 */
'use strict';

const { describe, test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const A = require('../pan-wizard-core/bin/lib/agents-md.cjs');
const M = require('../hooks/pan-context-monitor.js');
const { INSTALLER_PATH } = require('./helpers.cjs');

const B = A.PAN_AGENTS_BEGIN;
const E = A.PAN_AGENTS_END;
const EDITED = `# My project\n\n${B}\n## PAN Wizard (corrected 2026-09-23)\n\nOur work list is docs/pm/tracker/. .planning/ holds run manifests only.\n${E}\n\nMore of ours.\n`;
// The section PAN shipped before the M34 prompt audit (2026-10-03).
const OLD_PAN = `${B}\n## PAN Wizard\n\nThis project uses PAN Wizard for structured, phase-based planning and execution.\n\n- \`.planning/\` is PAN's state directory (state.md, roadmap.md, phase directories). Treat it as the source of truth for planning state and modify it through PAN commands, not by hand.\n- PAN commands install as \`pan-*\` skills/commands (for example \`/pan-help\`, \`/pan-new-project\`, \`/pan-exec-phase\`). Start with \`/pan-help\`.\n- The \`pan-tools\` dispatcher backs every command; it lives under \`pan-wizard-core/\` inside the runtime's config directory (or \`.agents/\` for unified installs).\n${E}`;

// This release's texts (sha256 prefix of the text between the markers, LF, trimmed).
const CURRENT_AGENTS = '6191107fdcdf7f6e';
const CURRENT_BRIDGE = '9d0a2baa7efba28e';

const dirs = [];
afterEach(() => { while (dirs.length) fs.rmSync(dirs.pop(), { recursive: true, force: true }); });

describe('AGENTS.md: a section the project edited is kept', () => {
  test('an edited section survives an upsert, byte for byte', () => {
    assert.equal(A.sectionState(EDITED), 'edited');
    assert.equal(A.upsertAgentsMdSection(EDITED, A.buildAgentsMdSection()), EDITED);
  });

  test('a section PAN generated, now or in an earlier release, is brought up to date', () => {
    assert.equal(A.sectionState(A.buildAgentsMdSection()), 'pan');
    assert.equal(A.sectionState(`# x\n\n${OLD_PAN}\n`), 'pan', 'the pre-M34 text is recognised by hash');
    const updated = A.upsertAgentsMdSection(`# x\n\n${OLD_PAN}\n`, A.buildAgentsMdSection());
    assert.ok(updated.includes(A.buildAgentsMdSection()));
    assert.ok(updated.startsWith('# x\n'));
  });

  test('line endings and trailing blanks do not make a PAN section look edited', () => {
    assert.equal(A.sectionState(A.buildAgentsMdSection().replace(/\n/g, '\r\n') + '\r\n'), 'pan');
  });

  test('no markers: the section is appended, as before', () => {
    assert.equal(A.sectionState('# mine\n'), 'absent');
    assert.ok(A.upsertAgentsMdSection('# mine\n', A.buildAgentsMdSection()).endsWith(A.buildAgentsMdSection() + '\n'));
  });
});

describe('CLAUDE.md: an edited PAN block is kept', () => {
  test('an edited bridge survives; the import-only bridge of earlier releases is updated', () => {
    const edited = `# Mine\n\n${B}\n@AGENTS.md\n\n# Compact instructions\n\nKeep docs/pm/tracker/ in the summary.\n${E}\n`;
    assert.equal(A.ensureClaudeMdImport(edited), edited);
    const old = `# Mine\n\n${B}\n@AGENTS.md\n${E}\n`;
    assert.ok(A.ensureClaudeMdImport(old).includes('# Compact instructions'));
  });

  test('the compact instructions name state.md only where a project keeps one', () => {
    const block = A.buildClaudeMdBridge();
    assert.match(block, /`\.planning\/state\.md`/);
    assert.match(block, /when the project keeps one/);
    assert.doesNotMatch(block, /\(`\.planning\/state\.md` records them; keep that path\)/);
  });
});

describe('the installer keeps the edits and says so', () => {
  test('an update leaves the edited AGENTS.md section alone and names it in the output', () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-agents-edit-'));
    dirs.push(d);
    fs.writeFileSync(path.join(d, 'AGENTS.md'), EDITED);
    const out = execFileSync(process.execPath, [INSTALLER_PATH, '--claude', '--local'], { cwd: d, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    assert.equal(fs.readFileSync(path.join(d, 'AGENTS.md'), 'utf8'), EDITED);
    assert.match(out, /AGENTS\.md: kept the PAN section this project edited/);
  });
});

describe('the context monitor names state.md only where it applies', () => {
  const metrics = { remaining_percentage: 20 };
  test('with .planning/state.md the note points at it; without, it does not', () => {
    const withState = M.buildContextWarning(metrics, null, Date.now() / 1000, { hasState: true });
    const without = M.buildContextWarning(metrics, null, Date.now() / 1000, { hasState: false });
    assert.equal(withState.action, 'emit');
    assert.match(withState.message, /\.planning\/state\.md/);
    assert.doesNotMatch(without.message, /state\.md/);
    assert.match(without.message, /wherever this project records/);
  });
});

describe('the known-text lists stay complete', () => {
  test('the current texts are pinned: changing one means adding its old hash to PRIOR_*', () => {
    const crypto = require('crypto');
    const inner = (t) => t.slice(t.indexOf(B) + B.length, t.indexOf(E)).replace(/\r\n/g, '\n').trim();
    const h = (t) => crypto.createHash('sha256').update(inner(t)).digest('hex').slice(0, 16);
    assert.equal(h(A.buildAgentsMdSection()), CURRENT_AGENTS, 'the AGENTS.md section changed: add the old hash to PRIOR_AGENTS_SECTIONS, then update this pin');
    assert.equal(h(A.buildClaudeMdBridge()), CURRENT_BRIDGE, 'the CLAUDE.md block changed: add the old hash to PRIOR_CLAUDE_BRIDGES, then update this pin');
  });
});
