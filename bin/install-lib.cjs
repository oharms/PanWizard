/**
 * PAN Wizard Installer — Extracted Pure Functions
 *
 * These functions were extracted from bin/install.js to enable independent testing.
 * install.js requires this module and uses these functions directly.
 *
 * All functions in this file are PURE (no fs, no process.env, no side effects)
 * unless explicitly documented otherwise.
 */

const path = require('path');
const os = require('os');

// ─── Constants / Lookup Tables ──────────────────────────────────────────────

/** Color name → hex mapping for OpenCode compatibility */
const colorNameToHex = {
  cyan: '#00FFFF',
  red: '#FF0000',
  green: '#00FF00',
  blue: '#0000FF',
  yellow: '#FFFF00',
  magenta: '#FF00FF',
  orange: '#FFA500',
  purple: '#800080',
  pink: '#FFC0CB',
  white: '#FFFFFF',
  black: '#000000',
  gray: '#808080',
  grey: '#808080',
};

/** Claude → OpenCode tool name mapping */
const claudeToOpencodeTools = {
  AskUserQuestion: 'question',
  SlashCommand: 'skill',
  TodoWrite: 'todowrite',
  WebFetch: 'webfetch',
  WebSearch: 'websearch',
};

/** Claude → Gemini CLI tool name mapping (snake_case) */
const claudeToGeminiTools = {
  Read: 'read_file',
  Write: 'write_file',
  Edit: 'replace',
  Bash: 'run_shell_command',
  Glob: 'glob',
  Grep: 'search_file_content',
  WebSearch: 'google_web_search',
  WebFetch: 'web_fetch',
  TodoWrite: 'write_todos',
  AskUserQuestion: 'ask_user',
};

/** Claude → Copilot CLI tool name mapping */
const claudeToCopilotTools = {
  Read: 'read',
  Write: 'edit',
  Edit: 'edit',
  Bash: 'bash',
  Glob: 'glob',
  Grep: 'search',
  WebSearch: 'web',
  WebFetch: 'web',
  TodoWrite: 'todo',
  AskUserQuestion: null,
  Agent: 'agent',
  Task: 'agent',
};

// ─── Core Utility Functions ─────────────────────────────────────────────────

/** Map runtime name → config directory name */
function getDirName(runtime) {
  if (runtime === 'opencode') return '.opencode';
  if (runtime === 'gemini') return '.gemini';
  if (runtime === 'codex') return '.codex';
  if (runtime === 'copilot') return '.github';
  return '.claude';
}

/**
 * Get config dir path relative to home for hook templating.
 * Returns quoted path segments for path.join() insertion.
 */
function getConfigDirFromHome(runtime, isGlobal) {
  if (!isGlobal) {
    return `'${getDirName(runtime)}'`;
  }
  if (runtime === 'opencode') return "'.config', 'opencode'";
  if (runtime === 'gemini') return "'.gemini'";
  if (runtime === 'codex') return "'.codex'";
  if (runtime === 'copilot') return "'.copilot'";
  return "'.claude'";
}

/** Expand ~ to home directory */
function expandTilde(filePath) {
  if (filePath && filePath.startsWith('~/')) {
    return path.join(os.homedir(), filePath.slice(2));
  }
  return filePath;
}

/** Collapse whitespace to single line */
function toSingleLine(value) {
  return value.replace(/\s+/g, ' ').trim();
}

/** Wrap value in JSON.stringify for YAML safety */
function yamlQuote(value) {
  return JSON.stringify(value);
}

// ─── Frontmatter Extraction ─────────────────────────────────────────────────

/** Split markdown into { frontmatter, body } */
function extractFrontmatterAndBody(content) {
  if (!content.startsWith('---')) {
    return { frontmatter: null, body: content };
  }
  const endIndex = content.indexOf('---', 3);
  if (endIndex === -1) {
    return { frontmatter: null, body: content };
  }
  return {
    frontmatter: content.substring(3, endIndex).trim(),
    body: content.substring(endIndex + 3),
  };
}

