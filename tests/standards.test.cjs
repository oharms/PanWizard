const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { runPanTools, createTempProject, cleanup } = require('./helpers.cjs');

const {
  STANDARDS_CATALOG, STANDARDS_CATEGORIES, STANDARDS_RECOMMENDATIONS, STANDARDS_FILE,
  PHASE_KEYWORDS_TO_STANDARDS, STANDARDS_EXTERNAL_TOOLS,
} = require('../pan-wizard-core/bin/lib/constants.cjs');

const {
  parseStandardsFile, renderStandardsMd, detectStandardsFromContent,
} = require('../pan-wizard-core/bin/lib/config.cjs');

// ─── Unit Tests: Constants ──────────────────────────────────────────────────

describe('Standards Constants', () => {
  it('STANDARDS_CATALOG has at least 10 standards', () => {
    assert.ok(Object.keys(STANDARDS_CATALOG).length >= 10);
  });

  it('every catalog entry has required fields', () => {
    for (const [id, s] of Object.entries(STANDARDS_CATALOG)) {
      assert.ok(s.name, `${id} missing name`);
      assert.ok(s.category, `${id} missing category`);
      assert.ok(s.description, `${id} missing description`);
      assert.ok(s.url, `${id} missing url`);
      assert.ok(Array.isArray(s.checklist), `${id} missing checklist`);
      assert.ok(s.checklist.length >= 4, `${id} checklist too short`);
      assert.ok(s.applicable_to, `${id} missing applicable_to`);
      assert.ok(s.level, `${id} missing level`);
    }
  });

  it('every category in catalog is a valid STANDARDS_CATEGORIES entry', () => {
    for (const [id, s] of Object.entries(STANDARDS_CATALOG)) {
      assert.ok(STANDARDS_CATEGORIES.includes(s.category), `${id} has invalid category: ${s.category}`);
    }
  });

  it('STANDARDS_RECOMMENDATIONS maps to valid catalog IDs', () => {
    for (const [type, ids] of Object.entries(STANDARDS_RECOMMENDATIONS)) {
      for (const id of ids) {
        assert.ok(STANDARDS_CATALOG[id], `recommendation ${type} references unknown standard: ${id}`);
      }
    }
  });

  it('STANDARDS_FILE is standards.md', () => {
    assert.equal(STANDARDS_FILE, 'standards.md');
  });

  it('catalog includes expected key standards', () => {
    assert.ok(STANDARDS_CATALOG['owasp-top10']);
    assert.ok(STANDARDS_CATALOG['wcag-22']);
    assert.ok(STANDARDS_CATALOG['stride']);
    assert.ok(STANDARDS_CATALOG['nist-ssdf']);
    assert.ok(STANDARDS_CATALOG['owasp-llm-top10']);
    assert.ok(STANDARDS_CATALOG['conventional-commits']);
  });
});

// ─── Unit Tests: parseStandardsFile ─────────────────────────────────────────

describe('parseStandardsFile', () => {
  it('returns empty array for empty content', () => {
    assert.deepEqual(parseStandardsFile(''), []);
  });

  it('parses single standard', () => {
    const content = renderStandardsMd(['owasp-top10']);
    const ids = parseStandardsFile(content);
    assert.deepEqual(ids, ['owasp-top10']);
  });

  it('parses multiple standards', () => {
    const content = renderStandardsMd(['owasp-top10', 'wcag-22', 'stride']);
    const ids = parseStandardsFile(content);
    assert.ok(ids.includes('owasp-top10'));
    assert.ok(ids.includes('wcag-22'));
    assert.ok(ids.includes('stride'));
    assert.equal(ids.length, 3);
  });

  it('ignores unrecognized headings', () => {
    const content = '## Some Random Heading\n\nNot a standard.';
    assert.deepEqual(parseStandardsFile(content), []);
  });
});

// ─── Unit Tests: renderStandardsMd ──────────────────────────────────────────

