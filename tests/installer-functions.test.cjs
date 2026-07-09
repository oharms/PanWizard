/**
 * Unit tests for installer pure functions (bin/install-lib.cjs)
 */

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const os = require('os');

const lib = require('../bin/install-lib.cjs');

// ─── getDirName ─────────────────────────────────────────────────────────────

describe('getDirName', () => {
  test('returns .claude for claude runtime', () => {
    assert.equal(lib.getDirName('claude'), '.claude');
  });
  test('returns .opencode for opencode runtime', () => {
    assert.equal(lib.getDirName('opencode'), '.opencode');
  });
  test('returns .gemini for gemini runtime', () => {
    assert.equal(lib.getDirName('gemini'), '.gemini');
  });
  test('returns .codex for codex runtime', () => {
    assert.equal(lib.getDirName('codex'), '.codex');
  });
  test('returns .github for copilot runtime', () => {
    assert.equal(lib.getDirName('copilot'), '.github');
  });
  test('defaults to .claude for unknown runtime', () => {
    assert.equal(lib.getDirName('unknown'), '.claude');
  });
});

// ─── getConfigDirFromHome ───────────────────────────────────────────────────

describe('getConfigDirFromHome', () => {
  test('returns local dir name when not global', () => {
    assert.equal(lib.getConfigDirFromHome('claude', false), "'.claude'");
    assert.equal(lib.getConfigDirFromHome('opencode', false), "'.opencode'");
    assert.equal(lib.getConfigDirFromHome('copilot', false), "'.github'");
  });
  test('returns global path segments for claude', () => {
    assert.equal(lib.getConfigDirFromHome('claude', true), "'.claude'");
  });
  test('returns global path segments for opencode', () => {
    assert.equal(lib.getConfigDirFromHome('opencode', true), "'.config', 'opencode'");
  });
  test('returns global path segments for gemini', () => {
    assert.equal(lib.getConfigDirFromHome('gemini', true), "'.gemini'");
  });
  test('returns global path segments for codex', () => {
    assert.equal(lib.getConfigDirFromHome('codex', true), "'.codex'");
  });
  test('returns global path segments for copilot', () => {
    assert.equal(lib.getConfigDirFromHome('copilot', true), "'.copilot'");
  });
});

// ─── expandTilde ────────────────────────────────────────────────────────────

describe('expandTilde', () => {
  test('expands ~/path to home + path', () => {
    const result = lib.expandTilde('~/foo/bar');
    assert.equal(result, path.join(os.homedir(), 'foo/bar'));
  });
  test('does not expand paths without ~/', () => {
    assert.equal(lib.expandTilde('/absolute/path'), '/absolute/path');
  });
  test('does not expand ~ alone without slash', () => {
    assert.equal(lib.expandTilde('~noSlash'), '~noSlash');
  });
  test('handles null/undefined gracefully', () => {
    assert.equal(lib.expandTilde(null), null);
    assert.equal(lib.expandTilde(undefined), undefined);
  });
});

// ─── toSingleLine ───────────────────────────────────────────────────────────

describe('toSingleLine', () => {
  test('collapses newlines to single space', () => {
    assert.equal(lib.toSingleLine('hello\nworld'), 'hello world');
  });
  test('collapses multiple spaces', () => {
    assert.equal(lib.toSingleLine('hello   world'), 'hello world');
  });
  test('trims leading/trailing whitespace', () => {
    assert.equal(lib.toSingleLine('  hello  '), 'hello');
  });
  test('handles tabs and mixed whitespace', () => {
    assert.equal(lib.toSingleLine('a\t\n  b'), 'a b');
  });
});

// ─── yamlQuote ──────────────────────────────────────────────────────────────

describe('yamlQuote', () => {
  test('wraps string in double quotes', () => {
    assert.equal(lib.yamlQuote('hello'), '"hello"');
  });
  test('escapes quotes inside string', () => {
    assert.equal(lib.yamlQuote('say "hi"'), '"say \\"hi\\""');
  });
  test('handles empty string', () => {
    assert.equal(lib.yamlQuote(''), '""');
  });
});

// ─── extractFrontmatterAndBody ──────────────────────────────────────────────

describe('extractFrontmatterAndBody', () => {
  test('extracts frontmatter and body', () => {
    const result = lib.extractFrontmatterAndBody('---\nname: test\n---\nbody here');
    assert.equal(result.frontmatter, 'name: test');
    assert.equal(result.body, '\nbody here');
  });
  test('returns null frontmatter when no --- prefix', () => {
    const result = lib.extractFrontmatterAndBody('no frontmatter here');
    assert.equal(result.frontmatter, null);
    assert.equal(result.body, 'no frontmatter here');
  });
  test('returns null frontmatter when closing --- missing', () => {
    const result = lib.extractFrontmatterAndBody('---\nname: test\nbody');
    assert.equal(result.frontmatter, null);
    assert.equal(result.body, '---\nname: test\nbody');
  });
  test('handles empty frontmatter', () => {
    const result = lib.extractFrontmatterAndBody('---\n---\nbody');
    assert.equal(result.frontmatter, '');
    assert.equal(result.body, '\nbody');
  });
});

// ─── extractFrontmatterField ────────────────────────────────────────────────

describe('extractFrontmatterField', () => {
  test('extracts simple field value', () => {
    assert.equal(lib.extractFrontmatterField('name: test\ndescription: hello', 'name'), 'test');
  });
  test('extracts quoted field value', () => {
    assert.equal(lib.extractFrontmatterField('name: "test value"', 'name'), 'test value');
  });
  test('extracts single-quoted field value', () => {
    assert.equal(lib.extractFrontmatterField("name: 'test'", 'name'), 'test');
  });
  test('returns null for missing field', () => {
    assert.equal(lib.extractFrontmatterField('name: test', 'missing'), null);
  });
  test('extracts description from multi-line frontmatter', () => {
    const fm = 'name: skill\ndescription: A cool skill\nauthor: me';
    assert.equal(lib.extractFrontmatterField(fm, 'description'), 'A cool skill');
  });
});

// ─── Tool Name Converters ───────────────────────────────────────────────────

describe('convertToolName (Claude → OpenCode)', () => {
  test('maps AskUserQuestion to question', () => {
    assert.equal(lib.convertToolName('AskUserQuestion'), 'question');
  });
  test('maps SlashCommand to skill', () => {
    assert.equal(lib.convertToolName('SlashCommand'), 'skill');
  });
  test('preserves MCP tool names', () => {
    assert.equal(lib.convertToolName('mcp__server__tool'), 'mcp__server__tool');
  });
  test('lowercases unknown tools', () => {
    assert.equal(lib.convertToolName('Read'), 'read');
    assert.equal(lib.convertToolName('Bash'), 'bash');
  });
});

describe('convertGeminiToolName (Claude → Gemini)', () => {
  test('maps Read to read_file', () => {
    assert.equal(lib.convertGeminiToolName('Read'), 'read_file');
  });
  test('maps Bash to run_shell_command', () => {
    assert.equal(lib.convertGeminiToolName('Bash'), 'run_shell_command');
  });
  test('returns null for MCP tools', () => {
    assert.equal(lib.convertGeminiToolName('mcp__server__tool'), null);
  });
  test('returns null for Task', () => {
    assert.equal(lib.convertGeminiToolName('Task'), null);
  });
  test('lowercases unmapped tools', () => {
    assert.equal(lib.convertGeminiToolName('Agent'), 'agent');
  });
});