/** Extract a field value from YAML frontmatter string */
function extractFrontmatterField(frontmatter, fieldName) {
  const regex = new RegExp(`^${fieldName}:\\s*(.+)$`, 'm');
  const match = frontmatter.match(regex);
  if (!match) return null;
  return match[1].trim().replace(/^['"]|['"]$/g, '');
}

// ─── Tool Name Converters ───────────────────────────────────────────────────

/** Convert Claude tool name → OpenCode format */
function convertToolName(claudeTool) {
  if (claudeToOpencodeTools[claudeTool]) {
    return claudeToOpencodeTools[claudeTool];
  }
  if (claudeTool.startsWith('mcp__')) {
    return claudeTool;
  }
  return claudeTool.toLowerCase();
}

/**
 * Convert Claude tool name → Gemini CLI format.
 * Returns null for tools that should be excluded (MCP, Task).
 */
function convertGeminiToolName(claudeTool) {
  if (claudeTool.startsWith('mcp__')) return null;
  if (claudeTool === 'Task') return null;
  if (claudeToGeminiTools[claudeTool]) {
    return claudeToGeminiTools[claudeTool];
  }
  return claudeTool.toLowerCase();
}

/**
 * Convert Claude tool name → Copilot CLI format.
 * Returns null for tools that should be excluded (AskUserQuestion).
 */
function convertCopilotToolName(claudeTool) {
  if (claudeTool.startsWith('mcp__')) return claudeTool;
  if (claudeTool in claudeToCopilotTools) {
    return claudeToCopilotTools[claudeTool];
  }
  return claudeTool.toLowerCase();
}

// ─── Slash Command Converters ───────────────────────────────────────────────

/** /pan:command → $pan-command (Codex format) */
function convertSlashCommandsToCodexSkillMentions(content) {
  let converted = content.replace(/\/pan:([a-z0-9-]+)/gi, (_, commandName) => {
    return `$pan-${String(commandName).toLowerCase()}`;
  });
  converted = converted.replace(/\/pan-help\b/g, '$pan-help');
  return converted;
}

/** Claude markdown → Codex markdown (slash commands + $ARGUMENTS) */
function convertClaudeToCodexMarkdown(content) {
  let converted = convertSlashCommandsToCodexSkillMentions(content);
  converted = converted.replace(/\$ARGUMENTS\b/g, '{{PAN_ARGS}}');
  return converted;
}

/** /pan:command and $pan-command → /pan-command (Copilot format) */
function convertSlashCommandsToCopilotSkillMentions(content) {
  let converted = content.replace(/\/pan:([a-z0-9-]+)/gi, (_, commandName) => {
    return `/pan-${String(commandName).toLowerCase()}`;
  });
  converted = converted.replace(/\$pan-([a-z0-9-]+)/gi, (_, commandName) => {
    return `/pan-${String(commandName).toLowerCase()}`;
  });
  return converted;
}

// ─── Content Converters ─────────────────────────────────────────────────────

/** Rewrite AskUserQuestion blocks for Copilot CLI (numbered menus) */
function rewriteAskUserQuestionForCopilot(content) {
  let result = content;
  const blockRe = /(?:Use\s+)?AskUserQuestion(?:\s*\(multiSelect:\s*true\))?:\s*\n-\s*header:\s*"[^"]*"\s*\n-\s*question:\s*"([^"]*)"\s*\n-\s*options:\s*\n((?:\s+-\s+"[^"]*"(?:\s*—[^\n]*)?\n?)+)/g;

  result = result.replace(blockRe, (match, question, optionsBlock) => {
    const isMultiSelect = match.includes('multiSelect');
    const optionLines = optionsBlock.match(/^\s+-\s+"([^"]*)"(?:\s*—\s*(.*))?$/gm) || [];
    const numbered = optionLines.map((line, i) => {
      const optMatch = line.match(/^\s+-\s+"([^"]*)"(?:\s*—\s*(.*))?$/);
      if (!optMatch) return `${i + 1}. ${line.trim()}`;
      const label = optMatch[1];
      const desc = optMatch[2] ? optMatch[2].trim() : '';
      return desc ? `${i + 1}. **${label}** — ${desc}` : `${i + 1}. **${label}**`;
    });
    const selectInstruction = isMultiSelect
      ? 'Type the numbers you want, separated by commas (e.g., 1,3). Or type your own answer.'
      : 'Type a number or label to choose. Or type your own answer.';
    const prefix = isMultiSelect ? 'Ask the user (select one or more)' : 'Ask the user';
    return `${prefix}:\n\n**${question}**\n\n${numbered.join('\n')}\n\n${selectInstruction}\nWait for the user's response before continuing.\n`;
  });

  result = result.replace(/\bUse AskUserQuestion\b(?!\s*[:(])/g, 'Ask the user with numbered options');
  result = result.replace(/\buse AskUserQuestion\b(?!\s*[:(])/g, 'ask the user with numbered options');
  result = result.replace(/\bAskUserQuestion\b/g, 'ask_user');
  return result;
}

/** Claude markdown → Copilot markdown (slash commands + Task + AskUserQuestion) */
function convertClaudeToCopilotMarkdown(content) {
  let converted = convertSlashCommandsToCopilotSkillMentions(content);
  converted = converted.replace(/Task\s*\(\s*subagent_type\s*=\s*["']([^"']+)["']\s*\)/g, (_, agentName) => {
    return `/agent ${agentName}`;
  });
  converted = converted.replace(/Agent\s*\(\s*subagent_type\s*=\s*["']([^"']+)["']\s*\)/g, (_, agentName) => {
    return `/agent ${agentName}`;
  });
  converted = rewriteAskUserQuestionForCopilot(converted);
  return converted;
}

/** Strip <sub>text</sub> → *(text)* for terminal output */
function stripSubTags(content) {
  return content.replace(/<sub>(.*?)<\/sub>/g, '*($1)*');
}

/** Claude agent → Gemini agent (frontmatter + tool conversion + ${VAR} escaping) */
function convertClaudeToGeminiAgent(content) {
  if (!content.startsWith('---')) return content;
  const endIndex = content.indexOf('---', 3);
  if (endIndex === -1) return content;

  const frontmatter = content.substring(3, endIndex).trim();
  const body = content.substring(endIndex + 3);
  const lines = frontmatter.split('\n');
  const newLines = [];
  let inAllowedTools = false;
  const tools = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('allowed-tools:')) { inAllowedTools = true; continue; }
    if (trimmed.startsWith('tools:')) {
      const toolsValue = trimmed.substring(6).trim();
      if (toolsValue) {
        const parsed = toolsValue.split(',').map(t => t.trim()).filter(t => t);
        for (const t of parsed) {
          const mapped = convertGeminiToolName(t);
          if (mapped) tools.push(mapped);
        }
      } else {
        inAllowedTools = true;
      }
      continue;
    }
    if (trimmed.startsWith('color:')) continue;
    // `model:` pins a Claude Code subagent to a specific model (e.g. opus for
    // security agents, off Fable's cyber classifier). Claude-only — strip it
    // for Gemini so it can't leak into a runtime that reads `model` differently.
    if (trimmed.startsWith('model:')) continue;
    if (inAllowedTools) {
      if (trimmed.startsWith('- ')) {
        const mapped = convertGeminiToolName(trimmed.substring(2).trim());
        if (mapped) tools.push(mapped);
        continue;
      } else if (trimmed && !trimmed.startsWith('-')) {
        inAllowedTools = false;
      }
    }
    if (!inAllowedTools) newLines.push(line);
  }

  if (tools.length > 0) {
    newLines.push('tools:');
    for (const tool of tools) newLines.push(`  - ${tool}`);
  }

  const newFrontmatter = newLines.join('\n').trim();
  const escapedBody = body.replace(/\$\{(\w+)\}/g, '$$$1');
  return `---\n${newFrontmatter}\n---${stripSubTags(escapedBody)}`;
}

/** Claude frontmatter → OpenCode frontmatter (tool names + paths + colors) */
function convertClaudeToOpencodeFrontmatter(content) {
  let convertedContent = content;
  convertedContent = convertedContent.replace(/\bAskUserQuestion\b/g, 'question');
  convertedContent = convertedContent.replace(/\bSlashCommand\b/g, 'skill');
  convertedContent = convertedContent.replace(/\bTodoWrite\b/g, 'todowrite');
  convertedContent = convertedContent.replace(/\/pan:/g, '/pan-');
  convertedContent = convertedContent.replace(/~\/\.claude\b/g, '~/.config/opencode');
  convertedContent = convertedContent.replace(/subagent_type="general-purpose"/g, 'subagent_type="general"');

  if (!convertedContent.startsWith('---')) return convertedContent;
  const endIndex = convertedContent.indexOf('---', 3);
  if (endIndex === -1) return convertedContent;

  const frontmatter = convertedContent.substring(3, endIndex).trim();
  const body = convertedContent.substring(endIndex + 3);
  const lines = frontmatter.split('\n');
  const newLines = [];
  let inAllowedTools = false;
  const allowedTools = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('allowed-tools:')) { inAllowedTools = true; continue; }
    if (trimmed.startsWith('tools:')) {
      const toolsValue = trimmed.substring(6).trim();
      if (toolsValue) {
        const parsed = toolsValue.split(',').map(t => t.trim()).filter(t => t);
        allowedTools.push(...parsed);
      }
      continue;
    }
    if (trimmed.startsWith('name:')) continue;
    // `model:` is a Claude-only subagent pin (e.g. opus for security agents,
    // off Fable's cyber classifier). Strip it here — OpenCode's own `model`
    // field expects a `provider/model` id and would choke on `opus`.
    if (trimmed.startsWith('model:')) continue;
    if (trimmed.startsWith('color:')) {
      const colorValue = trimmed.substring(6).trim().toLowerCase();
      const hexColor = colorNameToHex[colorValue];
      if (hexColor) {
        newLines.push(`color: "${hexColor}"`);
      } else if (colorValue.startsWith('#') && /^#[0-9a-f]{3}$|^#[0-9a-f]{6}$/i.test(colorValue)) {
        newLines.push(line);
      }
      continue;
    }
    if (inAllowedTools) {
      if (trimmed.startsWith('- ')) {
        allowedTools.push(trimmed.substring(2).trim());
        continue;
      } else if (trimmed && !trimmed.startsWith('-')) {
        inAllowedTools = false;
      }
    }
    if (!inAllowedTools) newLines.push(line);
  }

  if (allowedTools.length > 0) {
    // OpenCode 2026 agent frontmatter: `permission` (allow/ask/deny) replaced
    // the deprecated `tools: {name: true}` map.
    newLines.push('permission:');
    for (const tool of allowedTools) {
      newLines.push(`  ${convertToolName(tool)}: allow`);
    }
  }

  const newFrontmatter = newLines.join('\n').trim();
  return `---\n${newFrontmatter}\n---${body}`;
}

/** Claude markdown → Gemini TOML */
function convertClaudeToGeminiToml(content) {
  if (!content.startsWith('---')) {
    return `prompt = ${JSON.stringify(content)}\n`;
  }
  const endIndex = content.indexOf('---', 3);
  if (endIndex === -1) {
    return `prompt = ${JSON.stringify(content)}\n`;
  }

  const frontmatter = content.substring(3, endIndex).trim();
  const body = content.substring(endIndex + 3).trim();
  let description = '';
  const lines = frontmatter.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('description:')) {
      description = trimmed.substring(12).trim();
      break;
    }
  }

  let toml = '';
  if (description) toml += `description = ${JSON.stringify(description)}\n`;
  toml += `prompt = ${JSON.stringify(body)}\n`;
  return toml;
}

// ─── Skill/Agent Builders ───────────────────────────────────────────────────