describe('renderStandardsMd', () => {
  it('renders header and footer', () => {
    const content = renderStandardsMd(['stride']);
    assert.ok(content.startsWith('# Project Standards'));
    assert.ok(content.includes('pan-tools standards select|remove|status'));
  });

  it('renders standard name as heading', () => {
    const content = renderStandardsMd(['owasp-top10']);
    assert.ok(content.includes('## OWASP Top 10 (2025)'));
  });

  it('renders checklist items with unchecked boxes', () => {
    const content = renderStandardsMd(['stride']);
    assert.ok(content.includes('- [ ] Spoofing'));
    assert.ok(content.includes('- [ ] Tampering'));
  });

  it('renders category, level, and URL', () => {
    const content = renderStandardsMd(['wcag-22']);
    assert.ok(content.includes('**Category:** accessibility'));
    assert.ok(content.includes('**Level:** foundational'));
    assert.ok(content.includes('https://www.w3.org/TR/WCAG22/'));
  });

  it('renders multiple standards in order', () => {
    const content = renderStandardsMd(['stride', 'wcag-22']);
    const stridePos = content.indexOf('## STRIDE');
    const wcagPos = content.indexOf('## WCAG');
    assert.ok(stridePos < wcagPos, 'STRIDE should come before WCAG');
  });

  it('skips unknown IDs gracefully', () => {
    const content = renderStandardsMd(['owasp-top10', 'nonexistent']);
    assert.ok(content.includes('## OWASP Top 10'));
    assert.ok(!content.includes('nonexistent'));
  });

  it('roundtrips through parse', () => {
    const ids = ['owasp-top10', 'wcag-22', 'stride'];
    const content = renderStandardsMd(ids);
    const parsed = parseStandardsFile(content);
    assert.deepEqual(parsed, ids);
  });
});

// ─── Integration Tests: CLI standards list ──────────────────────────────────

describe('CLI: standards list', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = createTempProject(); });
  afterEach(() => { cleanup(tmpDir); });

  it('lists all standards', () => {
    const r = runPanTools('standards list', tmpDir);
    assert.ok(r.success, 'should succeed');
    const json = JSON.parse(r.output);
    assert.ok(json.standards.length >= 10);
    assert.ok(json.count >= 10);
    assert.ok(json.standards[0].id);
    assert.ok(json.standards[0].name);
    assert.ok(json.standards[0].category);
  });

  it('filters by category', () => {
    const r = runPanTools('standards list --category security', tmpDir);
    assert.ok(r.success);
    const json = JSON.parse(r.output);
    assert.ok(json.count >= 5);
    for (const s of json.standards) {
      assert.equal(s.category, 'security');
    }
  });

  it('errors on invalid category', () => {
    const r = runPanTools('standards list --category invalid', tmpDir);
    assert.ok(!r.success);
  });
});

// ─── Integration Tests: CLI standards select/remove/status ──────────────────