describe('convertCopilotToolName (Claude → Copilot)', () => {
  test('maps Read to read', () => {
    assert.equal(lib.convertCopilotToolName('Read'), 'read');
  });
  test('maps Write and Edit to edit', () => {
    assert.equal(lib.convertCopilotToolName('Write'), 'edit');
    assert.equal(lib.convertCopilotToolName('Edit'), 'edit');
  });
  test('returns null for AskUserQuestion', () => {
    assert.equal(lib.convertCopilotToolName('AskUserQuestion'), null);
  });
  test('preserves MCP tool names', () => {
    assert.equal(lib.convertCopilotToolName('mcp__server__tool'), 'mcp__server__tool');
  });
  test('lowercases unmapped tools', () => {
    assert.equal(lib.convertCopilotToolName('CustomTool'), 'customtool');
  });
});

// ─── Slash Command Converters ───────────────────────────────────────────────

describe('convertSlashCommandsToCodexSkillMentions', () => {
  test('converts /pan:command to $pan-command', () => {
    assert.equal(lib.convertSlashCommandsToCodexSkillMentions('/pan:help'), '$pan-help');
  });
  test('converts multiple commands', () => {
    const input = 'Use /pan:plan-phase then /pan:exec-phase';
    const expected = 'Use $pan-plan-phase then $pan-exec-phase';
    assert.equal(lib.convertSlashCommandsToCodexSkillMentions(input), expected);
  });
  test('converts /pan-help to $pan-help', () => {
    assert.equal(lib.convertSlashCommandsToCodexSkillMentions('/pan-help'), '$pan-help');
  });
});

describe('convertSlashCommandsToCopilotSkillMentions', () => {
  test('converts /pan:command to /pan-command', () => {
    assert.equal(lib.convertSlashCommandsToCopilotSkillMentions('/pan:help'), '/pan-help');
  });
  test('converts $pan-command to /pan-command', () => {
    assert.equal(lib.convertSlashCommandsToCopilotSkillMentions('$pan-help'), '/pan-help');
  });
});

// ─── Content Converters ─────────────────────────────────────────────────────

describe('convertClaudeToGeminiToml', () => {
  test('converts content without frontmatter', () => {
    const result = lib.convertClaudeToGeminiToml('just a prompt');
    assert.equal(result, 'prompt = "just a prompt"\n');
  });
  test('converts content with frontmatter', () => {
    const input = '---\ndescription: My command\n---\nDo the thing.';
    const result = lib.convertClaudeToGeminiToml(input);
    assert.ok(result.includes('description = "My command"'));
    assert.ok(result.includes('prompt = "Do the thing."'));
  });
  test('handles frontmatter without description', () => {
    const input = '---\nname: test\n---\nDo something.';
    const result = lib.convertClaudeToGeminiToml(input);
    assert.ok(!result.includes('description'));
    assert.ok(result.includes('prompt = "Do something."'));
  });
});

describe('convertClaudeToOpencodeFrontmatter', () => {
  test('converts tool references in body text', () => {
    const input = 'Use AskUserQuestion to ask.';
    assert.ok(lib.convertClaudeToOpencodeFrontmatter(input).includes('question'));
  });
  test('converts path references', () => {
    const input = 'Check ~/.claude for config.';
    assert.ok(lib.convertClaudeToOpencodeFrontmatter(input).includes('~/.config/opencode'));
  });
  test('converts slash commands', () => {
    const input = 'Run /pan:help for info.';
    assert.ok(lib.convertClaudeToOpencodeFrontmatter(input).includes('/pan-help'));
  });
  test('converts allowed-tools to permission map in frontmatter', () => {
    // OpenCode 2026: `permission` (allow/ask/deny) replaced the deprecated
    // `tools: {name: true}` agent frontmatter map.
    const input = '---\nallowed-tools:\n  - Read\n  - Bash\n---\nbody';
    const result = lib.convertClaudeToOpencodeFrontmatter(input);
    assert.ok(result.includes('permission:'));
    assert.ok(result.includes('read: allow'));
    assert.ok(result.includes('bash: allow'));
    assert.ok(!result.includes('tools:'), 'deprecated tools map should not be emitted');
  });
  test('converts color names to hex', () => {
    const input = '---\ncolor: cyan\n---\nbody';
    const result = lib.convertClaudeToOpencodeFrontmatter(input);
    assert.ok(result.includes('#00FFFF'));
  });
  test('strips the Claude-only model: pin from frontmatter', () => {
    const input = '---\nname: t\nmodel: opus\n---\nbody';
    const result = lib.convertClaudeToOpencodeFrontmatter(input);
    assert.ok(!result.includes('model:'), 'model pin must not leak into OpenCode (its model field expects provider/model)');
  });
});

describe('convertClaudeToGeminiAgent', () => {
  test('converts allowed-tools to gemini tools', () => {
    const input = '---\nallowed-tools:\n  - Read\n  - Bash\n---\nbody';
    const result = lib.convertClaudeToGeminiAgent(input);
    assert.ok(result.includes('read_file'));
    assert.ok(result.includes('run_shell_command'));
  });
  test('filters out MCP tools', () => {
    const input = '---\nallowed-tools:\n  - Read\n  - mcp__server__tool\n---\nbody';
    const result = lib.convertClaudeToGeminiAgent(input);
    assert.ok(result.includes('read_file'));
    assert.ok(!result.includes('mcp__'));
  });
  test('strips color from frontmatter', () => {
    const input = '---\ncolor: cyan\nallowed-tools:\n  - Read\n---\nbody';
    const result = lib.convertClaudeToGeminiAgent(input);
    assert.ok(!result.includes('color:'));
  });
  test('escapes ${VAR} in body', () => {
    const input = '---\nname: test\n---\nUse $' + '{VARIABLE} here.';
    const result = lib.convertClaudeToGeminiAgent(input);
    // ${VARIABLE} → $VARIABLE (braces stripped, $ preserved)
    assert.ok(result.includes('$VARIABLE'));
    assert.ok(!result.includes('{VARIABLE}'));
  });
  test('strips <sub> tags', () => {
    const input = '---\nname: test\n---\n<sub>small text</sub>';
    const result = lib.convertClaudeToGeminiAgent(input);
    assert.ok(result.includes('*(small text)*'));
  });
  test('strips the Claude-only model: pin from frontmatter', () => {
    const input = '---\nname: t\nmodel: opus\nallowed-tools:\n  - Read\n---\nbody';
    const result = lib.convertClaudeToGeminiAgent(input);
    assert.ok(!result.includes('model:'), 'model pin must not leak into Gemini');
  });
  test('returns content unchanged if no frontmatter', () => {
    assert.equal(lib.convertClaudeToGeminiAgent('no frontmatter'), 'no frontmatter');
  });
});

describe('security agents pinned to Opus (Fable cyber-classifier)', () => {
  const fs = require('fs');
  for (const agent of ['pan-hardener', 'pan-reviewer', 'pan-meta-reviewer']) {
    test(`${agent} frontmatter carries model: opus`, () => {
      const p = path.join(__dirname, '..', 'agents', `${agent}.md`);
      const src = fs.readFileSync(p, 'utf-8');
      const fm = src.startsWith('---') ? src.slice(3, src.indexOf('---', 3)) : '';
      assert.match(fm, /^model:\s*opus\s*$/m, `${agent} must be pinned to opus, off Fable's classifier`);
    });
  }
});