/** Generate Codex skill adapter header */
function getCodexSkillAdapterHeader(skillName) {
  const invocation = `$${skillName}`;
  return `<codex_skill_adapter>
Codex skills-first mode:
- This skill is invoked by mentioning \`${invocation}\`.
- Treat all user text after \`${invocation}\` as \`{{PAN_ARGS}}\`.
- If no arguments are present, treat \`{{PAN_ARGS}}\` as empty.

Legacy orchestration compatibility:
- Any \`Task(...)\` pattern in referenced workflow docs is legacy syntax.
- Implement equivalent behavior with Codex collaboration tools: \`spawn_agent\`, \`wait\`, \`send_input\`, and \`close_agent\`.
- Treat legacy \`subagent_type\` names as role hints in the spawned message.
</codex_skill_adapter>`;
}

/** Claude command → Codex SKILL.md */
function convertClaudeCommandToCodexSkill(content, skillName) {
  const converted = convertClaudeToCodexMarkdown(content);
  const { frontmatter, body } = extractFrontmatterAndBody(converted);
  let description = `Run PAN workflow ${skillName}.`;
  if (frontmatter) {
    const maybeDescription = extractFrontmatterField(frontmatter, 'description');
    if (maybeDescription) description = maybeDescription;
  }
  description = toSingleLine(description);
  const shortDescription = description.length > 180 ? `${description.slice(0, 177)}...` : description;
  const adapter = getCodexSkillAdapterHeader(skillName);
  return `---\nname: ${yamlQuote(skillName)}\ndescription: ${yamlQuote(description)}\nmetadata:\n  short-description: ${yamlQuote(shortDescription)}\n---\n\n${adapter}\n\n${body.trimStart()}`;
}

/**
 * Generate the runtime-neutral skill adapter header (ADR-0028 Phase 1).
 *
 * Unlike the Codex/Copilot adapters, this header makes no assumptions about
 * the consuming runtime — the same SKILL.md in the shared `.agents/skills/`
 * tree is read by every runtime, so invocation, delegation, and interaction
 * guidance are phrased in terms of "your runtime's native mechanism".
 */
function getUnifiedSkillAdapterHeader(skillName) {
  return `<pan_skill_adapter>
PAN unified skill (Agent Skills standard, shared .agents/skills/ tree):
- This skill is invoked through your runtime's skill mechanism — slash command (\`/${skillName}\`), mention (\`$${skillName}\`), or skill picker.
- Treat all user text after the invocation as \`{{PAN_ARGS}}\`. If none is present, treat \`{{PAN_ARGS}}\` as empty.
- References like \`/pan-<name>\` in this document denote other PAN skills — invoke them with your runtime's own skill syntax.

Sub-agent orchestration:
- Any \`Task(...)\` pattern in referenced workflow docs is legacy syntax.
- Delegate with your runtime's native mechanism (Claude Code \`Task\` tool, Codex \`spawn_agent\`, Copilot CLI \`/agent\`, OpenCode agents, Gemini sub-agents).
- Treat legacy \`subagent_type\` names as the role of the sub-agent to invoke.

User interaction (runtimes without a native question tool):
- Ask one question at a time; show numbered options; mark the recommended option with **(recommended)**.
- Accept numbers ("1"), labels, or free-text descriptions as valid answers.
- Native interaction tools (e.g. AskUserQuestion blocks), where supported by your runtime, take precedence over this fallback.
</pan_skill_adapter>`;
}

/** Claude command → runtime-neutral SKILL.md (ADR-0028 Phase 1) */
function convertClaudeCommandToUnifiedSkill(content, skillName) {
  // Normalize command mentions to the readable /pan-<name> form; the adapter
  // header tells each runtime to map that onto its own invocation syntax.
  let converted = convertSlashCommandsToCopilotSkillMentions(content);
  converted = converted.replace(/\$ARGUMENTS\b/g, '{{PAN_ARGS}}');
  const { frontmatter, body } = extractFrontmatterAndBody(converted);
  let description = `Run PAN workflow ${skillName}.`;
  if (frontmatter) {
    const maybeDescription = extractFrontmatterField(frontmatter, 'description');
    if (maybeDescription) description = maybeDescription;
  }
  description = toSingleLine(description);
  const shortDescription = description.length > 180 ? `${description.slice(0, 177)}...` : description;
  const adapter = getUnifiedSkillAdapterHeader(skillName);
  return `---\nname: ${yamlQuote(skillName)}\ndescription: ${yamlQuote(description)}\nmetadata:\n  short-description: ${yamlQuote(shortDescription)}\n---\n\n${adapter}\n\n${body.trimStart()}`;
}

/** Generate Copilot CLI skill adapter header */
function getCopilotSkillAdapterHeader(skillName) {
  const invocation = `/pan-${skillName.replace(/^pan-/, '')}`;
  return `<copilot_skill_adapter>
Copilot CLI skill integration:
- This skill is invoked via \`${invocation}\`.
- Treat all user text after \`${invocation}\` as arguments.
- If no arguments are present, proceed with defaults.

Agent orchestration:
- Any \`Task(...)\` pattern in referenced workflow docs is legacy syntax.
- Use Copilot CLI's native \`/agent\` command to delegate to sub-agents.
- Treat legacy \`subagent_type\` names as the agent to invoke.

User interaction:
- When presenting choices to the user, use numbered lists (1. **Option** — description).
- For single-select questions: ask one question, show numbered options, then say "Type a number or label to choose. Or type your own answer."
- For multi-select questions: show numbered options, then say "Type the numbers you want, separated by commas (e.g., 1,3). Or type your own answer."
- Always ask one question at a time. Wait for the user's response before continuing.
- Accept numbers ("1"), labels ("Option A"), or free-text descriptions as valid answers.
- Mark the recommended option with **(recommended)** in bold.
</copilot_skill_adapter>`;
}

/** Claude command → Copilot SKILL.md */
function convertClaudeCommandToCopilotSkill(content, skillName) {
  const converted = convertClaudeToCopilotMarkdown(content);
  const { frontmatter, body } = extractFrontmatterAndBody(converted);
  let description = `Run PAN workflow ${skillName}.`;
  if (frontmatter) {
    const maybeDescription = extractFrontmatterField(frontmatter, 'description');
    if (maybeDescription) description = maybeDescription;
  }
  description = toSingleLine(description);
  const shortDescription = description.length > 180 ? `${description.slice(0, 177)}...` : description;
  const adapter = getCopilotSkillAdapterHeader(skillName);
  return `---\nname: ${yamlQuote(skillName)}\ndescription: ${yamlQuote(description)}\nmetadata:\n  short-description: ${yamlQuote(shortDescription)}\n---\n\n${adapter}\n\n${body.trimStart()}`;
}

/** Claude agent → Copilot .agent.md */
function convertClaudeToCopilotAgent(content) {
  const converted = convertClaudeToCopilotMarkdown(content);
  const { frontmatter, body } = extractFrontmatterAndBody(converted);
  let name = '';
  let description = '';
  const copilotTools = [];

  if (frontmatter) {
    name = extractFrontmatterField(frontmatter, 'name') || '';
    description = extractFrontmatterField(frontmatter, 'description') || '';
    const toolsMatch = frontmatter.match(/allowed_tools:\s*\n((?:\s*-\s*.+\n?)*)/);
    if (toolsMatch) {
      const toolLines = toolsMatch[1].match(/^\s*-\s*(.+)$/gm) || [];
      for (const line of toolLines) {
        const toolName = line.replace(/^\s*-\s*/, '').trim();
        const copilotTool = convertCopilotToolName(toolName);
        if (copilotTool && !copilotTools.includes(copilotTool)) {
          copilotTools.push(copilotTool);
        }
      }
    }
  }

  const toolsYaml = copilotTools.length > 0
    ? `\ntools:\n${copilotTools.map(t => `  - ${yamlQuote(t)}`).join('\n')}`
    : '';
  return `---\nname: ${yamlQuote(name)}\ndescription: ${yamlQuote(description)}${toolsYaml}\n---\n${body}`;
}

// ─── Attribution Processing ─────────────────────────────────────────────────