describe('CLI: standards select/remove/status', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = createTempProject(); });
  afterEach(() => { cleanup(tmpDir); });

  it('selects a standard and creates standards.md', () => {
    const r = runPanTools('standards select owasp-top10', tmpDir);
    assert.ok(r.success, 'select should succeed');
    const json = JSON.parse(r.output);
    assert.equal(json.added, 'owasp-top10');
    assert.deepEqual(json.project_standards, ['owasp-top10']);
    assert.ok(json.standards_file);
    // Verify file created
    const content = fs.readFileSync(path.join(tmpDir, '.planning', 'standards.md'), 'utf-8');
    assert.ok(content.includes('OWASP Top 10'));
  });

  it('selects multiple standards', () => {
    runPanTools('standards select owasp-top10', tmpDir);
    const r = runPanTools('standards select stride', tmpDir);
    assert.ok(r.success);
    const json = JSON.parse(r.output);
    assert.equal(json.added, 'stride');
    assert.ok(json.project_standards.includes('owasp-top10'));
    assert.ok(json.project_standards.includes('stride'));
  });

  it('errors on duplicate select', () => {
    runPanTools('standards select owasp-top10', tmpDir);
    const r = runPanTools('standards select owasp-top10', tmpDir);
    assert.ok(!r.success);
  });

  it('errors on unknown standard', () => {
    const r = runPanTools('standards select fake-standard', tmpDir);
    assert.ok(!r.success);
  });

  it('removes a standard', () => {
    runPanTools('standards select owasp-top10', tmpDir);
    runPanTools('standards select stride', tmpDir);
    const r = runPanTools('standards remove owasp-top10', tmpDir);
    assert.ok(r.success);
    const json = JSON.parse(r.output);
    assert.equal(json.removed, 'owasp-top10');
    assert.deepEqual(json.project_standards, ['stride']);
  });

  it('deletes standards.md when last standard removed', () => {
    runPanTools('standards select stride', tmpDir);
    const r = runPanTools('standards remove stride', tmpDir);
    assert.ok(r.success);
    const json = JSON.parse(r.output);
    assert.deepEqual(json.project_standards, []);
    assert.equal(json.standards_file, null);
    assert.ok(!fs.existsSync(path.join(tmpDir, '.planning', 'standards.md')));
  });

  it('errors when removing non-selected standard', () => {
    runPanTools('standards select stride', tmpDir);
    const r = runPanTools('standards remove owasp-top10', tmpDir);
    assert.ok(!r.success);
  });

  it('status shows no standards when none selected', () => {
    const r = runPanTools('standards status', tmpDir);
    assert.ok(r.success);
    const json = JSON.parse(r.output);
    assert.deepEqual(json.project_standards, []);
    assert.equal(json.overall_status, 'none');
  });

  it('status shows configured standards', () => {
    runPanTools('standards select owasp-top10', tmpDir);
    runPanTools('standards select wcag-22', tmpDir);
    const r = runPanTools('standards status', tmpDir);
    assert.ok(r.success);
    const json = JSON.parse(r.output);
    assert.equal(json.project_standards.length, 2);
    assert.equal(json.checks.length, 2);
    assert.equal(json.checks[0].status, 'configured');
    assert.equal(json.checks[0].verified_items, 0);
    assert.ok(json.checks[0].checklist_items >= 5);
    assert.equal(json.checks[0].coverage, '0%');
    assert.equal(json.overall_status, 'configured');
  });

  it('status detects checked items', () => {
    runPanTools('standards select stride', tmpDir);
    // Manually check an item in standards.md
    const stdPath = path.join(tmpDir, '.planning', 'standards.md');
    let content = fs.readFileSync(stdPath, 'utf-8');
    content = content.replace('- [ ] Spoofing', '- [x] Spoofing');
    fs.writeFileSync(stdPath, content, 'utf-8');
    const r = runPanTools('standards status', tmpDir);
    assert.ok(r.success);
    const json = JSON.parse(r.output);
    assert.equal(json.checks[0].verified_items, 1);
    assert.equal(json.checks[0].status, 'partial');
    assert.equal(json.overall_status, 'partial');
  });
});

// ─── Integration Tests: CLI standards recommend ─────────────────────────────

describe('CLI: standards recommend', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = createTempProject(); });
  afterEach(() => { cleanup(tmpDir); });

  it('errors without project.md', () => {
    const r = runPanTools('standards recommend', tmpDir);
    assert.ok(!r.success);
  });

  it('recommends web standards for web project', () => {
    fs.writeFileSync(path.join(tmpDir, '.planning', 'project.md'), '# My App\n\nA React dashboard web application with REST API.\n');
    const r = runPanTools('standards recommend', tmpDir);
    assert.ok(r.success);
    const json = JSON.parse(r.output);
    assert.ok(json.project_types.includes('web'));
    assert.ok(json.recommendations.length >= 2);
    const ids = json.recommendations.map(r => r.id);
    assert.ok(ids.includes('owasp-top10'));
  });

  it('recommends AI standards for AI project', () => {
    fs.writeFileSync(path.join(tmpDir, '.planning', 'project.md'), '# LLM Chat\n\nAn OpenAI-powered chatbot using Claude as the LLM backend.\n');
    const r = runPanTools('standards recommend', tmpDir);
    assert.ok(r.success);
    const json = JSON.parse(r.output);
    assert.ok(json.project_types.includes('ai'));
    const ids = json.recommendations.map(r => r.id);
    assert.ok(ids.includes('owasp-llm-top10'));
  });

  it('falls back to general for unrecognized project type', () => {
    fs.writeFileSync(path.join(tmpDir, '.planning', 'project.md'), '# Project\n\nSome project doing stuff.\n');
    const r = runPanTools('standards recommend', tmpDir);
    assert.ok(r.success);
    const json = JSON.parse(r.output);
    assert.ok(json.project_types.includes('general'));
    assert.ok(json.recommendations.length >= 2);
  });

  it('detects multiple project types', () => {
    fs.writeFileSync(path.join(tmpDir, '.planning', 'project.md'), '# My App\n\nA React web frontend with a REST API backend and agent-based AI features.\n');
    const r = runPanTools('standards recommend', tmpDir);
    assert.ok(r.success);
    const json = JSON.parse(r.output);
    assert.ok(json.project_types.length >= 2);
  });
});