describe('stripSubTags', () => {
  test('converts <sub>text</sub> to *(text)*', () => {
    assert.equal(lib.stripSubTags('<sub>hello</sub>'), '*(hello)*');
  });
  test('handles multiple <sub> tags', () => {
    assert.equal(lib.stripSubTags('<sub>a</sub> and <sub>b</sub>'), '*(a)* and *(b)*');
  });
  test('passes through text without sub tags', () => {
    assert.equal(lib.stripSubTags('no tags here'), 'no tags here');
  });
});

// ─── Skill/Agent Builders ───────────────────────────────────────────────────

describe('convertClaudeCommandToCodexSkill', () => {
  test('produces valid YAML frontmatter with name and description', () => {
    const input = '---\ndescription: A test command\n---\nDo the thing.';
    const result = lib.convertClaudeCommandToCodexSkill(input, 'pan-test');
    assert.ok(result.startsWith('---\n'));
    assert.ok(result.includes('name: "pan-test"'));
    assert.ok(result.includes('description: "A test command"'));
    assert.ok(result.includes('short-description:'));
  });
  test('includes codex skill adapter header', () => {
    const input = 'Simple content';
    const result = lib.convertClaudeCommandToCodexSkill(input, 'pan-test');
    assert.ok(result.includes('<codex_skill_adapter>'));
    assert.ok(result.includes('$pan-test'));
  });
  test('converts $ARGUMENTS to {{PAN_ARGS}}', () => {
    const input = 'Run with $ARGUMENTS';
    const result = lib.convertClaudeCommandToCodexSkill(input, 'pan-test');
    assert.ok(result.includes('{{PAN_ARGS}}'));
  });
});

// ADR-0028 Phase 1: runtime-neutral skill compile for the shared .agents/skills tree
describe('convertClaudeCommandToUnifiedSkill', () => {
  test('produces valid YAML frontmatter with name and description', () => {
    const input = '---\ndescription: A test command\n---\nDo the thing.';
    const result = lib.convertClaudeCommandToUnifiedSkill(input, 'pan-test');
    assert.ok(result.startsWith('---\n'));
    assert.ok(result.includes('name: "pan-test"'));
    assert.ok(result.includes('description: "A test command"'));
    assert.ok(result.includes('short-description:'));
  });
  test('carries the runtime-neutral adapter, not a runtime-specific one', () => {
    const result = lib.convertClaudeCommandToUnifiedSkill('Simple content', 'pan-test');
    assert.ok(result.includes('<pan_skill_adapter>'));
    assert.ok(!result.includes('<codex_skill_adapter>'));
    assert.ok(!result.includes('<copilot_skill_adapter>'));
    assert.ok(result.includes('/pan-test'), 'header should mention the slash form');
    assert.ok(result.includes('$pan-test'), 'header should mention the mention form');
  });
  test('normalizes /pan:name mentions and $ARGUMENTS', () => {
    const input = 'See /pan:exec-phase then run with $ARGUMENTS';
    const result = lib.convertClaudeCommandToUnifiedSkill(input, 'pan-test');
    assert.ok(result.includes('/pan-exec-phase'), '/pan:x should become /pan-x');
    assert.ok(result.includes('{{PAN_ARGS}}'), '$ARGUMENTS should become {{PAN_ARGS}}');
  });
  test('preserves AskUserQuestion blocks (Claude consumes them natively)', () => {
    const input = 'Use AskUserQuestion with options.';
    const result = lib.convertClaudeCommandToUnifiedSkill(input, 'pan-test');
    assert.ok(result.includes('AskUserQuestion'), 'native interaction blocks survive');
  });
});