/**
 * Process Co-Authored-By lines based on attribution setting.
 * @param {string} content - File content
 * @param {null|undefined|string} attribution - null=remove, undefined=keep, string=replace
 */
function processAttribution(content, attribution) {
  if (attribution === null) {
    return content.replace(/(\r?\n){2}Co-Authored-By:.*$/gim, '');
  }
  if (attribution === undefined) return content;
  const safeAttribution = attribution.replace(/\$/g, '$$$$');
  return content.replace(/Co-Authored-By:.*$/gim, `Co-Authored-By: ${safeAttribution}`);
}

// ─── JSONC Parser ───────────────────────────────────────────────────────────

/** Parse JSON with comments (JSONC). Strips single-line and block comments, trailing commas. */
function parseJsonc(content) {
  if (content.charCodeAt(0) === 0xFEFF) {
    content = content.slice(1);
  }

  let result = '';
  let inString = false;
  let i = 0;
  while (i < content.length) {
    const char = content[i];
    const next = content[i + 1];

    if (inString) {
      result += char;
      if (char === '\\' && i + 1 < content.length) {
        result += next;
        i += 2;
        continue;
      }
      if (char === '"') inString = false;
      i++;
    } else {
      if (char === '"') {
        inString = true;
        result += char;
        i++;
      } else if (char === '/' && next === '/') {
        while (i < content.length && content[i] !== '\n') i++;
      } else if (char === '/' && next === '*') {
        i += 2;
        while (i < content.length - 1 && !(content[i] === '*' && content[i + 1] === '/')) i++;
        i += 2;
      } else {
        result += char;
        i++;
      }
    }
  }

  result = result.replace(/,(\s*[}\]])/g, '$1');
  return JSON.parse(result);
}

// ─── Build Hook Command ─────────────────────────────────────────────────────

/** Build a hook command path with forward slashes for cross-platform compat */
function buildHookCommand(configDir, hookName) {
  const hooksPath = configDir.replace(/\\/g, '/') + '/hooks/' + hookName;
  return `node "${hooksPath}"`;
}

// ─── Opus 4.7 Skills & Thinking ────────────────────────────────────────────

/**
 * Build a Claude Code native skill shim for a PAN command.
 *
 * Claude Code 1.x discovers skills in `.claude/skills/` by frontmatter.
 * PAN's commands live in `.claude/commands/pan/`, so we write a small shim
 * that registers the command as a skill pointing back at the command file.
 *
 * @param {Object} opts
 * @param {string} opts.commandName - e.g. "focus-scan"
 * @param {string} opts.description - Human-readable one-liner (≤120 chars preferred)
 * @param {string} [opts.trigger] - Optional trigger guidance for auto-invocation
 * @returns {string} Skill markdown content
 */
function buildClaudeSkillShim(opts) {
  if (!opts || typeof opts.commandName !== 'string' || !opts.commandName.trim()) {
    throw new Error('buildClaudeSkillShim: commandName is required');
  }
  const name = opts.commandName.trim();
  const description = (opts.description || '').replace(/\s+/g, ' ').trim();
  const trigger = (opts.trigger || '').replace(/\s+/g, ' ').trim();

  const frontmatter = [
    '---',
    `name: pan-${name}`,
    `description: ${yamlQuote(description)}`,
    trigger ? `trigger: ${yamlQuote(trigger)}` : null,
    'source: pan-wizard',
    '---',
  ].filter(Boolean).join('\n');

  const body = [
    '',
    `# /pan:${name}`,
    '',
    description || `PAN command: ${name}`,
    '',
    `Invokes the command defined at \`.claude/commands/pan/${name}.md\`.`,
    '',
    `To use, run: \`/pan:${name}\``,
    '',
  ].join('\n');

  return frontmatter + body;
}

/**
 * Translate a reasoning-depth directive from the generic PAN frontmatter
 * shape into runtime-specific syntax (or prose fallback).
 *
 * Current shape (2026-06, adaptive-thinking era): PAN agents declare
 * `effort: low|medium|high|xhigh|max` in frontmatter. Claude Code consumes
 * `effort` natively — adaptive thinking replaced fixed thinking budgets,
 * and `thinking_budget`-style controls were removed from the API on
 * Opus 4.7+ models. Runtimes without a native effort field get a prose
 * preamble that coaches the model to think before tool calls.
 *
 * Legacy shape `{enabled: boolean, budget: number}` (from the retired
 * `thinking:` / `thinking_budget:` fields) is still accepted; budgets map
 * to effort levels (≤4000 → medium, ≤6000 → high, >6000 → xhigh).
 *
 * @param {string} runtime - 'claude'|'codex'|'gemini'|'opencode'|'copilot'
 * @param {Object} directive - {effort: string} or legacy {enabled, budget}
 * @returns {{frontmatter: Object, preamble: string}} Translated directive.
 *   `frontmatter` = fields to add to the agent's YAML header.
 *   `preamble` = prose to inject at top of agent prompt.
 */
const EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'];

function effortFromLegacyBudget(budget) {
  const b = Number(budget) > 0 ? Number(budget) : 2000;
  if (b <= 4000) return 'medium';
  if (b <= 6000) return 'high';
  return 'xhigh';
}

function translateThinkingDirective(runtime, directive) {
  const result = { frontmatter: {}, preamble: '' };
  if (!directive) return result;

  let effort = null;
  const rawEffort = typeof directive.effort === 'string' ? directive.effort.toLowerCase().trim() : '';
  if (EFFORT_LEVELS.includes(rawEffort)) {
    effort = rawEffort;
  } else if (directive.enabled) {
    effort = effortFromLegacyBudget(directive.budget);
  }
  if (!effort) return result;

  switch (runtime) {
    case 'claude':
      // Claude Code consumes `effort` natively (adaptive thinking is the default).
      result.frontmatter = { effort };
      return result;
    case 'codex':
    case 'opencode':
    case 'gemini':
    case 'copilot':
    default: {
      // Prose fallback — host runtime has no native effort field.
      const depth = effort === 'low'
        ? 'Keep reasoning brief and focused on the immediate task.'
        : effort === 'medium'
          ? 'Reason about edge cases, hidden dependencies, and likely failure modes.'
          : 'Be thorough: reason about edge cases, hidden dependencies, and likely failure modes, preferring deeper analysis over speed.';
      result.preamble = `Think through the problem step-by-step before taking any action. ${depth} Only after that, call tools or write output.`;
      return result;
    }
  }
}

/**
 * Strip reasoning-depth frontmatter (`effort`, plus the legacy `thinking` /
 * `thinking_budget` pair) from an agent markdown file for runtimes that
 * don't support those fields natively. When a directive was present,
 * inject a prose preamble at the top of the body instead.
 *
 * Claude runtime is a no-op — `effort` stays in frontmatter so Claude Code
 * consumes it natively.
 *
 * @param {string} content - Full agent .md content
 * @param {string} runtime - 'claude'|'codex'|'gemini'|'opencode'|'copilot'
 * @returns {string} Possibly-rewritten content
 */
function stripThinkingFrontmatter(content, runtime) {
  if (runtime === 'claude') return content;
  if (typeof content !== 'string' || !content) return content;

  const { frontmatter, body } = extractFrontmatterAndBody(content);
  if (!frontmatter) return content;

  const thinkingValue = extractFrontmatterField(frontmatter, 'thinking');
  const budgetValue = extractFrontmatterField(frontmatter, 'thinking_budget');
  const effortValue = extractFrontmatterField(frontmatter, 'effort');
  if (!thinkingValue && !budgetValue && !effortValue) return content;

  // Remove the fields (match on their own lines only).
  let fmBody = frontmatter
    .replace(/^thinking:\s*[^\n]*\n?/gm, '')
    .replace(/^thinking_budget:\s*[^\n]*\n?/gm, '')
    .replace(/^effort:\s*[^\n]*\n?/gm, '');

  const rebuilt = `---\n${fmBody.replace(/^---\n|\n---$/g, '')}\n---`;
  let out = rebuilt.replace(/\n\n+/g, '\n\n') + '\n\n';

  // Build the directive: `effort` wins; legacy thinking/budget falls back.
  const enabled = String(thinkingValue || '').toLowerCase().trim() === 'enabled'
    || String(thinkingValue || '').toLowerCase().trim() === 'true';
  const directive = effortValue
    ? { effort: String(effortValue) }
    : (enabled ? { enabled: true, budget: Number(budgetValue) || 2000 } : null);
  if (directive) {
    const { preamble } = translateThinkingDirective(runtime, directive);
    if (preamble) {
      out += `<!-- pan:thinking -->\n${preamble}\n<!-- /pan:thinking -->\n\n`;
    }
  }

  out += body.replace(/^\n+/, '');
  return out;
}