// ─── Integration Tests: CLI standards unknown subcommand ────────────────────

describe('CLI: standards errors', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = createTempProject(); });
  afterEach(() => { cleanup(tmpDir); });

  it('errors on unknown subcommand', () => {
    const r = runPanTools('standards foobar', tmpDir);
    assert.ok(!r.success);
  });

  it('errors on select with no argument', () => {
    const r = runPanTools('standards select', tmpDir);
    assert.ok(!r.success);
  });

  it('errors on remove with no argument', () => {
    const r = runPanTools('standards remove', tmpDir);
    assert.ok(!r.success);
  });

  it('errors on remove with no standards.md', () => {
    const r = runPanTools('standards remove owasp-top10', tmpDir);
    assert.ok(!r.success);
  });
});

// ─── Integration Tests: validate health --standards ──────────────────────────

describe('CLI: validate health --standards', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = createTempProject(); });
  afterEach(() => { cleanup(tmpDir); });

  it('reports no standards when none selected', () => {
    const r = runPanTools('validate health --standards', tmpDir);
    assert.ok(r.success);
    const json = JSON.parse(r.output);
    const stdInfo = json.info.filter(i => i.code.startsWith('STD-'));
    assert.ok(stdInfo.length >= 1);
    assert.ok(stdInfo.some(i => i.code === 'STD-000'));
  });

  it('reports standards coverage when standards selected', () => {
    runPanTools('standards select stride', tmpDir);
    const r = runPanTools('validate health --standards', tmpDir);
    assert.ok(r.success);
    const json = JSON.parse(r.output);
    const stdInfo = json.info.filter(i => i.code.startsWith('STD-'));
    assert.ok(stdInfo.length >= 1);
    assert.ok(stdInfo.some(i => i.code === 'STD-SUMMARY'));
    // stride has 0 checked items — should appear as warning
    const strideWarning = json.warnings.filter(w => w.code === 'STD-stride');
    assert.ok(strideWarning.length >= 1);
    assert.ok(strideWarning[0].message.includes('0/'));
  });

  it('detects checked items in standards', () => {
    runPanTools('standards select stride', tmpDir);
    const stdPath = path.join(tmpDir, '.planning', 'standards.md');
    let content = fs.readFileSync(stdPath, 'utf-8');
    content = content.replace('- [ ] Spoofing', '- [x] Spoofing');
    content = content.replace('- [ ] Tampering', '- [x] Tampering');
    fs.writeFileSync(stdPath, content, 'utf-8');
    const r = runPanTools('validate health --standards', tmpDir);
    assert.ok(r.success);
    const json = JSON.parse(r.output);
    // Should be info (partial) not warning
    const strideInfo = json.info.filter(i => i.code === 'STD-stride');
    assert.ok(strideInfo.length >= 1);
    assert.ok(strideInfo[0].message.includes('2/'));
  });

  it('does not include standards info without --standards flag', () => {
    runPanTools('standards select stride', tmpDir);
    const r = runPanTools('validate health', tmpDir);
    assert.ok(r.success);
    const json = JSON.parse(r.output);
    const stdInfo = (json.info || []).filter(i => i.code && i.code.startsWith('STD-'));
    assert.equal(stdInfo.length, 0);
  });
});

// ─── Unit Tests: v2 Constants ────────────────────────────────────────────────