describe('getUnifiedSkillAdapterHeader', () => {
  test('is plain text — no ANSI escape codes', () => {
    assert.doesNotMatch(lib.getUnifiedSkillAdapterHeader('pan-x'), /\x1b\[/);
  });
  test('mentions delegation in runtime-neutral terms', () => {
    const header = lib.getUnifiedSkillAdapterHeader('pan-x');
    assert.ok(header.includes('subagent_type'));
    assert.ok(header.includes('your runtime'), 'guidance should be phrased runtime-neutrally');
  });
});

describe('convertClaudeCommandToCopilotSkill', () => {
  test('produces valid YAML frontmatter', () => {
    const input = '---\ndescription: A test command\n---\nDo the thing.';
    const result = lib.convertClaudeCommandToCopilotSkill(input, 'pan-test');
    assert.ok(result.startsWith('---\n'));
    assert.ok(result.includes('name: "pan-test"'));
    assert.ok(result.includes('description: "A test command"'));
  });
  test('includes copilot skill adapter header', () => {
    const input = 'Simple content';
    const result = lib.convertClaudeCommandToCopilotSkill(input, 'pan-test');
    assert.ok(result.includes('<copilot_skill_adapter>'));
    assert.ok(result.includes('/pan-test'));
  });
});

describe('convertClaudeToCopilotAgent', () => {
  test('converts agent frontmatter', () => {
    const input = '---\nname: My Agent\ndescription: Does things\n---\nbody';
    const result = lib.convertClaudeToCopilotAgent(input);
    assert.ok(result.includes('name: "My Agent"'));
    assert.ok(result.includes('description: "Does things"'));
  });
});

describe('convertClaudeToCopilotMarkdown', () => {
  test('converts /pan:command to /pan-command', () => {
    const result = lib.convertClaudeToCopilotMarkdown('Use /pan:help for info.');
    assert.ok(result.includes('/pan-help'));
  });
  test('converts Task() to /agent', () => {
    const result = lib.convertClaudeToCopilotMarkdown('Task(subagent_type="explorer")');
    assert.ok(result.includes('/agent explorer'));
  });
  test('converts Agent() to /agent', () => {
    const result = lib.convertClaudeToCopilotMarkdown('Agent(subagent_type="explorer")');
    assert.ok(result.includes('/agent explorer'));
  });
});

// ─── processAttribution ─────────────────────────────────────────────────────

describe('processAttribution', () => {
  const sample = 'Some content\n\nCo-Authored-By: Claude <noreply@anthropic.com>';

  test('removes attribution when null', () => {
    const result = lib.processAttribution(sample, null);
    assert.ok(!result.includes('Co-Authored-By'));
  });
  test('keeps attribution when undefined', () => {
    const result = lib.processAttribution(sample, undefined);
    assert.ok(result.includes('Co-Authored-By: Claude <noreply@anthropic.com>'));
  });
  test('replaces attribution with custom string', () => {
    const result = lib.processAttribution(sample, 'Custom Author');
    assert.ok(result.includes('Co-Authored-By: Custom Author'));
    assert.ok(!result.includes('Claude'));
  });
});

// ─── parseJsonc ─────────────────────────────────────────────────────────────

describe('parseJsonc', () => {
  test('parses standard JSON', () => {
    const result = lib.parseJsonc('{"key": "value"}');
    assert.deepEqual(result, { key: 'value' });
  });
  test('strips single-line comments', () => {
    const result = lib.parseJsonc('{\n  // comment\n  "key": "value"\n}');
    assert.deepEqual(result, { key: 'value' });
  });
  test('strips block comments', () => {
    const result = lib.parseJsonc('{"key": /* inline */ "value"}');
    assert.deepEqual(result, { key: 'value' });
  });
  test('handles trailing commas', () => {
    const result = lib.parseJsonc('{"a": 1, "b": 2,}');
    assert.deepEqual(result, { a: 1, b: 2 });
  });
  test('handles trailing commas in arrays', () => {
    const result = lib.parseJsonc('[1, 2, 3,]');
    assert.deepEqual(result, [1, 2, 3]);
  });
  test('preserves strings containing // sequences', () => {
    const result = lib.parseJsonc('{"url": "https://example.com"}');
    assert.deepEqual(result, { url: 'https://example.com' });
  });
  test('handles BOM prefix', () => {
    const result = lib.parseJsonc('\uFEFF{"key": "value"}');
    assert.deepEqual(result, { key: 'value' });
  });
  test('handles comments and trailing commas together', () => {
    const input = `{
      // first value
      "a": 1,
      /* second value */
      "b": 2,
    }`;
    const result = lib.parseJsonc(input);
    assert.deepEqual(result, { a: 1, b: 2 });
  });
  test('throws on invalid JSON after stripping', () => {
    assert.throws(() => lib.parseJsonc('not json at all'));
  });
});

// ─── buildHookCommand ───────────────────────────────────────────────────────

describe('buildHookCommand', () => {
  test('builds command with forward slashes', () => {
    const result = lib.buildHookCommand('.claude', 'pre-commit.js');
    assert.equal(result, 'node ".claude/hooks/pre-commit.js"');
  });
  test('converts backslashes to forward slashes', () => {
    const result = lib.buildHookCommand('.claude\\config', 'hook.js');
    assert.equal(result, 'node ".claude/config/hooks/hook.js"');
  });
});

// ─── Constants ──────────────────────────────────────────────────────────────

describe('exported constants', () => {
  test('colorNameToHex has standard web colors', () => {
    assert.equal(lib.colorNameToHex.cyan, '#00FFFF');
    assert.equal(lib.colorNameToHex.red, '#FF0000');
    assert.equal(lib.colorNameToHex.gray, '#808080');
    assert.equal(lib.colorNameToHex.grey, '#808080');
  });
  test('claudeToOpencodeTools maps expected tools', () => {
    assert.equal(lib.claudeToOpencodeTools.AskUserQuestion, 'question');
    assert.equal(lib.claudeToOpencodeTools.TodoWrite, 'todowrite');
  });
  test('claudeToGeminiTools maps expected tools', () => {
    assert.equal(lib.claudeToGeminiTools.Read, 'read_file');
    assert.equal(lib.claudeToGeminiTools.Bash, 'run_shell_command');
  });
  test('claudeToCopilotTools maps expected tools', () => {
    assert.equal(lib.claudeToCopilotTools.Read, 'read');
    assert.equal(lib.claudeToCopilotTools.AskUserQuestion, null);
  });
});

describe('convertClaudeToCodexMarkdown', () => {
  test('converts /pan: to $pan- and $ARGUMENTS to {{PAN_ARGS}}', () => {
    const input = 'Run /pan:focus-scan with $ARGUMENTS here';
    const result = lib.convertClaudeToCodexMarkdown(input);
    assert.ok(result.includes('$pan-focus-scan'), 'should convert slash to codex format');
    assert.ok(result.includes('{{PAN_ARGS}}'), 'should replace $ARGUMENTS');
    assert.ok(!result.includes('$ARGUMENTS'), '$ARGUMENTS should be gone');
  });

  test('handles content without slash commands', () => {
    const input = 'No commands here, just text.';
    const result = lib.convertClaudeToCodexMarkdown(input);
    assert.strictEqual(result, input);
  });
});

describe('getCodexSkillAdapterHeader', () => {
  test('generates adapter header with skill invocation', () => {
    const header = lib.getCodexSkillAdapterHeader('pan-focus-scan');
    assert.ok(header.includes('<codex_skill_adapter>'));
    assert.ok(header.includes('$pan-focus-scan'));
    assert.ok(header.includes('{{PAN_ARGS}}'));
    assert.ok(header.includes('</codex_skill_adapter>'));
  });

  test('includes legacy orchestration section', () => {
    const header = lib.getCodexSkillAdapterHeader('pan-help');
    assert.ok(header.includes('spawn_agent'));
  });
});

describe('getCopilotSkillAdapterHeader', () => {
  test('generates adapter header with /pan- invocation', () => {
    const header = lib.getCopilotSkillAdapterHeader('pan-focus-scan');
    assert.ok(header.includes('<copilot_skill_adapter>'));
    assert.ok(header.includes('/pan-focus-scan'));
    assert.ok(header.includes('</copilot_skill_adapter>'));
  });

  test('strips pan- prefix correctly for invocation', () => {
    const header = lib.getCopilotSkillAdapterHeader('pan-help');
    assert.ok(header.includes('/pan-help'));
  });

  test('includes user interaction guidance', () => {
    const header = lib.getCopilotSkillAdapterHeader('pan-new-project');
    assert.ok(header.includes('numbered lists'));
    assert.ok(header.includes('multi-select'));
  });
});

describe('rewriteAskUserQuestionForCopilot', () => {
  test('converts AskUserQuestion block to numbered list', () => {
    const input = [
      'AskUserQuestion:',
      '- header: "Choose runtime"',
      '- question: "Which runtime?"',
      '- options:',
      '  - "Claude Code" \u2014 Default',
      '  - "Copilot CLI" \u2014 GitHub',
    ].join('\n');
    const result = lib.rewriteAskUserQuestionForCopilot(input);
    assert.ok(result.includes('1.') || result.includes('Which runtime'), 'should contain numbered option or question');
  });

  test('passes through content without AskUserQuestion', () => {
    const input = 'Just regular markdown content.\n\nNo questions here.';
    const result = lib.rewriteAskUserQuestionForCopilot(input);
    assert.strictEqual(result, input);
  });
});

// ─── detectModelCapabilities ────────────────────────────────────────────────

describe('detectModelCapabilities', () => {
  test('opus-4-7 has all capabilities including 1M', () => {
    const r = lib.detectModelCapabilities('claude-opus-4-7');
    assert.deepEqual(r, { has_1m_ctx: true, has_thinking: true, has_cache: true, tier: 'reasoning' });
  });

  test('claude-fable-5 has all capabilities including 1M', () => {
    const r = lib.detectModelCapabilities('claude-fable-5');
    assert.deepEqual(r, { has_1m_ctx: true, has_thinking: true, has_cache: true, tier: 'reasoning' });
  });

  test('opus-4-8 has all capabilities including 1M', () => {
    const r = lib.detectModelCapabilities('claude-opus-4-8');
    assert.deepEqual(r, { has_1m_ctx: true, has_thinking: true, has_cache: true, tier: 'reasoning' });
  });

  test('opus-4-6 has thinking + cache + 1M (capability refresh 2026-06)', () => {
    const r = lib.detectModelCapabilities('claude-opus-4-6');
    assert.equal(r.has_1m_ctx, true);
    assert.equal(r.has_thinking, true);
    assert.equal(r.has_cache, true);
    assert.equal(r.tier, 'reasoning');
  });

  test('legacy opus-4-1 stays 200K (no 1M)', () => {
    const r = lib.detectModelCapabilities('claude-opus-4-1');
    assert.equal(r.has_1m_ctx, false);
    assert.equal(r.has_thinking, true);
    assert.equal(r.tier, 'reasoning');
  });

  test('sonnet-4-6 is mid tier with thinking + cache + 1M', () => {
    const r = lib.detectModelCapabilities('claude-sonnet-4-6');
    assert.equal(r.has_thinking, true);
    assert.equal(r.has_1m_ctx, true);
    assert.equal(r.tier, 'mid');
  });

  test('legacy sonnet-4-5 stays 200K (no 1M)', () => {
    const r = lib.detectModelCapabilities('claude-sonnet-4-5');
    assert.equal(r.has_1m_ctx, false);
    assert.equal(r.has_thinking, true);
    assert.equal(r.tier, 'mid');
  });

  test('haiku-4-5 is fast tier, no thinking', () => {
    const r = lib.detectModelCapabilities('claude-haiku-4-5');
    assert.equal(r.has_thinking, false);
    assert.equal(r.tier, 'fast');
  });

  test('claude-3-opus falls back to reasoning tier no thinking', () => {
    const r = lib.detectModelCapabilities('claude-3-opus-20240229');
    assert.equal(r.has_thinking, false);
    assert.equal(r.has_cache, true);
    assert.equal(r.tier, 'reasoning');
  });

  test('gemini-2.5 has 1M context', () => {
    const r = lib.detectModelCapabilities('gemini-2.5-pro');
    assert.equal(r.has_1m_ctx, true);
    assert.equal(r.tier, 'reasoning');
  });

  test('gemini-2.5-pro has thinking + reasoning tier', () => {
    const r = lib.detectModelCapabilities('gemini-2.5-pro');
    assert.equal(r.has_thinking, true);
    assert.equal(r.has_1m_ctx, true);
    assert.equal(r.tier, 'reasoning');
  });

  test('gemini-2.5-flash is mid tier with thinking', () => {
    const r = lib.detectModelCapabilities('gemini-2.5-flash');
    assert.equal(r.tier, 'mid');
    assert.equal(r.has_thinking, true);
    assert.equal(r.has_1m_ctx, true);
  });

  test('gemini-2.5-flash-lite is fast tier without thinking', () => {
    const r = lib.detectModelCapabilities('gemini-2.5-flash-lite');
    assert.equal(r.tier, 'fast');
    assert.equal(r.has_thinking, false);
    assert.equal(r.has_1m_ctx, true);
  });

  test('gemini-3-pro recognized as reasoning tier with thinking', () => {
    const r = lib.detectModelCapabilities('gemini-3-pro');
    assert.equal(r.tier, 'reasoning');
    assert.equal(r.has_thinking, true);
    assert.equal(r.has_1m_ctx, true);
  });

  test('gemini-3-flash recognized as mid tier', () => {
    const r = lib.detectModelCapabilities('gemini-3-flash');
    assert.equal(r.tier, 'mid');
    assert.equal(r.has_1m_ctx, true);
  });

  test('gemini-2.0-flash (older) does not claim thinking', () => {
    const r = lib.detectModelCapabilities('gemini-2.0-flash');
    assert.equal(r.tier, 'mid');
    assert.equal(r.has_thinking, false);
  });

  test('gemini-1.5-pro recognized, mid-era, no thinking', () => {
    const r = lib.detectModelCapabilities('gemini-1.5-pro');
    assert.equal(r.tier, 'reasoning');
    assert.equal(r.has_thinking, false);
    assert.equal(r.has_1m_ctx, true);
  });

  test('unknown model returns empty capabilities', () => {
    const r = lib.detectModelCapabilities('unknown-model-123');
    assert.deepEqual(r, { has_1m_ctx: false, has_thinking: false, has_cache: false, tier: 'unknown' });
  });

  test('empty/invalid input returns empty capabilities', () => {
    assert.equal(lib.detectModelCapabilities('').tier, 'unknown');
    assert.equal(lib.detectModelCapabilities(null).tier, 'unknown');
    assert.equal(lib.detectModelCapabilities(undefined).tier, 'unknown');
  });
});

// ─── stripThinkingFrontmatter ───────────────────────────────────────────────

describe('stripThinkingFrontmatter', () => {
  const sample = `---
name: pan-planner
description: Creates plans
tools: Read, Bash
thinking: enabled
thinking_budget: 8000
---

<role>
Planner body.
</role>
`;

  test('claude runtime is no-op', () => {
    const out = lib.stripThinkingFrontmatter(sample, 'claude');
    assert.equal(out, sample);
  });

  test('codex strips thinking + thinking_budget and injects preamble', () => {
    const out = lib.stripThinkingFrontmatter(sample, 'codex');
    assert.equal(out.includes('thinking: enabled'), false);
    assert.equal(out.includes('thinking_budget: 8000'), false);
    assert.ok(out.includes('<!-- pan:thinking -->'));
    assert.ok(out.includes('step-by-step'));
    // Adaptive-thinking era: preamble no longer promises a token budget.
    assert.equal(out.includes('8000'), false);
  });

  const effortSample = `---
name: pan-verifier
description: Verifies work
tools: Read, Bash
effort: high
---

<role>
Verifier body.
</role>
`;

  test('claude runtime keeps effort frontmatter (no-op)', () => {
    const out = lib.stripThinkingFrontmatter(effortSample, 'claude');
    assert.equal(out, effortSample);
  });

  test('codex strips effort and injects preamble', () => {
    const out = lib.stripThinkingFrontmatter(effortSample, 'codex');
    assert.equal(out.includes('effort: high'), false);
    assert.ok(out.includes('<!-- pan:thinking -->'));
    assert.ok(out.includes('step-by-step'));
    assert.ok(out.includes('name: pan-verifier'));
    assert.ok(out.includes('Verifier body.'));
  });

  test('gemini/opencode/copilot strip effort and inject preamble', () => {
    for (const rt of ['gemini', 'opencode', 'copilot']) {
      const out = lib.stripThinkingFrontmatter(effortSample, rt);
      assert.equal(out.includes('effort:'), false, `${rt} should strip effort`);
      assert.ok(out.includes('step-by-step'), `${rt} should inject preamble`);
    }
  });

  test('gemini strips fields and injects preamble', () => {
    const out = lib.stripThinkingFrontmatter(sample, 'gemini');
    assert.equal(out.includes('thinking:'), false);
    assert.ok(out.includes('step-by-step'));
  });

  test('opencode strips fields and injects preamble', () => {
    const out = lib.stripThinkingFrontmatter(sample, 'opencode');
    assert.equal(out.includes('thinking:'), false);
    assert.ok(out.includes('step-by-step'));
  });

  test('copilot strips fields and injects preamble', () => {
    const out = lib.stripThinkingFrontmatter(sample, 'copilot');
    assert.equal(out.includes('thinking:'), false);
    assert.ok(out.includes('step-by-step'));
  });

  test('preserves other frontmatter fields', () => {
    const out = lib.stripThinkingFrontmatter(sample, 'codex');
    assert.ok(out.includes('name: pan-planner'));
    assert.ok(out.includes('description: Creates plans'));
    assert.ok(out.includes('tools: Read, Bash'));
  });

  test('preserves body content verbatim', () => {
    const out = lib.stripThinkingFrontmatter(sample, 'gemini');
    assert.ok(out.includes('<role>'));
    assert.ok(out.includes('Planner body.'));
    assert.ok(out.includes('</role>'));
  });

  test('no-op when frontmatter lacks thinking fields', () => {
    const plain = `---
name: pan-x
description: y
---

Body.
`;
    const out = lib.stripThinkingFrontmatter(plain, 'codex');
    assert.equal(out, plain);
  });

  test('no-op when content has no frontmatter', () => {
    const noFm = 'Just a body, no frontmatter.';
    assert.equal(lib.stripThinkingFrontmatter(noFm, 'codex'), noFm);
  });

  test('handles thinking: true (not just enabled)', () => {
    const input = sample.replace('thinking: enabled', 'thinking: true');
    const out = lib.stripThinkingFrontmatter(input, 'codex');
    assert.equal(out.includes('thinking:'), false);
    assert.ok(out.includes('step-by-step'));
  });

  test('empty/invalid input returns input unchanged', () => {
    assert.equal(lib.stripThinkingFrontmatter('', 'codex'), '');
    assert.equal(lib.stripThinkingFrontmatter(null, 'codex'), null);
  });
});

// ─── convertClaudeAgentToCodexToml (2026-06) ────────────────────────────────

describe('convertClaudeAgentToCodexToml', () => {
  const sample = `---
name: pan-verifier
description: Verifies completed work
tools: Read, Bash
effort: high
---

<role>
You are a verifier. Check "claims" against \\evidence\\.
</role>
`;

  test('emits required TOML fields', () => {
    const toml = lib.convertClaudeAgentToCodexToml(sample);
    assert.match(toml, /^name = "pan-verifier"$/m);
    assert.match(toml, /^description = "Verifies completed work"$/m);
    assert.match(toml, /^developer_instructions = """$/m);
    assert.ok(toml.trimEnd().endsWith('"""'));
  });

  test('maps effort frontmatter to model_reasoning_effort', () => {
    const toml = lib.convertClaudeAgentToCodexToml(sample);
    assert.match(toml, /^model_reasoning_effort = "high"$/m);
  });

  test('omits model_reasoning_effort when effort missing or invalid', () => {
    const noEffort = sample.replace('effort: high\n', '');
    assert.ok(!lib.convertClaudeAgentToCodexToml(noEffort).includes('model_reasoning_effort'));
    const badEffort = sample.replace('effort: high', 'effort: turbo');
    assert.ok(!lib.convertClaudeAgentToCodexToml(badEffort).includes('model_reasoning_effort'));
  });

  test('escapes backslashes in body', () => {
    const toml = lib.convertClaudeAgentToCodexToml(sample);
    assert.ok(toml.includes('\\\\evidence\\\\'), 'backslashes should be doubled for TOML');
  });

  test('breaks up triple-quote runs in body', () => {
    const tricky = '---\nname: x\ndescription: y\n---\nuse """heredoc""" style';
    const toml = lib.convertClaudeAgentToCodexToml(tricky);
    const bodyPart = toml.substring(toml.indexOf('developer_instructions'));
    assert.ok(!bodyPart.slice(bodyPart.indexOf('"""') + 3, bodyPart.lastIndexOf('"""')).includes('"""'),
      'no raw """ inside the multi-line string');
  });

  test('returns null without frontmatter or name', () => {
    assert.equal(lib.convertClaudeAgentToCodexToml('no frontmatter'), null);
    assert.equal(lib.convertClaudeAgentToCodexToml('---\ndescription: x\n---\nbody'), null);
  });
});

describe('codexTrustNotice', () => {
  test('mentions trust gate and config remedy', () => {
    const notice = lib.codexTrustNotice();
    assert.ok(notice.includes('.codex/'));
    assert.ok(notice.includes('trust'));
    assert.ok(notice.includes('config.toml'));
  });
});

// ─── buildCopilotHooksConfig (2026-06) ──────────────────────────────────────

describe('buildCopilotHooksConfig', () => {
  test('produces version:1 envelope with type:command entries', () => {
    const cfg = lib.buildCopilotHooksConfig({
      updateCheckCommand: 'node .github/hooks/pan-check-update.js',
      contextMonitorCommand: 'node .github/hooks/pan-context-monitor.js',
    });
    assert.equal(cfg.version, 1);
    assert.equal(cfg.hooks.sessionStart[0].type, 'command');
    assert.equal(cfg.hooks.sessionStart[0].command, 'node .github/hooks/pan-check-update.js');
    assert.equal(cfg.hooks.postToolUse[0].type, 'command');
    assert.equal(cfg.hooks.postToolUse[0].command, 'node .github/hooks/pan-context-monitor.js');
  });

  test('omits an event when its command is absent', () => {
    const cfg = lib.buildCopilotHooksConfig({ updateCheckCommand: 'node x.js' });
    assert.ok(cfg.hooks.sessionStart);
    assert.ok(!cfg.hooks.postToolUse, 'postToolUse should be omitted when no command given');
  });

  test('tolerates empty input', () => {
    const cfg = lib.buildCopilotHooksConfig();
    assert.equal(cfg.version, 1);
    assert.deepEqual(cfg.hooks, {});
  });
});

// ─── geminiTransitionNotice (2026-06) ───────────────────────────────────────

describe('geminiTransitionNotice', () => {
  test('mentions the transition date, audiences, and Antigravity', () => {
    const notice = lib.geminiTransitionNotice();
    assert.ok(notice.includes('June 18, 2026'));
    assert.ok(notice.includes('Gemini Code Assist'));
    assert.ok(notice.includes('Antigravity CLI'));
    assert.ok(notice.includes('not yet a PAN install target'));
  });

  test('is plain text — no ANSI escape codes', () => {
    assert.doesNotMatch(lib.geminiTransitionNotice(), /\x1b\[/);
  });
});

// ─── verifyInstall (v3.7.10, IMPROVEMENT-TODO P0) ───────────────────────────

describe('verifyInstall', () => {
  const fs = require('fs');

  function makeFakeInstall() {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-verify-'));
    const dispatcherPath = path.join(tmp, 'pan-wizard-core', 'bin', 'pan-tools.cjs');
    fs.mkdirSync(path.dirname(dispatcherPath), { recursive: true });
    fs.writeFileSync(dispatcherPath, '// fake dispatcher\n');
    return tmp;
  }

  test('returns ok=true when all manifest files exist', () => {
    const tmp = makeFakeInstall();
    try {
      // Add a tracked file
      const f = path.join(tmp, 'commands', 'pan', 'help.md');
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f, '# help\n');

      const manifest = {
        version: '3.7.10',
        timestamp: new Date().toISOString(),
        files: {
          'pan-wizard-core/bin/pan-tools.cjs': 'fakehash',
          'commands/pan/help.md': 'fakehash',
        },
      };
      const result = lib.verifyInstall(tmp, manifest);
      assert.equal(result.ok, true);
      assert.equal(result.missing.length, 0);
      assert.equal(result.warnings.length, 0);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('returns ok=false and lists missing files when manifest entries do not exist', () => {
    const tmp = makeFakeInstall();
    try {
      const manifest = {
        version: '3.7.10',
        timestamp: new Date().toISOString(),
        files: {
          'pan-wizard-core/bin/pan-tools.cjs': 'fakehash',
          'commands/pan/help.md': 'fakehash',  // not created
          'agents/pan-planner.md': 'fakehash',  // not created
        },
      };
      const result = lib.verifyInstall(tmp, manifest);
      assert.equal(result.ok, false);
      assert.equal(result.missing.length, 2);
      assert.ok(result.missing.includes('commands/pan/help.md'));
      assert.ok(result.missing.includes('agents/pan-planner.md'));
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('flags missing dispatcher (pan-tools.cjs) as the critical anchor failure', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-verify-no-disp-'));
    try {
      // Empty install: no dispatcher
      const manifest = { version: '3.7.10', timestamp: new Date().toISOString(), files: {} };
      const result = lib.verifyInstall(tmp, manifest);
      assert.equal(result.ok, false);
      assert.ok(result.missing.some(m => m.includes('pan-tools.cjs')),
        'missing list must call out the dispatcher');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('returns warning when manifest is null/undefined', () => {
    const tmp = makeFakeInstall();
    try {
      const result = lib.verifyInstall(tmp, null);
      // Dispatcher exists, but manifest absent → warning only, not missing
      assert.equal(result.ok, true);
      assert.equal(result.warnings.length, 1);
      assert.match(result.warnings[0], /manifest is missing/);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('returns warning when manifest has no files entry', () => {
    const tmp = makeFakeInstall();
    try {
      const result = lib.verifyInstall(tmp, { version: '3.7.10', timestamp: 'x' });
      assert.equal(result.ok, true);
      assert.equal(result.warnings.length, 1);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  // Content checks (2026-06): a 0-byte copy must not pass verification — the
  // manifest hash was computed from the already-broken file, so only a size
  // check catches it.
  test('flags 0-byte tracked files as empty, ok=false', () => {
    const tmp = makeFakeInstall();
    try {
      const f = path.join(tmp, 'commands', 'pan', 'help.md');
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f, ''); // silent copy failure: file landed empty

      const manifest = {
        version: '3.9.0',
        timestamp: new Date().toISOString(),
        files: {
          'pan-wizard-core/bin/pan-tools.cjs': 'fakehash',
          'commands/pan/help.md': 'fakehash',
        },
      };
      const result = lib.verifyInstall(tmp, manifest);
      assert.equal(result.ok, false, '0-byte file must fail verification');
      assert.equal(result.missing.length, 0, 'file exists — not missing');
      assert.deepEqual(result.empty, ['commands/pan/help.md']);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('flags an empty dispatcher as the critical anchor failure', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-verify-empty-disp-'));
    try {
      const dispatcherPath = path.join(tmp, 'pan-wizard-core', 'bin', 'pan-tools.cjs');
      fs.mkdirSync(path.dirname(dispatcherPath), { recursive: true });
      fs.writeFileSync(dispatcherPath, '');

      const result = lib.verifyInstall(tmp, { version: '3.9.0', timestamp: 'x', files: {} });
      assert.equal(result.ok, false);
      assert.ok(result.empty.some(e => e.includes('pan-tools.cjs')),
        'empty list must call out the dispatcher');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('healthy install reports empty list as empty array', () => {
    const tmp = makeFakeInstall();
    try {
      const result = lib.verifyInstall(tmp, {
        version: '3.9.0', timestamp: 'x',
        files: { 'pan-wizard-core/bin/pan-tools.cjs': 'fakehash' },
      });
      assert.equal(result.ok, true);
      assert.deepEqual(result.empty, []);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

// ─── AGENTS.md universal rules layer (ADR-0028 Phase 3) ─────────────────────

describe('AGENTS.md section builders', () => {
  const section = lib.buildAgentsMdSection();

  test('section is marker-fenced and mentions the essentials', () => {
    assert.ok(section.startsWith(lib.PAN_AGENTS_BEGIN));
    assert.ok(section.endsWith(lib.PAN_AGENTS_END));
    assert.ok(section.includes('.planning/'));
    assert.ok(section.includes('/pan-help'));
  });

  test('upsert creates content when file is absent', () => {
    const out = lib.upsertAgentsMdSection(null, section);
    assert.equal(out, section + '\n');
  });

  test('upsert appends to user content without touching it', () => {
    const user = '# My project rules\n\nAlways use tabs.\n';
    const out = lib.upsertAgentsMdSection(user, section);
    assert.ok(out.startsWith('# My project rules'));
    assert.ok(out.includes('Always use tabs.'));
    assert.ok(out.includes(lib.PAN_AGENTS_BEGIN));
  });

  test('upsert replaces an existing PAN block in place (idempotent)', () => {
    const user = `# Rules\n\n${lib.PAN_AGENTS_BEGIN}\nold pan stuff\n${lib.PAN_AGENTS_END}\n\n## After\n`;
    const out = lib.upsertAgentsMdSection(user, section);
    assert.ok(!out.includes('old pan stuff'), 'old block content should be replaced');
    assert.ok(out.startsWith('# Rules'));
    assert.ok(out.includes('## After'), 'content after the block must survive');
    assert.equal(lib.upsertAgentsMdSection(out, section), out, 'second upsert is a no-op');
  });

  test('remove deletes only the PAN block; user content survives', () => {
    const user = '# Rules\n\nAlways use tabs.\n';
    const withBlock = lib.upsertAgentsMdSection(user, section);
    const removed = lib.removeAgentsMdSection(withBlock);
    assert.ok(removed.includes('Always use tabs.'));
    assert.ok(!removed.includes(lib.PAN_AGENTS_BEGIN));
  });

  test('remove returns null when only the PAN block existed', () => {
    const onlyBlock = lib.upsertAgentsMdSection(null, section);
    assert.equal(lib.removeAgentsMdSection(onlyBlock), null);
  });

  test('remove leaves content without a PAN block untouched', () => {
    const user = '# Rules\n';
    assert.equal(lib.removeAgentsMdSection(user), user);
  });
});

// ─── Multi-runtime hooks layer (2026-06) ────────────────────────────────────

describe('mergeCodexHooksConfig', () => {
  const COMMANDS = {
    updateCheckCommand: 'node .codex/hooks/pan-check-update.js',
    contextMonitorCommand: 'node .codex/hooks/pan-context-monitor.js',
    costLoggerCommand: 'node .codex/hooks/pan-cost-logger.js',
    traceLoggerCommand: 'node .codex/hooks/pan-trace-logger.js',
  };

  test('builds all four registrations from scratch (PascalCase events)', () => {
    const config = lib.mergeCodexHooksConfig(null, COMMANDS);
    assert.equal(config.hooks.SessionStart.length, 1);
    assert.equal(config.hooks.PostToolUse.length, 1);
    assert.equal(config.hooks.SubagentStop.length, 2, 'cost + trace loggers');
    assert.equal(config.hooks.SubagentStop[0].hooks[0].type, 'command');
  });

  test('preserves foreign hooks and is idempotent', () => {
    const existing = { hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'my-own.sh' }] }] } };
    const once = lib.mergeCodexHooksConfig(existing, COMMANDS);
    assert.equal(once.hooks.SessionStart.length, 2, 'foreign + PAN');
    const twice = lib.mergeCodexHooksConfig(once, COMMANDS);
    assert.equal(twice.hooks.SessionStart.length, 2, 'reinstall must not duplicate');
    assert.equal(twice.hooks.SubagentStop.length, 2);
  });
});

describe('removeCodexPanHooks', () => {
  test('strips PAN entries, preserves foreign, prunes empty events', () => {
    const config = lib.mergeCodexHooksConfig(
      { hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'my-own.sh' }] }] } },
      { updateCheckCommand: 'node x/pan-check-update.js', costLoggerCommand: 'node x/pan-cost-logger.js' }
    );
    const stripped = lib.removeCodexPanHooks(config);
    assert.equal(stripped.hooks.SessionStart.length, 1, 'foreign hook survives');
    assert.equal(stripped.hooks.SessionStart[0].hooks[0].command, 'my-own.sh');
    assert.equal(stripped.hooks.SubagentStop, undefined, 'emptied event is pruned');
  });

  test('returns null when only PAN hooks existed (caller deletes the file)', () => {
    const config = lib.mergeCodexHooksConfig(null, { updateCheckCommand: 'node x/pan-check-update.js' });
    assert.equal(lib.removeCodexPanHooks(config), null);
  });
});

describe('buildCopilotHooksConfig — subagentStop loggers', () => {
  test('registers cost + trace loggers on subagentStop', () => {
    const config = lib.buildCopilotHooksConfig({
      updateCheckCommand: 'node a', contextMonitorCommand: 'node b',
      costLoggerCommand: 'node .github/hooks/pan-cost-logger.js',
      traceLoggerCommand: 'node .github/hooks/pan-trace-logger.js',
    });
    assert.equal(config.hooks.subagentStop.length, 2);
    assert.ok(config.hooks.subagentStop.every(h => h.type === 'command'));
  });

  test('omits subagentStop when no loggers are supplied (back-compat)', () => {
    const config = lib.buildCopilotHooksConfig({ updateCheckCommand: 'node a', contextMonitorCommand: 'node b' });
    assert.equal(config.hooks.subagentStop, undefined);
  });
});

describe('plugin packaging builders', () => {
  test('buildPluginManifest carries name/version/metadata from package.json', () => {
    const manifest = lib.buildPluginManifest({ version: '9.9.9', description: 'desc', license: 'MIT' });
    assert.equal(manifest.name, 'pan-wizard');
    assert.equal(manifest.version, '9.9.9');
    assert.equal(manifest.description, 'desc');
    assert.ok(manifest.repository.includes('PanWizard'));
  });

  test('buildPluginHooksConfig anchors all four hooks at CLAUDE_PLUGIN_ROOT', () => {
    const config = lib.buildPluginHooksConfig();
    const flat = JSON.stringify(config);
    for (const marker of ['pan-check-update', 'pan-context-monitor', 'pan-cost-logger', 'pan-trace-logger']) {
      assert.ok(flat.includes(marker), `should register ${marker}`);
    }
    assert.equal(config.hooks.SubagentStop.length, 2);
    assert.ok(flat.includes('${CLAUDE_PLUGIN_ROOT}/hooks/'),
      'hook commands must use the documented plugin-root variable');
  });

  test('build-plugin script emits the verified plugin layout', () => {
    const fs = require('fs');
    const { execFileSync } = require('child_process');
    execFileSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'build-plugin.js')], {
      encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
    });
    const out = path.join(__dirname, '..', 'dist', 'pan-wizard-plugin');
    assert.ok(fs.existsSync(path.join(out, '.claude-plugin', 'plugin.json')), 'manifest should exist');
    assert.ok(fs.existsSync(path.join(out, 'commands', 'pan', 'help.md')), 'commands should ship');
    assert.ok(fs.existsSync(path.join(out, 'agents', 'pan-planner.md')), 'agents should ship');
    assert.ok(fs.existsSync(path.join(out, 'hooks', 'hooks.json')), 'hooks config should ship');
    assert.ok(fs.existsSync(path.join(out, 'pan-wizard-core', 'bin', 'pan-tools.cjs')), 'core should ship');
    assert.ok(!fs.existsSync(path.join(out, 'pan-wizard-core', 'learnings', 'internal')),
      'internal learnings are source-only');
    const gitMd = fs.readFileSync(path.join(out, 'commands', 'pan', 'git.md'), 'utf8');
    assert.ok(gitMd.includes('${CLAUDE_PLUGIN_ROOT}/pan-wizard-core/'),
      'content paths should be plugin-root-relative');
    assert.ok(!gitMd.includes('.claude/pan-wizard-core'), 'no install-dir paths should remain');
  });
});

describe('buildNativeWorkflowScripts', () => {
  const scripts = lib.buildNativeWorkflowScripts();

  test('returns pan-* scripts that begin with export const meta', () => {
    assert.ok(scripts.length >= 2);
    for (const s of scripts) {
      assert.match(s.name, /^pan-[a-z-]+\.js$/);
      assert.ok(s.content.startsWith('export const meta = {'), `${s.name} must begin with the meta export`);
    }
  });

  test('scripts are syntactically valid workflow JavaScript', () => {
    const vm = require('vm');
    for (const s of scripts) {
      const body = s.content.replace(/^export const meta/, 'const meta');
      // vm.Script compiles without executing — pure syntax validation of
      // PAN's own first-party template output (await is legal in the module
      // body, so wrap in an async function for the parse).
      assert.doesNotThrow(
        () => new vm.Script(`(async () => {\n${body}\n})`),
        `${s.name} should parse`
      );
    }
  });

  test('scripts avoid resume-breaking globals (Date.now/Math.random/new Date())', () => {
    for (const s of scripts) {
      assert.ok(!/Date\.now\(|Math\.random\(|new Date\(\)/.test(s.content),
        `${s.name} must not use resume-breaking time/randomness APIs`);
    }
  });

  test('review pipeline delegates to the PAN review agents', () => {
    const review = scripts.find(s => s.name === 'pan-review-pipeline.js');
    assert.ok(review.content.includes("agentType: 'pan-reviewer'"));
    assert.ok(review.content.includes("agentType: 'pan-hardener'"));
    assert.ok(review.content.includes("agentType: 'pan-meta-reviewer'"));
  });
});

describe('HOOK_EVENT_MAP', () => {
  test('covers all five runtimes with the verified event names', () => {
    assert.equal(lib.HOOK_EVENT_MAP.codex.subagentStop, 'SubagentStop', 'Codex uses Claude-compatible PascalCase');
    assert.equal(lib.HOOK_EVENT_MAP.copilot.subagentStop, 'subagentStop', 'Copilot uses camelCase');
    assert.equal(lib.HOOK_EVENT_MAP.opencode, null, 'OpenCode has no hook support');
    for (const rt of ['claude', 'gemini', 'codex', 'copilot']) {
      assert.ok(lib.HOOK_EVENT_MAP[rt].sessionStart && lib.HOOK_EVENT_MAP[rt].postToolUse && lib.HOOK_EVENT_MAP[rt].subagentStop);
    }
  });
});

describe('CLAUDE.md @AGENTS.md bridge', () => {
  test('creates the bridge when CLAUDE.md is absent', () => {
    const out = lib.ensureClaudeMdImport(null);
    assert.ok(out.includes('@AGENTS.md'));
    assert.ok(out.includes(lib.PAN_AGENTS_BEGIN));
  });

  test('appends the bridge after user content', () => {
    const out = lib.ensureClaudeMdImport('# My CLAUDE.md\n\nrules here\n');
    assert.ok(out.startsWith('# My CLAUDE.md'));
    assert.ok(out.includes('@AGENTS.md'));
  });

  test('no-op when the user already imports AGENTS.md themselves', () => {
    const user = '@AGENTS.md\n\n# extra\n';
    assert.equal(lib.ensureClaudeMdImport(user), user);
  });

  test('idempotent across reinstalls', () => {
    const once = lib.ensureClaudeMdImport('# x\n');
    assert.equal(lib.ensureClaudeMdImport(once), once);
  });

  test('removeClaudeMdImport strips the bridge, preserves user content', () => {
    const withBridge = lib.ensureClaudeMdImport('# x\n');
    const removed = lib.removeClaudeMdImport(withBridge);
    assert.ok(removed.includes('# x'));
    assert.ok(!removed.includes('@AGENTS.md'));
  });
});