// ─── Copilot CLI hooks config (2026-06) ─────────────────────────────────────

/**
 * Build a Copilot CLI hooks config object for `.github/hooks/pan.json`.
 *
 * Copilot CLI reads hook configuration from `.github/hooks/*.json` (repo) with
 * a `version: 1` envelope and per-event arrays of `{type, command, ...}`
 * entries — NOT from `config.json`. A command hook supplies one of `bash`,
 * `powershell`, or `command` (cross-platform fallback). PAN's hooks are
 * Node.js scripts invoked via `node …`, so the cross-platform `command` key
 * is the correct fit on every OS. Verified against
 * docs.github.com/en/copilot/reference/hooks-configuration (2026-06).
 *
 * Pure function so the generated config is unit-testable.
 *
 * @param {Object} commands
 * @param {string} commands.updateCheckCommand   - node invocation for pan-check-update.js
 * @param {string} commands.contextMonitorCommand - node invocation for pan-context-monitor.js
 * @returns {Object} A `.github/hooks/pan.json` config object
 */
function buildCopilotHooksConfig(commands) {
  const { updateCheckCommand, contextMonitorCommand, costLoggerCommand, traceLoggerCommand } = commands || {};
  const config = { version: 1, hooks: {} };
  if (updateCheckCommand) {
    config.hooks.sessionStart = [{ type: 'command', command: updateCheckCommand }];
  }
  if (contextMonitorCommand) {
    config.hooks.postToolUse = [{ type: 'command', command: contextMonitorCommand }];
  }
  // subagentStop is Copilot's SubagentStop equivalent (verified docs.github.com
  // 2026-06) — carries the cost + trace loggers, same as Claude/Gemini.
  const subagentStop = [];
  if (costLoggerCommand) subagentStop.push({ type: 'command', command: costLoggerCommand });
  if (traceLoggerCommand) subagentStop.push({ type: 'command', command: traceLoggerCommand });
  if (subagentStop.length > 0) {
    config.hooks.subagentStop = subagentStop;
  }
  return config;
}

// ─── Codex hooks config (2026-06) ───────────────────────────────────────────

/**
 * Cross-runtime hook event map (canonical PAN event → per-runtime name).
 * Claude/Gemini register in settings.json; Codex in `.codex/hooks.json`
 * (Claude-compatible PascalCase events — verified developers.openai.com
 * 2026-06, project-scoped hooks load once the project is trusted); Copilot
 * in `.github/hooks/pan.json` (camelCase — verified docs.github.com 2026-06).
 * OpenCode has no hook support.
 */
const HOOK_EVENT_MAP = Object.freeze({
  claude: { surface: 'settings.json', sessionStart: 'SessionStart', postToolUse: 'PostToolUse', subagentStop: 'SubagentStop' },
  gemini: { surface: 'settings.json', sessionStart: 'SessionStart', postToolUse: 'PostToolUse', subagentStop: 'SubagentStop' },
  codex: { surface: 'hooks.json', sessionStart: 'SessionStart', postToolUse: 'PostToolUse', subagentStop: 'SubagentStop' },
  copilot: { surface: 'hooks/pan.json', sessionStart: 'sessionStart', postToolUse: 'postToolUse', subagentStop: 'subagentStop' },
  opencode: null,
});

/**
 * Merge PAN hook registrations into a `.codex/hooks.json` config.
 *
 * Codex hooks use the Claude-style shape — `{hooks: {EventName: [{matcher?,
 * hooks: [{type: 'command', command}]}]}}` with PascalCase event names —
 * and `.codex/hooks.json` is a single shared file, so PAN entries are merged
 * non-destructively: existing non-PAN entries are preserved, and PAN entries
 * are deduplicated by their pan-* command substring (idempotent reinstall).
 *
 * @param {object|null} existing - Parsed existing hooks.json content, or null
 * @param {Object} commands - node invocations keyed like buildCopilotHooksConfig
 * @returns {object} Merged config object to serialize back to hooks.json
 */
function mergeCodexHooksConfig(existing, commands) {
  const { updateCheckCommand, contextMonitorCommand, costLoggerCommand, traceLoggerCommand } = commands || {};
  const config = (existing && typeof existing === 'object') ? existing : {};
  if (!config.hooks || typeof config.hooks !== 'object') config.hooks = {};

  const wanted = [
    ['SessionStart', updateCheckCommand, 'pan-check-update'],
    ['PostToolUse', contextMonitorCommand, 'pan-context-monitor'],
    ['SubagentStop', costLoggerCommand, 'pan-cost-logger'],
    ['SubagentStop', traceLoggerCommand, 'pan-trace-logger'],
  ];

  for (const [event, command, marker] of wanted) {
    if (!command) continue;
    if (!Array.isArray(config.hooks[event])) config.hooks[event] = [];
    const present = config.hooks[event].some(group =>
      Array.isArray(group.hooks) && group.hooks.some(h => h.command && h.command.includes(marker)));
    if (!present) {
      config.hooks[event].push({ hooks: [{ type: 'command', command }] });
    }
  }
  return config;
}

/**
 * Remove PAN hook registrations from a `.codex/hooks.json` config.
 * @param {object|null} existing - Parsed existing hooks.json content
 * @returns {object|null} Config without PAN entries, or null when nothing
 *   meaningful remains (caller should delete the file).
 */
function removeCodexPanHooks(existing) {
  if (!existing || typeof existing !== 'object' || !existing.hooks) return existing || null;
  for (const event of Object.keys(existing.hooks)) {
    if (!Array.isArray(existing.hooks[event])) continue;
    existing.hooks[event] = existing.hooks[event].filter(group =>
      !(Array.isArray(group.hooks) && group.hooks.some(h => h.command && /pan-(check-update|context-monitor|cost-logger|trace-logger)/.test(h.command))));
    if (existing.hooks[event].length === 0) delete existing.hooks[event];
  }
  if (Object.keys(existing.hooks).length === 0) delete existing.hooks;
  return Object.keys(existing).length === 0 ? null : existing;
}

// ─── Codex agents (TOML) + trust notice (2026-06) ───────────────────────────

/**
 * Convert a Claude agent markdown file into a Codex custom-agent TOML file.
 *
 * Codex custom agents are standalone TOML files in `.codex/agents/` (project)
 * or `~/.codex/agents/` (personal). Required fields: name, description,
 * developer_instructions. PAN's `effort` frontmatter maps to Codex's
 * `model_reasoning_effort`. Model/tier is left to inherit from the parent
 * session (PAN tiers don't map to OpenAI model ids).
 * Verified against developers.openai.com/codex/subagents (2026-06).
 *
 * @param {string} content - Full Claude agent .md content
 * @returns {string|null} TOML string, or null when content has no frontmatter
 */