describe('v2 Constants: PHASE_KEYWORDS_TO_STANDARDS', () => {
  it('maps auth keywords to OWASP standards', () => {
    assert.ok(PHASE_KEYWORDS_TO_STANDARDS['auth'].includes('owasp-top10'));
    assert.ok(PHASE_KEYWORDS_TO_STANDARDS['auth'].includes('owasp-asvs-l1'));
  });

  it('maps accessibility keywords to WCAG', () => {
    assert.ok(PHASE_KEYWORDS_TO_STANDARDS['accessibility'].includes('wcag-22'));
    assert.ok(PHASE_KEYWORDS_TO_STANDARDS['a11y'].includes('wcag-22'));
  });

  it('maps AI keywords to LLM standard', () => {
    assert.ok(PHASE_KEYWORDS_TO_STANDARDS['llm'].includes('owasp-llm-top10'));
  });

  it('maps agent keywords to agentic standard', () => {
    assert.ok(PHASE_KEYWORDS_TO_STANDARDS['agent'].includes('owasp-agentic-top10'));
  });

  it('maps threat keywords to STRIDE', () => {
    assert.ok(PHASE_KEYWORDS_TO_STANDARDS['threat'].includes('stride'));
  });

  it('maps commit keywords to conventional-commits', () => {
    assert.ok(PHASE_KEYWORDS_TO_STANDARDS['commit'].includes('conventional-commits'));
  });

  it('all mapped standard IDs exist in STANDARDS_CATALOG', () => {
    for (const [keyword, ids] of Object.entries(PHASE_KEYWORDS_TO_STANDARDS)) {
      for (const id of ids) {
        assert.ok(STANDARDS_CATALOG[id], `keyword "${keyword}" maps to unknown standard: ${id}`);
      }
    }
  });
});

describe('v2 Constants: STANDARDS_EXTERNAL_TOOLS', () => {
  it('has entries for all catalog standards', () => {
    for (const id of Object.keys(STANDARDS_CATALOG)) {
      assert.ok(id in STANDARDS_EXTERNAL_TOOLS, `missing external tools for ${id}`);
    }
  });

  it('each tool entry has name, url, description', () => {
    for (const [id, tools] of Object.entries(STANDARDS_EXTERNAL_TOOLS)) {
      for (const tool of tools) {
        assert.ok(tool.name, `${id} tool missing name`);
        assert.ok(tool.url, `${id} tool missing url`);
        assert.ok(tool.description, `${id} tool missing description`);
      }
    }
  });

  it('owasp-top10 has at least 2 tools', () => {
    assert.ok(STANDARDS_EXTERNAL_TOOLS['owasp-top10'].length >= 2);
  });

  it('wcag-22 includes axe-core', () => {
    const names = STANDARDS_EXTERNAL_TOOLS['wcag-22'].map(t => t.name);
    assert.ok(names.includes('axe-core'));
  });

  it('togaf-adm has empty tools array', () => {
    assert.ok(Array.isArray(STANDARDS_EXTERNAL_TOOLS['togaf-adm']));
    assert.equal(STANDARDS_EXTERNAL_TOOLS['togaf-adm'].length, 0);
  });
});

// ─── Unit Tests: detectStandardsFromContent ──────────────────────────────────

describe('detectStandardsFromContent', () => {
  it('returns empty array for empty content', () => {
    assert.deepEqual(detectStandardsFromContent(''), []);
  });

  it('detects security keywords', () => {
    const ids = detectStandardsFromContent('Implement authentication and session management');
    assert.ok(ids.includes('owasp-top10'));
    assert.ok(ids.includes('owasp-asvs-l1'));
  });

  it('detects accessibility keywords', () => {
    const ids = detectStandardsFromContent('Add ARIA labels for accessibility compliance');
    assert.ok(ids.includes('wcag-22'));
  });

  it('detects AI keywords', () => {
    const ids = detectStandardsFromContent('Integrate LLM for prompt generation');
    assert.ok(ids.includes('owasp-llm-top10'));
  });

  it('detects multiple standard categories', () => {
    const ids = detectStandardsFromContent('Build auth system with accessibility and agent support');
    assert.ok(ids.includes('owasp-top10'));
    assert.ok(ids.includes('wcag-22'));
    assert.ok(ids.includes('owasp-agentic-top10'));
  });

  it('is case-insensitive', () => {
    const ids = detectStandardsFromContent('AUTHENTICATION and Security concerns');
    assert.ok(ids.includes('owasp-top10'));
  });

  it('returns unique IDs only', () => {
    const ids = detectStandardsFromContent('auth login session password encrypt security');
    const unique = new Set(ids);
    assert.equal(ids.length, unique.size);
  });
});

// ─── Integration Tests: CLI standards phase-track ────────────────────────────

describe('CLI: standards phase-track', () => {
  let tmpDir;
  beforeEach(() => {
    tmpDir = createTempProject();
    // Create a phase with plan file
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '01-auth-setup');
    fs.mkdirSync(phaseDir, { recursive: true });
    fs.writeFileSync(path.join(phaseDir, 'A-plan.md'), `---
phase: 1
plan: A
---

# Authentication Setup

## Task 1: Implement login endpoint
Set up authentication with session management and password hashing.

## Task 2: Add API security
Add rate limiting and input validation to prevent injection attacks.
`);
    // Create roadmap so findPhaseInternal works
    fs.writeFileSync(path.join(tmpDir, '.planning', 'roadmap.md'), `# Roadmap

## Phase 1 — Auth Setup
Authentication and authorization implementation.
`);
  });
  afterEach(() => { cleanup(tmpDir); });

  it('errors without phase argument', () => {
    const r = runPanTools('standards phase-track', tmpDir);
    assert.ok(!r.success);
  });

  it('errors for non-existent phase', () => {
    const r = runPanTools('standards phase-track 99', tmpDir);
    assert.ok(!r.success);
  });

  it('detects relevant standards from phase content', () => {
    const r = runPanTools('standards phase-track 1', tmpDir);
    assert.ok(r.success, 'should succeed: ' + r.error);
    const json = JSON.parse(r.output);
    assert.equal(json.phase, '1');
    assert.ok(json.relevant_standards.length >= 1);
    assert.ok(json.relevant_standards.includes('owasp-top10'));
  });

  it('shows not_selected status when no standards.md', () => {
    const r = runPanTools('standards phase-track 1', tmpDir);
    assert.ok(r.success);
    const json = JSON.parse(r.output);
    for (const c of json.compliance) {
      assert.equal(c.selected, false);
      assert.equal(c.status, 'not_selected');
      assert.ok(c.action);
    }
  });

  it('shows compliance state for selected standards', () => {
    runPanTools('standards select owasp-top10', tmpDir);
    const r = runPanTools('standards phase-track 1', tmpDir);
    assert.ok(r.success);
    const json = JSON.parse(r.output);
    const owasp = json.compliance.find(c => c.standard_id === 'owasp-top10');
    assert.ok(owasp);
    assert.equal(owasp.selected, true);
    assert.equal(owasp.status, 'configured');
    assert.equal(owasp.coverage, '0%');
    assert.ok(owasp.checklist_items >= 5);
  });

  it('shows partial coverage when items are checked', () => {
    runPanTools('standards select owasp-top10', tmpDir);
    const stdPath = path.join(tmpDir, '.planning', 'standards.md');
    let content = fs.readFileSync(stdPath, 'utf-8');
    content = content.replace(/- \[ \] ([^\n]+)/, '- [x] $1');
    fs.writeFileSync(stdPath, content, 'utf-8');
    const r = runPanTools('standards phase-track 1', tmpDir);
    assert.ok(r.success);
    const json = JSON.parse(r.output);
    const owasp = json.compliance.find(c => c.standard_id === 'owasp-top10');
    assert.equal(owasp.status, 'partial');
    assert.equal(owasp.verified_items, 1);
  });
});

// ─── Integration Tests: CLI standards tools ──────────────────────────────────