function convertClaudeAgentToCodexToml(content) {
  if (typeof content !== 'string' || !content.startsWith('---')) return null;
  const endIndex = content.indexOf('---', 3);
  if (endIndex === -1) return null;

  const frontmatter = content.substring(3, endIndex);
  const body = content.substring(endIndex + 3).replace(/^\n+/, '');

  const field = (key) => {
    const m = frontmatter.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'));
    return m ? m[1].trim() : '';
  };

  const name = field('name');
  const description = field('description');
  const effort = field('effort').toLowerCase();
  if (!name) return null;

  // TOML multi-line basic string: escape backslashes, then break any """ runs.
  const instructions = body
    .replace(/\\/g, '\\\\')
    .replace(/"""/g, '"\\""');

  const lines = [
    `name = ${JSON.stringify(name)}`,
    `description = ${JSON.stringify(description)}`,
  ];
  if (['minimal', 'low', 'medium', 'high', 'xhigh'].includes(effort)) {
    lines.push(`model_reasoning_effort = ${JSON.stringify(effort)}`);
  }
  lines.push('developer_instructions = """');
  lines.push(instructions.replace(/\n+$/, ''));
  lines.push('"""');
  return lines.join('\n') + '\n';
}

/**
 * Informational notice shown after a local (project-scoped) Codex install.
 *
 * Codex gates project-level `.codex/` configuration (including custom agents)
 * behind project trust: untrusted projects silently skip it. Pure function so
 * the installer message is unit-testable.
 *
 * @returns {string} Multi-line plain-text notice (no ANSI codes).
 */
function codexTrustNotice() {
  return [
    'Codex trust note: project-scoped .codex/ configuration (including the',
    'installed pan-* agents) only loads once the project is trusted in Codex.',
    'If commands or agents seem missing, approve the project when Codex prompts,',
    'or set trust_level for this path in ~/.codex/config.toml.',
  ].join('\n');
}

// ─── Gemini CLI → Antigravity transition notice (2026-06) ──────────────────

/**
 * Informational notice shown after a Gemini CLI install.
 *
 * Google announced (2026-05-19) that from 2026-06-18 the Gemini CLI serves
 * Gemini Code Assist (Standard/Enterprise) customers only; individual
 * free / AI Pro / Ultra accounts are directed to Antigravity CLI instead.
 * PAN's --gemini target installs for Gemini CLI; Antigravity CLI is not yet
 * a PAN install target (tracked in docs/ECOSYSTEM-REVIEW-2026-06.md).
 *
 * Pure function so the installer message is unit-testable.
 *
 * @returns {string} Multi-line plain-text notice (no ANSI codes).
 */
function geminiTransitionNotice() {
  return [
    'Gemini CLI transition notice: from June 18, 2026, Google\'s Gemini CLI serves',
    'Gemini Code Assist (Standard/Enterprise) customers; individual free / AI Pro /',
    'Ultra accounts are directed to Antigravity CLI instead. This install targets',
    'Gemini CLI. Antigravity CLI is not yet a PAN install target, but it reads the',
    'shared .agents/skills/ tree natively — PAN skills installed there (today via',
    'the --codex target) are usable from Antigravity in the same project.',
  ].join('\n');
}

// ─── Opus 4.7 Capability Detection ──────────────────────────────────────────

/**
 * Detect model capabilities from a model name string.
 * Used by installer to warn users when their default model lacks features
 * PAN 2.10+ relies on (1M context, extended thinking, prompt caching).
 *
 * Capability data refreshed 2026-06: Fable 5 and Opus 4.8/4.7/4.6 plus
 * Sonnet 4.6 all carry a 1M context window; only the legacy Opus/Sonnet
 * 4.0–4.5 generations are 200K.
 *
 * @param {string} modelName - e.g. "claude-fable-5", "claude-opus-4-8", "gpt-5"
 * @returns {{has_1m_ctx: boolean, has_thinking: boolean, has_cache: boolean, tier: string}}
 */
function detectModelCapabilities(modelName) {
  const result = { has_1m_ctx: false, has_thinking: false, has_cache: false, tier: 'unknown' };
  if (typeof modelName !== 'string' || !modelName) return result;
  const n = modelName.toLowerCase();

  // Anthropic Claude family
  if (n.includes('fable')) {
    return { has_1m_ctx: true, has_thinking: true, has_cache: true, tier: 'reasoning' };
  }
  if (n.includes('opus-4-8') || n.includes('opus-4.8')
    || n.includes('opus-4-7') || n.includes('opus-4.7')
    || n.includes('opus-4-6') || n.includes('opus-4.6')) {
    return { has_1m_ctx: true, has_thinking: true, has_cache: true, tier: 'reasoning' };
  }
  if (n.includes('opus-4')) { // legacy Opus 4.0 / 4.1 / 4.5 — 200K context
    return { has_1m_ctx: false, has_thinking: true, has_cache: true, tier: 'reasoning' };
  }
  if (n.includes('sonnet-4-6') || n.includes('sonnet-4.6')) {
    return { has_1m_ctx: true, has_thinking: true, has_cache: true, tier: 'mid' };
  }
  if (n.includes('sonnet-4')) { // legacy Sonnet 4.0 / 4.5 — 200K context
    return { has_1m_ctx: false, has_thinking: true, has_cache: true, tier: 'mid' };
  }
  if (n.includes('haiku-4-5') || n.includes('haiku-4.5') || n.includes('haiku-4')) {
    return { has_1m_ctx: false, has_thinking: false, has_cache: true, tier: 'fast' };
  }
  // Older Claude 3.x — no thinking, no 1M context.
  if (n.includes('claude-3')) {
    return { has_1m_ctx: false, has_thinking: false, has_cache: true, tier: n.includes('opus') ? 'reasoning' : (n.includes('haiku') ? 'fast' : 'mid') };
  }

  // OpenAI GPT-5 family — assume caching + thinking but not 1M ctx.
  if (n.startsWith('gpt-5') || n.includes('o3') || n.includes('o4')) {
    return { has_1m_ctx: false, has_thinking: true, has_cache: true, tier: 'reasoning' };
  }
  if (n.startsWith('gpt-4')) {
    return { has_1m_ctx: false, has_thinking: false, has_cache: true, tier: 'mid' };
  }

  // Gemini family. Distinguishes Pro / Flash / Flash-Lite and 2.5/3.x.
  //   - Pro variants  → reasoning tier (thinking available on 2.5+)
  //   - Flash         → mid tier (thinking on 2.5+)
  //   - Flash-Lite    → fast tier (no thinking)
  //   - 1M context is native on 2.x / 3.x Pro + Flash; Flash-Lite is 1M too on 2.5+.
  if (n.includes('gemini-3') || n.includes('gemini-2') || n.includes('gemini-1.5')) {
    const isFlashLite = n.includes('flash-lite');
    const isFlash = !isFlashLite && n.includes('flash');
    const isPro = !isFlash && !isFlashLite; // default to Pro when neither flash nor flash-lite in name
    const is25orNewer = n.includes('gemini-2.5') || n.includes('gemini-3') || n.includes('-2-5');
    const hasThinking = (is25orNewer || n.includes('thinking')) && !isFlashLite;
    // 1M context: Pro + Flash on 2.x/3.x, Flash-Lite on 2.5+, Gemini 1.5 Pro (but not 1.5 Flash typically).
    const has1m = isPro || isFlash || (isFlashLite && is25orNewer)
      || (n.includes('gemini-1.5-pro') && !isFlash);
    const tier = isFlashLite ? 'fast' : (isFlash ? 'mid' : 'reasoning');
    return { has_1m_ctx: has1m, has_thinking: hasThinking, has_cache: true, tier };
  }

  return result;
}

// ─── Install verification ────────────────────────────────────────────────────
//
// IMPROVEMENT-TODO P0 (v3.7.10): post-install verification pass that catches
// silent copy/write failures from earlier stages. The installer has many
// `catch {}` blocks in copy paths (around copyWithPathReplacement, the codex/
// copilot skill builders, and the agent file writers); a final manifest-level
// sanity check is belt-and-braces. This function reads the just-written
// manifest and verifies every recorded file actually exists.

const fs_v = require('fs');
const path_v = require('path');

/**
 * Verify installed files against the manifest.
 *
 * For each entry in manifest.files, check the file is present on disk at
 * the expected location AND non-empty. We do NOT re-hash: the manifest was
 * just written from these files, so re-hashing is tautological — a 0-byte
 * copy gets a 0-byte hash recorded and would "verify" cleanly. The size
 * check is what actually catches the canonical silent copy failure
 * (truncated/empty file landed instead of content).
 *
 * Also verifies critical anchor files that, if missing or empty, mean the
 * install is unusable: pan-tools.cjs, the dispatcher.
 *
 * @param {string} configDir - install root (e.g., ~/.claude or ./.codex)
 * @param {object} manifest - the manifest object returned by writeManifest()
 * @returns {object} { ok: bool, missing: string[], empty: string[], warnings: string[] }
 */
function verifyInstall(configDir, manifest) {
  const missing = [];
  const empty = [];
  const warnings = [];

  // Critical anchor: pan-tools.cjs MUST exist and carry content; without it,
  // no command works.
  const dispatcherRel = 'pan-wizard-core/bin/pan-tools.cjs';
  const dispatcherPath = path_v.join(configDir, dispatcherRel);
  try {
    const st = fs_v.statSync(dispatcherPath);
    if (st.size === 0) {
      empty.push(`${dispatcherRel} (dispatcher is empty — copy failed; install is unusable)`);
    }
  } catch {
    missing.push(`${dispatcherRel} (dispatcher — install is unusable without it)`);
  }

  // Manifest-level: every tracked file must exist and be non-empty. No
  // shipped PAN file is legitimately 0 bytes.
  if (manifest && manifest.files) {
    for (const rel of Object.keys(manifest.files)) {
      const abs = path_v.join(configDir, rel);
      try {
        const st = fs_v.statSync(abs);
        if (st.size === 0) {
          empty.push(rel);
        }
      } catch {
        missing.push(rel);
      }
    }
  } else {
    warnings.push('manifest is missing or has no files entry — verification is degraded');
  }

  return { ok: missing.length === 0 && empty.length === 0, missing, empty, warnings };
}

// ─── Claude Code plugin packaging (2026-06) ─────────────────────────────────

/**
 * Build the .claude-plugin/plugin.json manifest for the PAN plugin build.
 * Format verified against code.claude.com/docs/en/plugins-reference (2026-06):
 * manifest is optional metadata; components auto-discover from commands/,
 * agents/, hooks/hooks.json in the plugin root.
 *
 * @param {object} pkg - parsed package.json
 * @returns {object} plugin.json object
 */
function buildPluginManifest(pkg) {
  return {
    name: 'pan-wizard',
    displayName: 'PAN Wizard',
    version: pkg.version,
    description: pkg.description || 'Structured, phase-based planning and execution for AI coding agents.',
    author: { name: 'PAN Wizard contributors', url: 'https://github.com/oharms/PanWizard' },
    repository: 'https://github.com/oharms/PanWizard',
    license: pkg.license || 'MIT',
    keywords: ['planning', 'workflow', 'agents', 'phases'],
  };
}

/**
 * Build the plugin hooks/hooks.json — PAN's four hooks registered with
 * ${CLAUDE_PLUGIN_ROOT}-anchored commands (the documented plugin-relative
 * path convention for hook configs).
 * @returns {object} hooks.json object
 */
function buildPluginHooksConfig() {
  const hook = (script) => ({
    hooks: [{ type: 'command', command: `node "\${CLAUDE_PLUGIN_ROOT}/hooks/${script}"` }],
  });
  return {
    hooks: {
      SessionStart: [hook('pan-check-update.js')],
      PostToolUse: [hook('pan-context-monitor.js')],
      SubagentStop: [hook('pan-cost-logger.js'), hook('pan-trace-logger.js')],
    },
  };
}

// ─── Native Claude Code workflows (2026-06) ─────────────────────────────────
//
// Claude Code discovers deterministic orchestration scripts in
// `.claude/workflows/*.js` (export const meta + agent()/parallel()/pipeline()
// hooks). PAN ships native scripts only for protocols that are genuinely
// deterministic fan-outs — the markdown protocols remain the source of truth
// for judgment-heavy flows. Claude-only; other runtimes have no equivalent.

/**
 * Build the PAN native workflow scripts.
 * Pure function — returns [{name, content}] for the installer to write.
 * @returns {Array<{name: string, content: string}>}
 */
function buildNativeWorkflowScripts() {
  const reviewPipeline = `export const meta = {
  name: 'pan-review-pipeline',
  description: 'PAN deep review: reviewer + hardener fan-out, meta-reviewer merge',
  whenToUse: 'Deterministic version of the /pan-review-deep fan-out. Pass the phase number or a description of the change set as args.',
  phases: [
    { title: 'Find', detail: 'reviewer + security hardener in parallel' },
    { title: 'Merge', detail: 'meta-reviewer dedupes, disputes, and issues the verdict' },
  ],
}

const target = (typeof args === 'string' && args.trim())
  ? args.trim()
  : 'the uncommitted/current phase changes in this repository'

const FINDINGS = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          file: { type: 'string' },
          severity: { type: 'string', enum: ['critical', 'major', 'minor', 'info'] },
          detail: { type: 'string' },
        },
        required: ['title', 'severity', 'detail'],
      },
    },
  },
  required: ['findings'],
}

phase('Find')
const results = await parallel([
  () => agent(
    'Review ' + target + '. Report EVERY finding you see, tagged with the right severity tier — coverage, not filtering; the meta-reviewer downstream is the filter.',
    { agentType: 'pan-reviewer', label: 'review', phase: 'Find', schema: FINDINGS }),
  () => agent(
    'Security-audit ' + target + ' (OWASP Top 10 + STRIDE). Report every concrete finding with severity.',
    { agentType: 'pan-hardener', label: 'harden', phase: 'Find', schema: FINDINGS }),
])
const found = results.filter(Boolean).flatMap(r => r.findings)
log(found.length + ' raw findings collected')

phase('Merge')
const VERDICT = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['ok', 'ok_with_minor', 'fix_before_merge', 'review_required', 'block'] },
    confirmed: { type: 'array', items: { type: 'object' } },
    disputed: { type: 'array', items: { type: 'object' } },
    summary: { type: 'string' },
  },
  required: ['verdict', 'summary'],
}
const merged = await agent(
  'Merge these raw review findings: dedupe overlaps, dispute overstated ones, then issue a single verdict on the PAN ladder (ok / ok_with_minor / fix_before_merge / review_required / block).\\n\\nFindings:\\n' + JSON.stringify(found, null, 2),
  { agentType: 'pan-meta-reviewer', label: 'merge', phase: 'Merge', schema: VERDICT })

return merged
`;

  const mapCodebase = `export const meta = {
  name: 'pan-map-codebase',
  description: 'PAN codebase mapping: shard fan-out per top-level area, then synthesis',
  whenToUse: 'Deterministic version of the /pan-map-codebase shard pattern for repositories too large for a single pass.',
  phases: [
    { title: 'Scan', detail: 'discover top-level areas worth documenting' },
    { title: 'Map', detail: 'one documenter per area, in parallel' },
    { title: 'Synthesize', detail: 'merge area maps into one codebase overview' },
  ],
}

phase('Scan')
const AREAS = {
  type: 'object',
  properties: { areas: { type: 'array', items: { type: 'string' } } },
  required: ['areas'],
}
const scan = await agent(
  'List the top-level areas of this repository worth documenting separately (source dirs, test dirs, docs, infra). Skip vendored/generated content (node_modules, dist, build artifacts). Return at most 8 area paths.',
  { label: 'scan', phase: 'Scan', schema: AREAS })
const areas = (scan && scan.areas ? scan.areas : []).slice(0, 8)
if (areas.length === 0) return { error: 'no areas discovered' }
log('mapping ' + areas.length + ' areas')

phase('Map')
const AREA_MAP = {
  type: 'object',
  properties: {
    area: { type: 'string' },
    purpose: { type: 'string' },
    key_files: { type: 'array', items: { type: 'string' } },
    conventions: { type: 'array', items: { type: 'string' } },
    risks: { type: 'array', items: { type: 'string' } },
  },
  required: ['area', 'purpose'],
}
const maps = await parallel(areas.map(a => () =>
  agent('Document the "' + a + '" area of this repository: purpose, key files, conventions in force, and risks/gotchas. Be specific and cite file paths.',
    { agentType: 'pan-document_code', label: 'map:' + a, phase: 'Map', schema: AREA_MAP })))

phase('Synthesize')
const synthesis = await agent(
  'Merge these per-area maps into one coherent codebase overview (architecture summary, cross-area conventions, integration points, top risks). Write the result to .planning/codebase/ using the PAN codebase templates if a .planning directory exists; otherwise return it as your final answer.\\n\\nArea maps:\\n' + JSON.stringify(maps.filter(Boolean), null, 2),
  { label: 'synthesize', phase: 'Synthesize' })

return { areas_mapped: maps.filter(Boolean).length, synthesis }
`;

  return [
    { name: 'pan-review-pipeline.js', content: reviewPipeline },
    { name: 'pan-map-codebase.js', content: mapCodebase },
  ];
}

// ─── AGENTS.md universal rules layer (ADR-0028 Phase 3) ─────────────────────
//
// AGENTS.md is the cross-runtime project-instructions standard; every PAN
// target runtime (and Antigravity CLI) reads it natively. PAN contributes one
// marker-fenced section so agents in any runtime understand the PAN context
// when reading the repo. User content outside the markers is never touched.

const PAN_AGENTS_BEGIN = '<!-- BEGIN PAN WIZARD -->';
const PAN_AGENTS_END = '<!-- END PAN WIZARD -->';

/**
 * Build the PAN section for AGENTS.md (marker-fenced, runtime-neutral).
 * @returns {string} The fenced section, no leading/trailing blank lines.
 */
function buildAgentsMdSection() {
  return [
    PAN_AGENTS_BEGIN,
    '## PAN Wizard',
    '',
    'This project uses PAN Wizard for structured, phase-based planning and execution.',
    '',
    '- `.planning/` is PAN\'s state directory (state.md, roadmap.md, phase directories). Treat it as the source of truth for planning state and modify it through PAN commands, not by hand.',
    '- PAN commands install as `pan-*` skills/commands (for example `/pan-help`, `/pan-new-project`, `/pan-exec-phase`). Start with `/pan-help`.',
    '- The `pan-tools` dispatcher backs every command; it lives under `pan-wizard-core/` inside the runtime\'s config directory (or `.agents/` for unified installs).',
    PAN_AGENTS_END,
  ].join('\n');
}

/**
 * Insert or replace the PAN section in AGENTS.md content.
 * - No existing content (null/empty) → just the section.
 * - Markers present → replace exactly the fenced block, preserving everything
 *   around it.
 * - Markers absent → append with a separating blank line.
 * @param {string|null} existing - Current AGENTS.md content, or null if absent
 * @param {string} section - Output of buildAgentsMdSection()
 * @returns {string} New file content (always newline-terminated)
 */
function upsertAgentsMdSection(existing, section) {
  if (!existing || !existing.trim()) {
    return section + '\n';
  }
  const beginIdx = existing.indexOf(PAN_AGENTS_BEGIN);
  const endIdx = existing.indexOf(PAN_AGENTS_END);
  if (beginIdx !== -1 && endIdx !== -1 && endIdx > beginIdx) {
    const before = existing.slice(0, beginIdx);
    const after = existing.slice(endIdx + PAN_AGENTS_END.length);
    return before + section + after;
  }
  return existing.trimEnd() + '\n\n' + section + '\n';
}

/**
 * Remove the PAN section from AGENTS.md content.
 * @param {string} existing - Current AGENTS.md content
 * @returns {string|null} Content without the PAN block, or null when nothing
 *   meaningful remains (caller should delete the file).
 */
function removeAgentsMdSection(existing) {
  if (!existing) return null;
  const beginIdx = existing.indexOf(PAN_AGENTS_BEGIN);
  const endIdx = existing.indexOf(PAN_AGENTS_END);
  if (beginIdx === -1 || endIdx === -1 || endIdx < beginIdx) {
    return existing; // no PAN block — leave untouched
  }
  const before = existing.slice(0, beginIdx);
  const after = existing.slice(endIdx + PAN_AGENTS_END.length);
  const remaining = (before.trimEnd() + '\n\n' + after.trimStart()).trim();
  return remaining ? remaining + '\n' : null;
}

/**
 * Ensure CLAUDE.md bridges to AGENTS.md via a marker-fenced @AGENTS.md import
 * (Claude Code's documented pattern for adopting the universal rules file).
 * Idempotent; preserves all user content.
 * @param {string|null} existing - Current CLAUDE.md content, or null if absent
 * @returns {string} New file content
 */
function ensureClaudeMdImport(existing) {
  const block = `${PAN_AGENTS_BEGIN}\n@AGENTS.md\n${PAN_AGENTS_END}`;
  if (!existing || !existing.trim()) {
    return block + '\n';
  }
  if (existing.includes(PAN_AGENTS_BEGIN)) {
    return existing; // bridge (or another PAN block) already present
  }
  if (/^@AGENTS\.md\s*$/m.test(existing)) {
    return existing; // user already imports AGENTS.md themselves
  }
  return existing.trimEnd() + '\n\n' + block + '\n';
}

/**
 * Remove the PAN bridge block from CLAUDE.md content.
 * @param {string} existing - Current CLAUDE.md content
 * @returns {string|null} Content without the bridge, or null when nothing
 *   meaningful remains (caller should delete the file).
 */
function removeClaudeMdImport(existing) {
  return removeAgentsMdSection(existing);
}

// ─── Exports ────────────────────────────────────────────────────────────────

module.exports = {
  // Constants
  colorNameToHex,
  claudeToOpencodeTools,
  claudeToGeminiTools,
  claudeToCopilotTools,
  // Utilities
  getDirName,
  getConfigDirFromHome,
  expandTilde,
  toSingleLine,
  yamlQuote,
  buildHookCommand,
  // Frontmatter
  extractFrontmatterAndBody,
  extractFrontmatterField,
  // Tool name converters
  convertToolName,
  convertGeminiToolName,
  convertCopilotToolName,
  // Slash command converters
  convertSlashCommandsToCodexSkillMentions,
  convertSlashCommandsToCopilotSkillMentions,
  // Content converters
  convertClaudeToCodexMarkdown,
  convertClaudeToCopilotMarkdown,
  convertClaudeToOpencodeFrontmatter,
  convertClaudeToGeminiToml,
  convertClaudeToGeminiAgent,
  rewriteAskUserQuestionForCopilot,
  stripSubTags,
  // Skill/agent builders
  getCodexSkillAdapterHeader,
  convertClaudeCommandToCodexSkill,
  getUnifiedSkillAdapterHeader,
  convertClaudeCommandToUnifiedSkill,
  getCopilotSkillAdapterHeader,
  convertClaudeCommandToCopilotSkill,
  convertClaudeToCopilotAgent,
  // Attribution
  processAttribution,
  // JSONC
  parseJsonc,
  // Opus 4.7 capabilities
  detectModelCapabilities,
  buildClaudeSkillShim,
  translateThinkingDirective,
  stripThinkingFrontmatter,
  // Gemini CLI → Antigravity transition (2026-06)
  geminiTransitionNotice,
  // Codex agents (TOML) + trust notice (2026-06)
  convertClaudeAgentToCodexToml,
  codexTrustNotice,
  // Copilot CLI hooks config (2026-06)
  buildCopilotHooksConfig,
  HOOK_EVENT_MAP,
  mergeCodexHooksConfig,
  removeCodexPanHooks,
  buildNativeWorkflowScripts,
  buildPluginManifest,
  buildPluginHooksConfig,
  // Install verification (v3.7.10)
  verifyInstall,
  // AGENTS.md universal rules layer (ADR-0028 Phase 3)
  buildAgentsMdSection,
  upsertAgentsMdSection,
  removeAgentsMdSection,
  ensureClaudeMdImport,
  removeClaudeMdImport,
  PAN_AGENTS_BEGIN,
  PAN_AGENTS_END,
};