describe('CLI: standards tools', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = createTempProject(); });
  afterEach(() => { cleanup(tmpDir); });

  it('returns tools for specific standard', () => {
    const r = runPanTools('standards tools owasp-top10', tmpDir);
    assert.ok(r.success, 'should succeed');
    const json = JSON.parse(r.output);
    assert.deepEqual(json.standards_queried, ['owasp-top10']);
    assert.equal(json.recommendations.length, 1);
    assert.ok(json.recommendations[0].tools.length >= 2);
    assert.ok(json.unique_tools.length >= 2);
  });

  it('returns tools for project standards', () => {
    runPanTools('standards select owasp-top10', tmpDir);
    runPanTools('standards select stride', tmpDir);
    const r = runPanTools('standards tools', tmpDir);
    assert.ok(r.success);
    const json = JSON.parse(r.output);
    assert.equal(json.standards_queried.length, 2);
    assert.ok(json.unique_tools.length >= 2);
    // Verify deduplication
    const names = json.unique_tools.map(t => t.name);
    assert.equal(names.length, new Set(names).size);
  });

  it('tool entries have name, url, description', () => {
    const r = runPanTools('standards tools wcag-22', tmpDir);
    assert.ok(r.success);
    const json = JSON.parse(r.output);
    for (const tool of json.unique_tools) {
      assert.ok(tool.name, 'tool missing name');
      assert.ok(tool.url, 'tool missing url');
      assert.ok(tool.description, 'tool missing description');
      assert.ok(Array.isArray(tool.standards));
    }
  });

  it('errors on unknown standard ID', () => {
    const r = runPanTools('standards tools fake-standard', tmpDir);
    assert.ok(!r.success);
  });

  it('errors with no standards and no argument', () => {
    const r = runPanTools('standards tools', tmpDir);
    assert.ok(!r.success);
  });

  it('returns empty tools for togaf-adm', () => {
    const r = runPanTools('standards tools togaf-adm', tmpDir);
    assert.ok(r.success);
    const json = JSON.parse(r.output);
    assert.equal(json.recommendations[0].tools.length, 0);
    assert.equal(json.unique_tools.length, 0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Agent prompt content validation — test tier enforcement
// ─────────────────────────────────────────────────────────────────────────────

describe('agent prompt test tier enforcement', () => {
  it('pan-planner.md includes test tier classification section', () => {
    const content = fs.readFileSync(
      path.join(__dirname, '..', 'agents', 'pan-planner.md'), 'utf-8'
    );
    assert.ok(content.includes('Test Tier Classification'), 'Missing test tier classification section');
    assert.ok(content.includes('Minimum Tier'), 'Missing tier decision rules table');
  });

  it('pan-plan-checker.md includes Dimension 8 test coverage alignment', () => {
    const content = fs.readFileSync(
      path.join(__dirname, '..', 'agents', 'pan-plan-checker.md'), 'utf-8'
    );
    assert.ok(content.includes('Dimension 8'), 'Missing Dimension 8');
    assert.ok(content.includes('Test Coverage Alignment'), 'Missing Test Coverage Alignment content');
  });

  it('pan-plan-checker has at least 8 verification dimensions', () => {
    const content = fs.readFileSync(
      path.join(__dirname, '..', 'agents', 'pan-plan-checker.md'), 'utf-8'
    );
    const dimensionMatches = content.match(/## Dimension \d+/g) || [];
    const maxDimension = Math.max(...dimensionMatches.map(m => parseInt(m.match(/\d+/)[0])));
    assert.ok(maxDimension >= 8, `Expected at least 8 dimensions, found ${maxDimension}`);
  });
});

describe('agent prompt verification and infrastructure enforcement', () => {
  it('pan-verifier has Step 5b Test Coverage Alignment', () => {
    const content = fs.readFileSync(
      path.join(__dirname, '..', 'agents', 'pan-verifier.md'), 'utf-8'
    );
    assert.ok(content.includes('Step 5b: Verify Test Coverage Alignment'), 'Missing Step 5b');
    assert.ok(content.includes('COVERAGE_GAP'), 'Missing COVERAGE_GAP flag');
    assert.ok(content.includes('TIER_MISMATCH'), 'Missing TIER_MISMATCH flag');
  });

  it('pan-verifier has Step 0b prior phase verification check', () => {
    const content = fs.readFileSync(
      path.join(__dirname, '..', 'agents', 'pan-verifier.md'), 'utf-8'
    );
    assert.ok(content.includes('Step 0b: Check Prior Phase Verification'), 'Missing Step 0b');
    assert.ok(content.includes('PRIOR_PHASE_UNVERIFIED'), 'Missing PRIOR_PHASE_UNVERIFIED code');
  });

  it('pan-phase-researcher has Infrastructure Dependencies section', () => {
    const content = fs.readFileSync(
      path.join(__dirname, '..', 'agents', 'pan-phase-researcher.md'), 'utf-8'
    );
    assert.ok(content.includes('## Infrastructure Dependencies'), 'Missing Infrastructure Dependencies');
    assert.ok(content.includes('Docker Compose proposal'), 'Missing Docker Compose proposal');
  });

  it('pan-project-researcher has Infrastructure Dependencies section', () => {
    const content = fs.readFileSync(
      path.join(__dirname, '..', 'agents', 'pan-project-researcher.md'), 'utf-8'
    );
    assert.ok(content.includes('## Infrastructure Dependencies'), 'Missing Infrastructure Dependencies');
    assert.ok(content.includes('Docker Compose proposal'), 'Missing Docker Compose proposal');
  });
});
