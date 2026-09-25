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
 * tree is read by every runtime (Claude Code via its byte-identical .claude/skills/ copy), so invocation, delegation, and interaction
 * guidance are phrased in terms of "your runtime's native mechanism".
 */
function getUnifiedSkillAdapterHeader(skillName, note) {
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
${note ? `\n${note}\n` : ''}</pan_skill_adapter>`;
}

/** Claude command → runtime-neutral SKILL.md (ADR-0028 Phase 1) */
/**
 * `compatibility` value for emitted unified skills — the spec's optional field
 * for environment requirements (max 500 chars). Kept short and factual: these
 * are the two things a host cannot infer and that every PAN skill depends on.
 */
const SKILL_COMPATIBILITY = 'Requires Node.js (skills invoke the bundled pan-tools CLI) and a project with a .planning/ directory, created by /pan-new-project or /pan-map-codebase.';

function convertClaudeCommandToUnifiedSkill(content, skillName, opts = {}) {
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
  // `opts.adapterNote` (Agent Plugins bundle, ADR-0045) appends a consumer-
  // specific paragraph inside the adapter block; absent, the header is
  // byte-identical to what every install has shipped since ADR-0028.
  const adapter = getUnifiedSkillAdapterHeader(skillName, opts.adapterNote);
  // `compatibility` is the spec's optional field for stating environment
  // requirements, and PAN has real ones: the skill bodies shell out to
  // `pan-tools` (Node) and every workflow reads/writes `.planning/`. Declaring
  // them beats the alternative, which is a host discovering it mid-run.
  // Deliberately NOT emitting `allowed-tools`: it is marked experimental in the
  // spec, and ADR-0028's frontmatter rule is that anything unverified stays out
  // until a live per-runtime check confirms no parser rejects it.
  return `---\nname: ${yamlQuote(skillName)}\ndescription: ${yamlQuote(description)}\ncompatibility: ${yamlQuote(SKILL_COMPATIBILITY)}\nmetadata:\n  short-description: ${yamlQuote(shortDescription)}\n---\n\n${adapter}\n\n${body.trimStart()}`;
}

// ─── Unified-skill content rewrites (extracted from bin/install.js, 2026-09) ──
//
// The installer's --unified-skills path and the Agent Plugins bundle builder
// (ADR-0045) need the SAME rewrite of a Claude-flavoured PAN document — the
// rule from ADR-0028 is one converter, several call sites, never a second copy.
// Each function below reproduces its installer sequence exactly, in order; the
// installer now calls these, and `tests/unified-skills-install.test.cjs` pins
// the output it has always produced.
//
// Options (all strings):
//   corePrefix        where `pan-wizard-core/` lives for the consumer, with a
//                     trailing slash — `./.agents/` (local unified install),
//                     `<abs>/.agents/` (global), `{{PAN_PLUGIN_ROOT}}/` (bundle)
//   pathPrefix        replacement for a residual `~/.claude/` reference
//   projectDirPrefix  replacement for a residual `./.claude/` reference —
//                     `./<runtime dir>/` on an install, the root token in a bundle
//   attribution       processAttribution() setting: null remove, undefined keep,
//                     string replace

/**
 * Rewrite a PAN command document's paths for a unified-skills consumer. Does
 * NOT convert it to SKILL.md form — call convertClaudeCommandToUnifiedSkill()
 * on the result, exactly as the installer does.
 */
function rewriteUnifiedSkillCommandContent(content, { corePrefix, pathPrefix, projectDirPrefix, attribution }) {
  // Core + agent-definition references → the shared copies (specific, before
  // the generic rewrites); everything else .claude-scoped → the consumer. Agent
  // refs point at the canonical reference copies shipped with the shared core —
  // a runtime's own agents dir may carry a different format (Codex TOML,
  // Copilot .agent.md).
  content = content.replace(/~\/\.claude\/pan-wizard-core\//g, `${corePrefix}pan-wizard-core/`);
  content = content.replace(/\.\/\.claude\/pan-wizard-core\//g, `${corePrefix}pan-wizard-core/`);
  content = content.replace(/~\/\.claude\/agents\//g, `${corePrefix}pan-wizard-core/agents/`);
  content = content.replace(/\.\/\.claude\/agents\//g, `${corePrefix}pan-wizard-core/agents/`);
  content = content.replace(/~\/\.claude\//g, pathPrefix);
  content = content.replace(/\.\/\.claude\//g, projectDirPrefix);
  // Not every runtime puts a `pan-tools` bin on PATH — invoke via node.
  const panToolsPath = `${corePrefix}pan-wizard-core/bin/pan-tools.cjs`;
  content = content.replace(/\bpan-tools\b(?=\s+[a-z])/g, `node ${panToolsPath}`);
  return processAttribution(content, attribution);
}

/**
 * Rewrite a markdown file inside a shared copy of pan-wizard-core (workflows,
 * templates, references, learnings) for a unified-skills consumer.
 */
function rewriteSharedCoreMarkdown(content, { corePrefix, pathPrefix, projectDirPrefix, attribution }) {
  content = content.replace(/~\/\.claude\/pan-wizard-core\//g, `${corePrefix}pan-wizard-core/`);
  content = content.replace(/\.\/\.claude\/pan-wizard-core\//g, `${corePrefix}pan-wizard-core/`);
  // Agent-definition refs → the canonical reference copies in the shared core
  // (runtime agents dirs carry runtime-specific formats).
  content = content.replace(/~\/\.claude\/agents\//g, `${corePrefix}pan-wizard-core/agents/`);
  content = content.replace(/\.\/\.claude\/agents\//g, `${corePrefix}pan-wizard-core/agents/`);
  content = content.replace(/~\/\.claude\//g, pathPrefix);
  content = content.replace(/\.\/\.claude\//g, projectDirPrefix);
  content = processAttribution(content, attribution);
  return convertSlashCommandsToCopilotSkillMentions(content);
}

/**
 * Rewrite an agent definition for the canonical reference copy that ships
 * under `<shared core>/agents/` — reading material for agents, not a runtime
 * registration (ADR-0028 agent-ref canonicalization).
 */
function rewriteAgentReferenceCopy(content, corePrefix) {
  content = content.replace(/~\/\.claude\/pan-wizard-core\//g, `${corePrefix}pan-wizard-core/`);
  content = content.replace(/\.\/\.claude\/pan-wizard-core\//g, `${corePrefix}pan-wizard-core/`);
  return convertSlashCommandsToCopilotSkillMentions(content);
}

/**
 * Drop internal-scoped topics from a parsed learnings/index.json and recompute
 * its totals exactly (each topic carries its own size fields). Pure: returns
 * the rewritten object, or null when there was nothing internal to drop or
 * the input is not an index. The installer and the bundle builders share it so
 * a shipped index never lists files the package deliberately withholds.
 */
function stripInternalLearningsTopics(parsed) {
  if (!parsed || !Array.isArray(parsed.topics)) return null;
  const kept = parsed.topics.filter(t => t && t.scope !== 'internal');
  if (kept.length === parsed.topics.length) return null;
  const out = { ...parsed, topics: kept };
  if (parsed.totals && typeof parsed.totals === 'object') {
    out.totals = {
      ...parsed.totals,
      topics: kept.length,
      patterns: kept.reduce((n, t) => n + (Array.isArray(t.patterns) ? t.patterns.length : 0), 0),
      size_bytes: kept.reduce((n, t) => n + (t.size_bytes || 0), 0),
      size_tokens_est: kept.reduce((n, t) => n + (t.size_tokens_est || 0), 0),
    };
  }
  return out;
}

// ─── Agent Plugins bundle (ADR-0045, 2026-09) ────────────────────────────────
//
// A vendor-neutral package: `plugin.json` + `skills/` + `mcp.json` at the root,
// loaded natively by Copilot CLI / VS Code, Codex, Cursor and Kiro. Every
// constant here is quoted from the pinned schemas in tests/fixtures/agent-plugins/
// (read from agent-plugins.org on 2026-09-10) — the manifest schema is CLOSED,
// so an unlisted key is a fatal plugin rejection, not a warning.

const AGENT_PLUGINS_VERSION = '1.0.0';
const AGENT_PLUGIN_MANIFEST_SCHEMA = `https://agent-plugins.org/schemas/${AGENT_PLUGINS_VERSION}/plugin.schema.json`;
const AGENT_PLUGIN_MCP_SCHEMA = `https://agent-plugins.org/schemas/${AGENT_PLUGINS_VERSION}/mcp.schema.json`;

// Path token inside bundled skill and core markdown. Agent Plugins expands
// `${PLUGIN_ROOT}` ONLY in mcp.json fields, and Claude's `${CLAUDE_PLUGIN_ROOT}`
// substitution in content is Claude-specific — so bundle content carries PAN's
// own token, in the style of `{{PAN_ARGS}}`, and the adapter note defines it.
const AGENT_PLUGIN_ROOT_TOKEN = '{{PAN_PLUGIN_ROOT}}';
// A few PAN documents refer to the RUNTIME's own configuration directories —
// its `settings.json`, its `commands/`, PAN's update-check cache, the local
// patches dir. The installer maps those to the installing runtime (`~/.codex/`,
// `./.gemini/`, …); a bundle is built for no runtime in particular, so it
// carries two more tokens the adapter note defines: the user-level and the
// project-level runtime directory.
const AGENT_PLUGIN_RUNTIME_HOME_TOKEN = '{{PAN_RUNTIME_HOME}}';
const AGENT_PLUGIN_RUNTIME_DIR_TOKEN = '{{PAN_RUNTIME_DIR}}';

/** Agent Plugins `plugin.json` — closed schema; mirrors package.json like the Claude manifest. */
function buildAgentPluginManifest(pkg) {
  return {
    $schema: AGENT_PLUGIN_MANIFEST_SCHEMA,
    name: 'pan-wizard',
    version: pkg.version,
    description: pkg.description || 'Structured, phase-based planning and execution for AI coding agents.',
    author: { name: 'PAN Wizard contributors', url: 'https://github.com/oharms/PanWizard' },
    homepage: 'https://github.com/oharms/PanWizard',
    repository: 'https://github.com/oharms/PanWizard',
    license: pkg.license || 'MIT',
    keywords: ['planning', 'workflow', 'agents', 'phases'],
  };
}

/**
 * Agent Plugins `mcp.json` declaring the bundled bridge. `command` must be a
 * single executable token with NO placeholder (spec), so the server is launched
 * as `node` with the `${PLUGIN_ROOT}`-anchored script in `args`, where expansion
 * is defined. No `env`: a plugin serves whatever project the session is in, and
 * `env` may not name PLUGIN_ROOT/PLUGIN_DATA anyway. The default working
 * directory for a stdio server is the PLUGIN ROOT (spec) — which is why the
 * bridge must take the project root per call (ADR-0045 D6, plan item 4g).
 */
function buildAgentPluginMcpConfig() {
  return {
    $schema: AGENT_PLUGIN_MCP_SCHEMA,
    mcpServers: {
      pan: {
        type: 'stdio',
        command: 'node',
        args: ['${PLUGIN_ROOT}/pan-wizard-core/mcp/server.cjs'],
      },
    },
  };
}

/**
 * Copilot vendor-directory hooks for an Agent Plugins bundle —
 * `com.github.copilot/hooks/hooks.json` (ADR-0045 D5).
 *
 * Shape from code.visualstudio.com/docs/agent-customization/agent-plugins (read
 * 2026-09-10): the FLAT plugin format — PascalCase lifecycle events, each an
 * array of `{ type: 'command', command }` — with `${CLAUDE_PLUGIN_ROOT}` expanded
 * to the plugin root at runtime and also exported to the hook process. That is
 * VS-Code-verified. Copilot CLI's own hooks how-to describes WORKSPACE hooks
 * (camelCase events, `bash`/`powershell` keys) and does not cover plugins, so a
 * live `copilot plugin install` is the gate before relying on this shape there.
 * The observers-vs-monitor split mirrors the Codex builder: no async flag exists
 * in this format, so nothing is marked.
 *
 * @param {{updateCheckCommand?:string, contextMonitorCommand?:string, costLoggerCommand?:string, traceLoggerCommand?:string}} commands
 */
function buildCopilotPluginHooksConfig(commands) {
  const { updateCheckCommand, contextMonitorCommand, costLoggerCommand, traceLoggerCommand } = commands || {};
  const hooks = {};
  if (updateCheckCommand) hooks.SessionStart = [{ type: 'command', command: updateCheckCommand }];
  if (contextMonitorCommand) hooks.PostToolUse = [{ type: 'command', command: contextMonitorCommand }];
  const subagentStop = [];
  if (costLoggerCommand) subagentStop.push({ type: 'command', command: costLoggerCommand });
  if (traceLoggerCommand) subagentStop.push({ type: 'command', command: traceLoggerCommand });
  if (subagentStop.length > 0) hooks.SubagentStop = subagentStop;
  return { hooks };
}

/** Copilot's reverse-domain extension namespace — the top-level directory its plugin components live in. */
const COPILOT_PLUGIN_NAMESPACE = 'com.github.copilot';

/** The adapter paragraph appended to every bundled skill (ADR-0045 D3). */
function agentPluginSkillAdapterNote() {
  return `Plugin bundle (Agent Plugins format):
- \`${AGENT_PLUGIN_ROOT_TOKEN}\` in this skill is the directory that holds this plugin's \`plugin.json\` — two levels above this SKILL.md. Your runtime reports this skill's file location when it loads it; derive the root from that path and substitute it wherever \`${AGENT_PLUGIN_ROOT_TOKEN}\` appears before running a command.
- Prefer the \`pan\` MCP server's tools when your runtime has connected this plugin's \`mcp.json\`, and pass the project's absolute path as each tool's \`cwd\` argument — the server is started in the plugin's directory, which is never the project. Otherwise run \`node ${AGENT_PLUGIN_ROOT_TOKEN}/pan-wizard-core/bin/pan-tools.cjs <verb>\` from the project root.
- \`${AGENT_PLUGIN_RUNTIME_HOME_TOKEN}\` is your runtime's user-level configuration directory (for example \`~/.claude\`, \`~/.codex\`, \`~/.gemini\`, \`~/.config/opencode\`, \`~/.copilot\`) and \`${AGENT_PLUGIN_RUNTIME_DIR_TOKEN}\` its project-level directory (\`.claude\`, \`.codex\`, \`.gemini\`, \`.opencode\`, \`.github\`). Substitute the one that applies to the runtime you are.`;
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
/**
 * @param {string} content - Claude agent markdown
 * @param {object} [opts]
 * @param {Record<string,string[]>} [opts.modelLists] - Copilot CLI (>= 1.0.83) accepts a
 *   `model:` LIST tried in order plus `model-policy`. When a PAN agent pins `model:
 *   <alias>` and this map has an entry for the alias, the Copilot agent gets that list
 *   and `model-policy: prefer` (degrade gracefully; `required` would refuse to run).
 *   NOT wired into the installer yet: the Copilot model ids must be verified on a live
 *   CLI first (ADR-0028's rule; harness/scenarios/live-gate-copilot.json carries the
 *   probe). Reality check RC15 / plan item R13, 2026-09-10.
 */
function convertClaudeToCopilotAgent(content, opts = {}) {
  const converted = convertClaudeToCopilotMarkdown(content);
  const { frontmatter, body } = extractFrontmatterAndBody(converted);
  let name = '';
  let description = '';
  const copilotTools = [];

  if (frontmatter) {
    name = extractFrontmatterField(frontmatter, 'name') || '';
    description = extractFrontmatterField(frontmatter, 'description') || '';
    // Parse the same frontmatter shapes the Gemini/OpenCode converters handle:
    // an inline `tools:` comma list AND an `allowed-tools:` YAML block list.
    // (No PAN agent uses the legacy `allowed_tools:` block, so the previous
    // regex left every Copilot agent with no tool restrictions.)
    const lines = frontmatter.split('\n');
    let inAllowedTools = false;
    const rawTools = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('allowed-tools:')) { inAllowedTools = true; continue; }
      if (trimmed.startsWith('tools:')) {
        const toolsValue = trimmed.substring(6).trim();
        if (toolsValue) {
          rawTools.push(...toolsValue.split(',').map(t => t.trim()).filter(t => t));
        } else {
          inAllowedTools = true;
        }
        continue;
      }
      if (inAllowedTools) {
        if (trimmed.startsWith('- ')) {
          rawTools.push(trimmed.substring(2).trim());
          continue;
        } else if (trimmed && !trimmed.startsWith('-')) {
          inAllowedTools = false;
        }
      }
    }
    for (const toolName of rawTools) {
      const copilotTool = convertCopilotToolName(toolName);
      if (copilotTool && !copilotTools.includes(copilotTool)) {
        copilotTools.push(copilotTool);
      }
    }
  }

  const toolsYaml = copilotTools.length > 0
    ? `\ntools:\n${copilotTools.map(t => `  - ${yamlQuote(t)}`).join('\n')}`
    : '';
  // R13: optional model fallback list for agents that pin a model alias.
  let modelYaml = '';
  const lists = opts && opts.modelLists;
  if (lists && frontmatter) {
    const pinned = extractFrontmatterField(frontmatter, 'model');
    const list = pinned && Array.isArray(lists[pinned]) ? lists[pinned].filter(Boolean) : null;
    if (list && list.length) {
      modelYaml = `\nmodel:\n${list.map(m => `  - ${yamlQuote(m)}`).join('\n')}\nmodel-policy: prefer`;
    }
  }
  return `---\nname: ${yamlQuote(name)}\ndescription: ${yamlQuote(description)}${toolsYaml}${modelYaml}\n---\n${body}`;
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
  // 2026-06) — carries the cost + trace loggers, same as Claude and Codex (Gemini registers neither).
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
 * Cross-runtime hook event map: canonical PAN slot → the event name PAN registers
 * under on each runtime, or null where PAN deliberately registers nothing for that
 * slot. The installers read this table; tests/fixtures/hook-vocabulary.json holds
 * each runtime's documented event names, and tests/hook-vocabulary.test.cjs fails
 * when an emitted key is not one of them.
 *
 *   - claude: settings.json, PascalCase (code.claude.com/docs/en/hooks).
 *   - gemini: settings.json, in Gemini's OWN vocabulary (gemini-cli
 *     packages/core/src/hooks/types.ts `HookEventName`, read 2026-09-23). Any
 *     other key is skipped at load with an "Invalid hook event name" warning —
 *     which is what PAN's Claude-named PostToolUse, SubagentStop and Stop entries
 *     were from v3.4 until 2026-09-23: registered, reported, never run (R29).
 *     postToolUse is null because no Gemini hook payload or setting exposes the
 *     context-window usage the context monitor reads (Gemini has no statusline
 *     command either). subagentStop is null because Gemini has no
 *     subagent-completion event and hands every hook the main session's
 *     transcript, not the subagent's, so neither logger has anything to measure.
 *   - codex: `.codex/hooks.json`, Claude-compatible PascalCase (developers.openai.com
 *     2026-06; codex-rs config/src/hook_config.rs read 2026-09-23). Project-scoped
 *     hooks load once the project is trusted.
 *   - copilot: `.github/hooks/pan.json`, camelCase (docs.github.com hooks reference).
 *   - opencode: no hook system.
 *
 * `stop` is where the auto-advance stop guard registers (P-1809): Claude's Stop
 * and Gemini's AfterAgent, both of which re-prompt the agent when a hook blocks.
 * Codex and Copilot have a stop event too; PAN does not register the guard there yet.
 */
const HOOK_EVENT_MAP = Object.freeze({
  claude: { surface: 'settings.json', sessionStart: 'SessionStart', postToolUse: 'PostToolUse', subagentStop: 'SubagentStop', stop: 'Stop' },
  gemini: { surface: 'settings.json', sessionStart: 'SessionStart', postToolUse: null, subagentStop: null, stop: 'AfterAgent' },
  codex: { surface: 'hooks.json', sessionStart: 'SessionStart', postToolUse: 'PostToolUse', subagentStop: 'SubagentStop', stop: null },
  copilot: { surface: 'hooks/pan.json', sessionStart: 'sessionStart', postToolUse: 'postToolUse', subagentStop: 'subagentStop', stop: null },
  opencode: null,
});

/** The hook scripts PAN registers in a Claude-shaped settings.json `hooks` block. */
const PAN_SETTINGS_HOOKS = Object.freeze(['pan-check-update', 'pan-context-monitor', 'pan-cost-logger', 'pan-trace-logger', 'pan-stop-guard']);

/**
 * Remove, from every event array of a Claude-shaped `hooks` object except
 * `keepEvent`, the entries that run one of `hookNames`; emptied arrays are
 * dropped. Returns the event names entries were removed from. Mutates `hooks`.
 *
 * This is how a hook that moved event, or lost its event on a runtime, is cleaned
 * up on upgrade and on uninstall — keyed on the script, never on a remembered list
 * of event names, which is how dead keys survived before (R29).
 *
 * @param {object} hooks - settings.hooks
 * @param {string[]} hookNames - script basenames without `.js` (e.g. 'pan-stop-guard')
 * @param {string|null} [keepEvent] - the event the hook now belongs to, left alone
 * @returns {string[]}
 */
function stripPanHookEntries(hooks, hookNames, keepEvent = null) {
  const touched = [];
  if (!hooks || typeof hooks !== 'object' || Array.isArray(hooks)) return touched;
  for (const event of Object.keys(hooks)) {
    if (event === keepEvent || !Array.isArray(hooks[event])) continue;
    const before = hooks[event].length;
    hooks[event] = hooks[event].filter(entry => !(entry && Array.isArray(entry.hooks)
      && entry.hooks.some(h => h && typeof h.command === 'string' && hookNames.some(n => h.command.includes(n)))));
    if (hooks[event].length < before) touched.push(event);
    if (hooks[event].length === 0) delete hooks[event];
  }
  return touched;
}

// ─── MCP server registration (2026-08) ──────────────────────────────────────

/**
 * Cross-runtime MCP registration map. Every path and shape below was verified
 * against primary docs on 2026-08-12 — do NOT edit from memory, and re-verify
 * before trusting: this table's ancestor (`HOOK_EVENT_MAP`) exists because PAN
 * shipped two DEAD config paths that had been written from secondary sources.
 *
 * `register: false` means PAN deliberately does not write the file and prints a
 * copy-pasteable snippet instead. That is a risk decision, not an omission:
 *   - **codex** — MCP lives in `config.toml`, which PAN does not touch anywhere
 *     else and cannot merge non-destructively without a TOML parser (PAN is
 *     zero-dep and only ever *generates* TOML). Hand-merging a user's config
 *     risks their settings for no gain over a printed snippet.
 *   - **claude global** — user scope is `~/.claude.json`, a large file keyed by
 *     every project path the user has opened. PAN writes the project-scoped
 *     `.mcp.json` instead, which is the documented shareable surface.
 *
 * Shape notes that differ per runtime and are easy to get wrong:
 *   - claude/copilot/gemini use `mcpServers`; **opencode uses `mcp`**.
 *   - claude/copilot/gemini take `command` + `args[]`; **opencode takes a single
 *     `command` ARRAY** ([cmd, ...args]) and names its env block `environment`.
 *   - copilot/opencode want `type: "local"`; claude/gemini infer stdio from
 *     `command` and are not given a `type` here.
 */
const MCP_REGISTRATION = Object.freeze({
  claude: Object.freeze({
    register: true, key: 'mcpServers', localPath: '.mcp.json', globalPath: null,
    why: 'Project-scoped .mcp.json at the repo root (code.claude.com/docs/en/mcp). Needs one interactive approval; workspace trust gates it.',
  }),
  copilot: Object.freeze({
    // PATHS HERE ARE RELATIVE TO THE RUNTIME'S CONFIG DIR, not the repo root.
    // Copilot's config dir already *is* `.github/`, so this is `mcp.json` — it
    // resolves to `.github/mcp.json` on disk. Writing `.github/mcp.json` here
    // produced `.github/.github/mcp.json`, a file Copilot never reads; the
    // doubling is pinned by a test because it installs and verifies "cleanly".
    register: true, key: 'mcpServers', localPath: 'mcp.json', globalPath: 'mcp-config.json',
    why: 'docs.github.com add-mcp-servers: project-level .github/mcp.json (also .mcp.json up-tree), user-level ~/.copilot/mcp-config.json.',
  }),
  gemini: Object.freeze({
    register: true, key: 'mcpServers', localPath: 'settings.json', globalPath: 'settings.json',
    why: 'Gemini reads mcpServers from .gemini/settings.json (workspace) or ~/.gemini/settings.json (user) — the same file PAN already writes hooks into.',
  }),
  opencode: Object.freeze({
    register: true, key: 'mcp', localPath: 'opencode.json', globalPath: 'opencode.json',
    why: 'opencode.ai/docs/mcp-servers: opencode.json `mcp` block, type "local", command as one array, env block named `environment`. PAN already writes this file. LOCATION: the docs page (opencode.ai/docs/config) lists only a repo-root opencode.json; the .opencode/opencode.json PAN writes for local installs is read by the loader SOURCE — packages/opencode/src/config/config.ts, the branch for directories ending in .opencode reads opencode.json and opencode.jsonc (read 2026-09-10). Live but undocumented: re-check the loader on OpenCode upgrades (harness/scenarios/live-gate-opencode.json asks the CLI).',
  }),
  codex: Object.freeze({
    // Config-dir-relative like the others (resolves to `.codex/config.toml`).
    // These are documentation-only while register is false — but they follow the
    // convention anyway, so that flipping register:true later cannot inherit the
    // path-doubling bug Copilot's row shipped with.
    register: false, key: 'mcp_servers', localPath: 'config.toml', globalPath: 'config.toml',
    why: 'TOML-only surface ([mcp_servers.NAME] in config.toml, verified learn.chatgpt.com). PAN has no TOML merge and is zero-dep; a printed snippet is safer than hand-editing a user config.',
  }),
});

/**
 * Build one PAN MCP server entry in the shape a given runtime expects.
 *
 * @param {string} runtime - claude | copilot | gemini | opencode | codex
 * @param {string} serverPath - absolute path to pan-wizard-core/mcp/server.cjs
 * @param {string} panToolsPath - absolute path to pan-wizard-core/bin/pan-tools.cjs
 * @param {string} [projectRoot] - value for PAN_PROJECT_ROOT; omitted when falsy
 * @returns {object} the entry (NOT wrapped in its container key)
 */
function buildMcpServerEntry(runtime, serverPath, panToolsPath, projectRoot) {
  const env = { PAN_TOOLS_PATH: panToolsPath };
  if (projectRoot) env.PAN_PROJECT_ROOT = projectRoot;

  if (runtime === 'opencode') {
    // Single command ARRAY + `environment` — opencode's shape is the outlier.
    return { type: 'local', command: ['node', serverPath], enabled: true, environment: env };
  }
  const entry = { command: 'node', args: [serverPath], env };
  // Copilot's documented example carries an explicit local type; Claude and
  // Gemini infer stdio from `command`, and Claude's `type` vocabulary does not
  // include "local", so it must NOT be added there.
  if (runtime === 'copilot') entry.type = 'local';
  return entry;
}

/**
 * Merge PAN's MCP server into an existing config object, non-destructively.
 * Foreign servers are preserved; the PAN entry is replaced wholesale so a
 * reinstall is idempotent and a path change takes effect.
 *
 * @param {object|null} existing - parsed config, or null when absent/unusable
 * @param {string} runtime
 * @param {object} entry - from buildMcpServerEntry
 * @param {string} [serverName='pan'] - registration key
 * @returns {object} merged config to serialize
 */
function mergeMcpRegistration(existing, runtime, entry, serverName = 'pan') {
  const spec = MCP_REGISTRATION[runtime];
  if (!spec) throw new Error(`mergeMcpRegistration: unknown runtime "${runtime}"`);
  const config = (existing && typeof existing === 'object' && !Array.isArray(existing)) ? existing : {};
  const key = spec.key;
  if (!config[key] || typeof config[key] !== 'object' || Array.isArray(config[key])) config[key] = {};
  config[key][serverName] = entry;
  return config;
}

/**
 * Remove PAN's MCP server from a config object, preserving foreign entries.
 * Empties the container key when PAN was its only member, so uninstall does not
 * leave `{"mcpServers":{}}` behind.
 *
 * @returns {{config: object, removed: boolean}}
 */
function stripMcpRegistration(existing, runtime, serverName = 'pan') {
  const spec = MCP_REGISTRATION[runtime];
  if (!spec) throw new Error(`stripMcpRegistration: unknown runtime "${runtime}"`);
  const config = (existing && typeof existing === 'object' && !Array.isArray(existing)) ? existing : {};
  const bag = config[spec.key];
  if (!bag || typeof bag !== 'object' || !(serverName in bag)) return { config, removed: false };
  delete bag[serverName];
  if (Object.keys(bag).length === 0) delete config[spec.key];
  return { config, removed: true };
}

/**
 * The copy-pasteable TOML a user adds by hand for Codex (register: false).
 * Emitting a snippet rather than merging is the deliberate choice recorded in
 * MCP_REGISTRATION — keep this in the shape verified at learn.chatgpt.com
 * (`[mcp_servers.NAME]` with a nested `[mcp_servers.NAME.env]` table).
 */
function buildCodexMcpSnippet(serverPath, panToolsPath, projectRoot, serverName = 'pan') {
  const lines = [
    `[mcp_servers.${serverName}]`,
    'command = "node"',
    `args = [${JSON.stringify(serverPath)}]`,
    '',
    `[mcp_servers.${serverName}.env]`,
    `PAN_TOOLS_PATH = ${JSON.stringify(panToolsPath)}`,
  ];
  if (projectRoot) lines.push(`PAN_PROJECT_ROOT = ${JSON.stringify(projectRoot)}`);
  return lines.join('\n');
}

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

  // The fourth column is Codex's `async` flag (command handlers, Codex CLI
  // 0.148+, changelog 2026-08-17): an async handler runs off the agent's critical
  // path and CANNOT block, approve, deny, or inject — its output is deferred to
  // the next turn. So it is right for pure observers and wrong for anything the
  // model must read now:
  //   - cost-logger / trace-logger append ledger rows and print nothing → async.
  //   - check-update spawns a detached child and prints nothing → async.
  //   - context-monitor returns `additionalContext` the model must see THIS
  //     turn → stays synchronous.
  // Codex-only: Claude Code and Copilot hook schemas were not checked for an
  // equivalent flag (plan item 2 gate) — do not copy this column into their
  // builders without reading their docs first.
  const wanted = [
    ['SessionStart', updateCheckCommand, 'pan-check-update', true],
    ['PostToolUse', contextMonitorCommand, 'pan-context-monitor', false],
    ['SubagentStop', costLoggerCommand, 'pan-cost-logger', true],
    ['SubagentStop', traceLoggerCommand, 'pan-trace-logger', true],
  ];

  for (const [event, command, marker, async] of wanted) {
    if (!command) continue;
    if (!Array.isArray(config.hooks[event])) config.hooks[event] = [];
    let existingHandler = null;
    for (const group of config.hooks[event]) {
      if (!Array.isArray(group.hooks)) continue;
      existingHandler = group.hooks.find(h => h && h.command && h.command.includes(marker)) || null;
      if (existingHandler) break;
    }
    if (existingHandler) {
      // Upgrade path: a hooks.json written before the async column keeps its
      // handler (and any command edits) but must pick up the flag — and lose it
      // if the column ever says synchronous. Otherwise an install upgraded from
      // 3.27 would run the observers on the critical path forever.
      if (async) existingHandler.async = true;
      else delete existingHandler.async;
      continue;
    }
    const handler = { type: 'command', command };
    if (async) handler.async = true;
    config.hooks[event].push({ hooks: [handler] });
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

// ─── Model capability detection ─────────────────────────────────────────────

/**
 * Detect model capabilities from a model name string.
 *
 * Consumer: the installer's ADVISORY model-capability notice, which warns when
 * the configured default model lacks features PAN's multi-agent workflows are
 * tuned for (1M context, extended thinking, prompt caching). It gates no
 * feature — every workflow runs regardless of what this returns.
 *
 * This is a hardcoded substring table, NOT a live capability probe. The
 * explicit branches carry the per-generation facts (capability data refreshed
 * 2026-06: Fable/Mythos 5, Opus 5/4.8/4.7/4.6 and Sonnet 5/4.6 all carry a 1M
 * context window; only the legacy Opus/Sonnet 4.0–4.5 generations are 200K).
 * Below them sits a family-level fallback so a Claude release newer than the
 * newest LEGACY release of its family — a future major (`opus-6`) or a point
 * release inside an already-tabled major (`opus-4-9`) alike — degrades to that
 * family's modern profile instead of to an all-false `unknown`. Read that
 * comment before adding another single-model branch.
 *
 * @param {string} modelName - e.g. "claude-fable-5", "claude-opus-4-8", "gpt-5"
 * @returns {{has_1m_ctx: boolean, has_thinking: boolean, has_cache: boolean, tier: string}}
 */
function detectModelCapabilities(modelName) {
  const result = { has_1m_ctx: false, has_thinking: false, has_cache: false, tier: 'unknown' };
  if (typeof modelName !== 'string' || !modelName) return result;
  const n = modelName.toLowerCase();

  // Anthropic Claude family
  if (n.includes('fable') || n.includes('mythos')) {
    return { has_1m_ctx: true, has_thinking: true, has_cache: true, tier: 'reasoning' };
  }
  // ─── Claude family + generation, parsed once ───────────────────────────────
  //
  // Read twice below: it BOUNDS the greedy legacy branches (`n.includes('opus-4')`
  // matches every Opus 4.x point release, including ones NEWER than anything this
  // table knows) and it drives the family-level fallback at the end of the
  // function. One parse feeds both on purpose — two independent parses could
  // disagree, and a name that escaped the legacy branch with nothing left to
  // catch it would fall out as the all-false `unknown`.
  //
  // Generations compare as major*1000 + point, NEVER as a float: Number('4.10')
  // === 4.1 would sort Opus 4.10 BELOW Opus 4.8. The point group takes at most
  // two digits and must not be followed by another digit, so the date suffix in
  // `claude-opus-4-20250514` is not misread as point release 20 (that id is
  // Opus 4.0 and must keep the legacy mapping).
  const genKey = (major, point) => Number(major) * 1000 + Number(point || 0);
  const famMatch = /\b(opus|sonnet|haiku)[-._]?(\d+)(?:[-.](\d{1,2})(?!\d))?/.exec(n);
  const family = famMatch ? famMatch[1] : null;
  const generation = famMatch ? genKey(famMatch[2], famMatch[3]) : -1;

  // Newest generation of each family whose REAL capabilities are lower than the
  // current flagship's: Opus/Sonnet 4.0–4.5 at 200K context, Haiku 4.x without
  // extended thinking. A release strictly newer than this is a forward release:
  // it must not inherit the legacy mapping, so the legacy branches below skip it
  // and the fallback at the end gives it its family's modern profile.
  const LEGACY_NEWEST = { opus: genKey(4, 5), sonnet: genKey(4, 5), haiku: genKey(4, 5) };
  const isForwardRelease = family !== null && generation > LEGACY_NEWEST[family];

  // Claude 5 family (Opus 5, Sonnet 5) — 1M context, extended thinking, prompt caching.
  // Without this, `claude-opus-5` falls through to `unknown` and the installer prints
  // a FALSE "your model lacks 1M context / extended thinking" warning on the flagship.
  if (n.includes('opus-5')) {
    return { has_1m_ctx: true, has_thinking: true, has_cache: true, tier: 'reasoning' };
  }
  if (n.includes('sonnet-5')) {
    return { has_1m_ctx: true, has_thinking: true, has_cache: true, tier: 'mid' };
  }
  if (n.includes('opus-4-8') || n.includes('opus-4.8')
    || n.includes('opus-4-7') || n.includes('opus-4.7')
    || n.includes('opus-4-6') || n.includes('opus-4.6')) {
    return { has_1m_ctx: true, has_thinking: true, has_cache: true, tier: 'reasoning' };
  }
  // Legacy Opus 4.0 / 4.1 / 4.5 — 200K context. `!isForwardRelease` is what stops
  // this branch swallowing a point release newer than the ones tabled above:
  // without it `claude-opus-4-9` / `claude-opus-4-10` reach here and get told
  // they lack 1M context.
  if (n.includes('opus-4') && !isForwardRelease) {
    return { has_1m_ctx: false, has_thinking: true, has_cache: true, tier: 'reasoning' };
  }
  if (n.includes('sonnet-4-6') || n.includes('sonnet-4.6')) {
    return { has_1m_ctx: true, has_thinking: true, has_cache: true, tier: 'mid' };
  }
  // Legacy Sonnet 4.0 / 4.5 — 200K context (same forward-release guard).
  if (n.includes('sonnet-4') && !isForwardRelease) {
    return { has_1m_ctx: false, has_thinking: true, has_cache: true, tier: 'mid' };
  }
  // Haiku 4.x — fast tier, no extended thinking. Guarded for the same reason,
  // though today it is behavior-neutral: the fallback's Haiku profile is
  // identical to this one, so a forward Haiku release lands on the same answer
  // either way. The guard is here so that stops being true only deliberately.
  if ((n.includes('haiku-4-5') || n.includes('haiku-4.5') || n.includes('haiku-4')) && !isForwardRelease) {
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

  // ─── Claude family-level fallback (forward compatibility) ─────────────────
  //
  // Everything above is a hardcoded substring table, so a model released AFTER
  // this file was last touched matches nothing and lands on the all-false
  // `unknown` result — at which point the installer tells the user their
  // flagship model "lacks 1M context / extended thinking", which is false and
  // actively misleading. That is the same bug the `opus-5` branch above was
  // added to fix, and fixing it one model id at a time guarantees it returns
  // with the next generation.
  //
  // POLICY — do not re-special-case a single id down here. When the name carries
  // a known Claude family AND a release strictly NEWER than that family's newest
  // LEGACY release (`LEGACY_NEWEST` at the top of this function), inherit the
  // family's modern capability profile. Rationale: a newer release of a family
  // does not ship with fewer capabilities than the one it replaces, so
  // inheriting is the safe default — under-claiming produces a false warning,
  // while inheriting at worst repeats what the previous release already had.
  //
  // The comparison is on the FULL release number, major AND point, which is what
  // makes it reach point releases inside an already-tabled major: a bare
  // major-only threshold left `opus-4-9` and `opus-4-10` to the greedy
  // `n.includes('opus-4')` branch above, and they inherited the 200K legacy
  // mapping — the exact false warning this fallback exists to prevent, on a
  // NEWER model than the flagship. Genuinely older releases (Opus/Sonnet
  // 4.0–4.5, Haiku 4.x, Claude 3.x) are at or below the threshold and keep their
  // explicit mappings untouched. Non-Claude vendors are deliberately not guessed
  // at: their branches return above, and an unmatched vendor id still yields
  // `unknown`.
  //
  // This is a safety net, not a substitute for the table: still add an explicit
  // branch above once a new release's real capabilities are known.
  //
  // `fable`/`mythos` are absent by design — their branch at the top matches the
  // family name alone, with no version in it, so it is already generation-proof.
  if (isForwardRelease) {
    const MODERN = {
      opus: { has_1m_ctx: true, has_thinking: true, has_cache: true, tier: 'reasoning' },
      sonnet: { has_1m_ctx: true, has_thinking: true, has_cache: true, tier: 'mid' },
      haiku: { has_1m_ctx: false, has_thinking: false, has_cache: true, tier: 'fast' },
    };
    return { ...MODERN[family] };
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

/**
 * Build the plugin-only self-test command that answers PAN's one gated question:
 * does `${CLAUDE_PLUGIN_ROOT}` expand inside plugin COMMAND MARKDOWN? It is
 * documented as substituted in hook and MCP configs; content is unverified, and
 * that is what has kept `dist/pan-wizard-plugin/` from being published.
 *
 * Emitted ONLY into the plugin build, never into `commands/pan/`, so the shipped
 * command set is unchanged and no install gains a diagnostic.
 *
 * THE PROBE MUST SEPARATE TWO THINGS that a naive test conflates. If the body
 * simply ran `node "${CLAUDE_PLUGIN_ROOT}/…"` and it worked, that proves nothing
 * about markdown: the shell would expand `${CLAUDE_PLUGIN_ROOT}` on its own if the
 * variable happens to be exported into the tool environment. So probe 1 asks for
 * the RAW CHARACTERS with no shell involved, probe 2 checks the environment
 * separately, and the verdict table maps the pair onto what PAN may rely on.
 *
 * @param {string} placeholder - the literal PAN rewrites content to, injected
 *   rather than hardcoded so this file stays the single source of that string.
 * @returns {string} markdown for `commands/pan-plugin-selftest.md` in the plugin
 */
function buildPluginSelfTestCommand(placeholder = '${CLAUDE_PLUGIN_ROOT}', pluginName = 'pan-wizard') {
  // Sentinels the agent quotes between. Deliberately ugly so they cannot occur
  // naturally in surrounding prose or be mistaken for instructions.
  const OPEN = 'PAN_PROBE_BEGIN>>>';
  const CLOSE = '<<<PAN_PROBE_END';
  return `---
description: Diagnose whether the plugin-root placeholder expands in plugin command markdown
---

# PAN plugin self-test

Answer four questions and print the verdict table. **Do not fix anything.** This
command is a measurement; a "fail" here is the result, not a problem to repair.

## Probe 1 — textual substitution in markdown (the question that matters)

Between the sentinels below sits one token. Report **the exact characters you see
there, verbatim**. Do not run a shell. Do not resolve, expand, guess at, or tidy
the value — if it looks like a placeholder, say so and quote it literally; if it
looks like an absolute path, quote that path.

${OPEN}${placeholder}${CLOSE}

Record it as \`probe1\`.

## Probe 2 — the environment variable, measured separately

Run exactly this and record stdout as \`probe2\` (empty output is a valid, expected result):

\`\`\`bash
node -e "process.stdout.write(process.env.CLAUDE_PLUGIN_ROOT || '')"
\`\`\`

## Probe 3 — does the engine actually resolve through the placeholder path

Run this and record whether it prints JSON or errors, as \`probe3\`:

\`\`\`bash
node "${placeholder}/pan-wizard-core/bin/pan-tools.cjs" --help
\`\`\`

## Probe 4 — do this plugin's agents and workflows load under the scoped name

The plugin ships its agents under \`${pluginName}:<agent>\` and its native workflow
scripts spawn them by that scoped name. Measure, do not assume:

- From the list of agent types available to you in this session (the Agent tool's
  own list — do not run a shell), record as \`probe4a\` how many names begin with
  \`${pluginName}:pan-\`, followed by the first three such names verbatim. If none,
  record any names that begin with \`pan-\` instead and say so.
- Record as \`probe4b\` whether a slash command named \`/${pluginName}:pan-review-pipeline\`
  is available to you. If you cannot tell, write "unknown" — that is a valid answer.

## Verdict

Print this table, filled in:

| probe | result |
|---|---|
| 1 — markdown substitution | \`probe1\` verbatim |
| 2 — env var | \`probe2\` or "(empty)" |
| 3 — engine through placeholder | ok / failed, with the error's first line |
| 4a — scoped agent names | count and first three names, or the bare names seen |
| 4b — scoped workflow command | available / not available / unknown |

Then state which case holds:

- **case A — markdown IS substituted** (probe 1 returned an absolute path). Plugin
  content may reference the plugin root directly, and PAN's existing content
  rewrite is correct as it stands. This unblocks marketplace publishing.
- **case B — markdown is NOT substituted, but the env var is set** (probe 1
  returned the literal token, probe 2 non-empty). Content must not rely on textual
  substitution; a *shell* command inside content would still work, because the
  shell expands the variable. Anything read as a path by something other than a
  shell — an \`@\` file import, for instance — would break.
  **Note:** on the one environment measured so far (Claude Code 2.1.233, Windows)
  probe 2 came back EMPTY, so this case did not occur and its shell-expansion
  premise is unverified. If you land here, confirm the variable really is visible
  to the Bash tool before relying on it — otherwise you are actually in case C.
- **case C — neither** (probe 1 literal, probe 2 empty). Plugin content cannot
  address the plugin root at all. PAN would need content that resolves paths at
  runtime instead, and marketplace publishing stays gated.

Probe 4 does not change the case letter — it measures a separate premise: the
plugin's \`workflows/\` scripts were written to spawn \`${pluginName}:pan-…\` because
plugin agents are documented to load under the scoped name. If \`probe4a\` reports
bare \`pan-…\` names and none scoped, that premise is false on this build and the
workflow scripts inside the plugin would not resolve their agents. Report it as a
separate line, exactly like \`AGENT_SCOPE: scoped\` or \`AGENT_SCOPE: bare\`.

Finish with the case letter on its own line, exactly like \`VERDICT: case A\`,
so the result is greppable out of the transcript.
`;
}

/**
 * Build the plugin's MCP registration (`.mcp.json` at the plugin root).
 *
 * Plugins may declare MCP servers in a plugin-root `.mcp.json`, and unlike
 * command markdown — where `${CLAUDE_PLUGIN_ROOT}` expansion is unverified and
 * is why marketplace publishing is still gated — hook and MCP *configs* are the
 * documented place the variable is substituted. So the same form
 * `buildPluginHooksConfig()` relies on is correct here.
 *
 * No `env` block: a plugin serves whatever project the session is in, so pinning
 * PAN_PROJECT_ROOT would be wrong, and the server resolves its engine from its
 * own location (see `defaultPanToolsPath`) with `cwd` falling back to the
 * process cwd. Nothing to configure per install.
 *
 * @returns {Object} a `.mcp.json` object for the plugin root
 */
function buildPluginMcpConfig() {
  return {
    mcpServers: {
      pan: {
        command: 'node',
        args: ['${CLAUDE_PLUGIN_ROOT}/pan-wizard-core/mcp/server.cjs'],
      },
    },
  };
}

/**
 * Rewrite the `agentType` values in a native workflow script for a PLUGIN copy.
 *
 * Plugin agents load under a scoped name: `agents/pan-reviewer.md` inside a
 * plugin named `pan-wizard` is `pan-wizard:pan-reviewer`
 * (code.claude.com/docs/en/plugins-reference, read 2026-09-10). The scripts
 * `buildNativeWorkflowScripts()` emits are written for a loose-file install,
 * where the bare name resolves, so the plugin builder runs them through this
 * before writing `workflows/`. Idempotent: an already-scoped name (contains
 * ':') is left alone, and nothing outside `agentType: '…'` is touched.
 *
 * @param {string} content - emitted script source
 * @param {string} pluginName - the manifest `name`
 * @returns {string}
 */
function namespaceWorkflowAgentTypes(content, pluginName) {
  if (typeof content !== 'string' || !pluginName) return content;
  return content.replace(/agentType:(\s*)'([^':]+)'/g,
    (_m, ws, name) => `agentType:${ws}'${pluginName}:${name}'`);
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
// twin: commands/pan/review-deep.md

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
// twin: pan-wizard-core/workflows/map-codebase.md

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

  // ── §3.2 ports (2026-09, plan item 5a). Selection rule: a protocol becomes a
  // script when its control flow is knowable BEFORE the run — a fan-out whose
  // width the engine reports, waves that are genuinely barriers. It stays
  // markdown when the next step depends on reading the last result. exec-phase's
  // wave dispatch and diagnose-issues' per-gap fan-out qualify; verify-phase and
  // milestone-gaps (single-agent judgment) do not, whatever the plan first guessed.
  // A script also cannot pause for a human (only agent permission prompts pause a
  // run), so the wave script REFUSES phases with checkpoint plans instead of
  // pretending. Each script names its markdown twin; the drift test pins the pair.
  //
  // Paths: the engine is invoked by AGENTS (scripts have no shell), so prompts
  // describe where pan-tools lives rather than hard-coding one install layout.
  const execWaves = `export const meta = {
  name: 'pan-exec-waves',
  description: 'PAN phase execution: wave-grouped executor fan-out for a checkpoint-free phase, then verification',
  whenToUse: 'Deterministic version of the /pan-exec-phase wave dispatch. Pass the phase number as args. Refuses a phase that contains checkpoint plans (a workflow cannot pause for a human) — run /pan-exec-phase for those.',
  phases: [
    { title: 'Index', detail: 'plan inventory with wave grouping, from the PAN engine' },
    { title: 'Execute', detail: 'one executor per plan; waves in order, plans within a wave in parallel' },
    { title: 'Verify', detail: 'the phase verifier over the completed plans' },
  ],
}
// twin: pan-wizard-core/workflows/exec-phase.md

const PAN_TOOLS = 'PAN engine (pan-tools): node <PAN core>/bin/pan-tools.cjs — the PAN core is .claude/pan-wizard-core in a project install, ~/.claude/pan-wizard-core in a global install, or pan-wizard-core under the plugin root when PAN runs as a plugin.'
const CORE_DOCS = 'PAN core documents (same core directory): workflows/execute-plan.md, templates/summary.md, references/checkpoints.md, references/tdd.md.'

const phaseArg = (typeof args === 'string' && args.trim())
  ? args.trim()
  : (args && typeof args === 'object' && args.phase != null ? String(args.phase) : '')
if (!phaseArg) return { error: 'pass the phase number as args, e.g. /pan-exec-waves 3' }

phase('Index')
const INDEX = {
  type: 'object',
  properties: {
    phase_found: { type: 'boolean' },
    phase_number: { type: 'string' },
    phase_name: { type: 'string' },
    phase_dir: { type: 'string' },
    parallelization: { type: 'boolean' },
    has_checkpoints: { type: 'boolean' },
    plans: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          file: { type: 'string' },
          wave: { type: 'integer' },
          autonomous: { type: 'boolean' },
          has_summary: { type: 'boolean' },
          objective: { type: 'string' },
        },
        required: ['id', 'wave', 'autonomous', 'has_summary'],
      },
    },
  },
  required: ['phase_found', 'has_checkpoints', 'plans'],
}
const index = await agent(
  'Index phase ' + phaseArg + ' for execution using the ' + PAN_TOOLS + ' Run two verbs and merge their JSON: (1) init execute-phase ' + phaseArg + ' — take phase_found, phase_number, phase_name, phase_dir, parallelization; (2) phase-plan-index ' + phaseArg + ' — take has_checkpoints and plans[] (id, wave, autonomous, has_summary, objective; include each plan file path as file). Do not execute anything; return only the merged index.',
  { label: 'index', phase: 'Index', schema: INDEX })
if (!index || !index.phase_found) return { error: 'phase ' + phaseArg + ' not found' }
if (index.has_checkpoints) {
  return { error: 'phase ' + phaseArg + ' contains checkpoint plans (autonomous: false). A workflow cannot pause for a human — run /pan-exec-phase ' + phaseArg + ' instead.', plans: index.plans.map(p => p.id) }
}
const pending = index.plans.filter(p => !p.has_summary)
if (pending.length === 0) return { phase: phaseArg, done: true, message: 'every plan already has a summary — nothing to execute' }
const waveNumbers = [...new Set(pending.map(p => p.wave))].sort((a, b) => a - b)
const parallelWithinWave = index.parallelization !== false
log(pending.length + ' plans across ' + waveNumbers.length + ' wave(s)' + (parallelWithinWave ? '' : ', sequential within waves'))

phase('Execute')
const EXEC_RESULT = {
  type: 'object',
  properties: {
    plan_id: { type: 'string' },
    status: { type: 'string', enum: ['complete', 'failed', 'checkpoint'] },
    summary_path: { type: 'string' },
    commits: { type: 'integer' },
    self_check: { type: 'string', enum: ['passed', 'failed', 'unknown'] },
    notes: { type: 'string' },
  },
  required: ['plan_id', 'status', 'self_check'],
}
const executorPrompt = (p) =>
  'Execute plan ' + p.id + ' of phase ' + (index.phase_number || phaseArg) + (index.phase_name ? '-' + index.phase_name : '') + '. Commit each task atomically. Create summary.md. Update state.md and roadmap.md (via roadmap update-plan-progress).\\n\\n'
  + 'Read first, in this order: ' + CORE_DOCS + '\\n\\n'
  + 'Then read: ' + (p.file || (index.phase_dir + '/' + p.id)) + ' (the plan), .planning/state.md, .planning/config.json (if present), ./CLAUDE.md (if present — follow its conventions), .agents/skills/ (if present — follow relevant skills), and every .planning/memory/*.md (apply every rule without exception).\\n\\n'
  + 'Report plan_id, status (complete | failed | checkpoint), summary_path, the number of commits you made, and self_check (passed if your summary carries no "Self-Check: FAILED" marker).'
const executed = []
let halted = null
for (const w of waveNumbers) {
  const wavePlans = pending.filter(p => p.wave === w)
  log('wave ' + w + ': ' + wavePlans.map(p => p.id).join(', '))
  let results
  if (parallelWithinWave) {
    results = await parallel(wavePlans.map(p => () =>
      agent(executorPrompt(p), { agentType: 'pan-executor', label: 'exec:' + p.id, phase: 'Execute', schema: EXEC_RESULT })))
  } else {
    results = []
    for (const p of wavePlans) {
      results.push(await agent(executorPrompt(p), { agentType: 'pan-executor', label: 'exec:' + p.id, phase: 'Execute', schema: EXEC_RESULT }))
    }
  }
  const settled = results.filter(Boolean)
  executed.push(...settled)
  const bad = settled.filter(r => r.status !== 'complete' || r.self_check === 'failed')
  const dropped = wavePlans.length - settled.length
  if (bad.length > 0 || dropped > 0) {
    // Mirror exec-phase's failure handler without the question it asks: stop
    // before the next wave and return what happened, so a human decides.
    halted = { wave: w, failed: bad.map(r => r.plan_id), unanswered: dropped }
    break
  }
}
if (halted) {
  return { phase: phaseArg, halted, executed, next: 'Inspect the failed plan(s), then re-run /pan-exec-waves ' + phaseArg + ' (completed plans are skipped) or fall back to /pan-exec-phase ' + phaseArg }
}

phase('Verify')
const VERIFY = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['passed', 'gaps_found', 'human_needed', 'failed'] },
    verification_path: { type: 'string' },
    gaps: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
  },
  required: ['status', 'summary'],
}
const verdict = await agent(
  'Verify phase ' + phaseArg + ' following the PAN verify-phase protocol (PAN core: workflows/verify-phase.md — ' + PAN_TOOLS + '). Check the phase goals against what the plans delivered, write the verification file the protocol prescribes, and report status (passed | gaps_found | human_needed | failed), the verification file path, any gaps, and a summary. Do not mark the phase complete or advance state — that decision stays with the user.',
  { agentType: 'pan-verifier', label: 'verify', phase: 'Verify', schema: VERIFY })

return { phase: phaseArg, waves_run: waveNumbers.length, plans_complete: executed.length, verification: verdict, next: 'Review the verification, then continue with /pan-exec-phase ' + phaseArg + ' (transition) or /pan-plan-phase for the next phase' }
`;

  const diagnoseIssues = `export const meta = {
  name: 'pan-diagnose-issues',
  description: 'PAN UAT diagnosis: one debugger per failed UAT truth, in parallel, then root causes written back',
  whenToUse: 'Deterministic version of /pan-diagnose-issues. Pass the phase number as args. Investigates only — fixes come from /pan-plan-phase --gaps.',
  phases: [
    { title: 'Gaps', detail: 'read the phase UAT file and list the failed truths' },
    { title: 'Diagnose', detail: 'one pan-debugger per gap, in parallel, root cause only' },
    { title: 'Record', detail: 'write root causes and artifacts back into the UAT gaps' },
  ],
}
// twin: pan-wizard-core/workflows/diagnose-issues.md

const PAN_TOOLS = 'PAN engine (pan-tools): node <PAN core>/bin/pan-tools.cjs — the PAN core is .claude/pan-wizard-core in a project install, ~/.claude/pan-wizard-core in a global install, or pan-wizard-core under the plugin root when PAN runs as a plugin.'

const phaseArg = (typeof args === 'string' && args.trim())
  ? args.trim()
  : (args && typeof args === 'object' && args.phase != null ? String(args.phase) : '')
if (!phaseArg) return { error: 'pass the phase number as args, e.g. /pan-diagnose-issues 3' }

phase('Gaps')
const GAPS = {
  type: 'object',
  properties: {
    phase_dir: { type: 'string' },
    uat_path: { type: 'string' },
    gaps: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          test_num: { type: 'integer' },
          truth: { type: 'string' },
          severity: { type: 'string' },
          reason: { type: 'string' },
          expected: { type: 'string' },
        },
        required: ['test_num', 'truth', 'severity'],
      },
    },
  },
  required: ['uat_path', 'gaps'],
}
const found = await agent(
  'Locate phase ' + phaseArg + ' with the ' + PAN_TOOLS + ' (find-phase ' + phaseArg + ' gives the phase directory) and read its UAT file ({phase_dir}/{phase}-uat.md). List every gap in the Gaps section whose status is failed: test number, the truth that failed, severity, the reason the user reported, and the expected behaviour from the matching test. Do not investigate anything; return the list.',
  { label: 'gaps', phase: 'Gaps', schema: GAPS })
if (!found || !found.uat_path) return { error: 'no UAT file found for phase ' + phaseArg }
const gaps = (found.gaps || []).filter(Boolean)
if (gaps.length === 0) return { phase: phaseArg, uat_path: found.uat_path, gaps: 0, message: 'no failed truths to diagnose' }
log(gaps.length + ' gap(s) to diagnose')

phase('Diagnose')
const DIAGNOSIS = {
  type: 'object',
  properties: {
    issue_id: { type: 'string' },
    status: { type: 'string', enum: ['root_cause_found', 'inconclusive'] },
    root_cause: { type: 'string' },
    evidence: { type: 'array', items: { type: 'string' } },
    files: { type: 'array', items: { type: 'string' } },
    suggested_fix: { type: 'string' },
    debug_path: { type: 'string' },
    remaining_possibilities: { type: 'array', items: { type: 'string' } },
  },
  required: ['issue_id', 'status'],
}
const diagnoses = await parallel(gaps.map(g => () => agent(
  'Debug issue UAT-' + g.test_num + ' for phase ' + phaseArg + ' — root cause ONLY, do not fix (fixes come from /pan-plan-phase --gaps).\\n\\n'
  + 'Symptoms (pre-filled from UAT, treat as given): expected: ' + (g.expected || g.truth) + '. actual: ' + (g.reason || 'not recorded') + '. reproduction: test ' + g.test_num + ' in ' + found.uat_path + '. severity: ' + g.severity + '.\\n\\n'
  + 'Follow the PAN debugger protocol: create the debug session file under .planning/debug/ named from the issue, investigate autonomously (read code, form hypotheses, test them), and report issue_id, status (root_cause_found | inconclusive), root_cause with evidence, files involved, a suggested fix direction, and the debug session path. If inconclusive, list the remaining possibilities. Also read ' + found.uat_path + ' and .planning/state.md for context.',
  { agentType: 'pan-debugger', label: 'debug:UAT-' + g.test_num, phase: 'Diagnose', schema: DIAGNOSIS })))
const results = diagnoses.filter(Boolean)
log(results.filter(r => r.status === 'root_cause_found').length + ' root cause(s) found, ' + results.filter(r => r.status === 'inconclusive').length + ' inconclusive')

phase('Record')
const RECORDED = {
  type: 'object',
  properties: { uat_path: { type: 'string' }, gaps_updated: { type: 'integer' } },
  required: ['uat_path', 'gaps_updated'],
}
const recorded = await agent(
  'Update the Gaps section of ' + found.uat_path + ' with these diagnoses, following the PAN diagnose-issues protocol: for each gap add root_cause, artifacts (the debug session path), the files involved, and the suggested fix direction; mark inconclusive ones as needing manual review with their remaining possibilities. Edit in place — do not rewrite unrelated content. Report the path and how many gaps you updated.\\n\\nDiagnoses:\\n' + JSON.stringify(results, null, 2),
  { label: 'record', phase: 'Record', schema: RECORDED })

return { phase: phaseArg, uat_path: found.uat_path, gaps: gaps.length, root_causes_found: results.filter(r => r.status === 'root_cause_found').length, inconclusive: results.filter(r => r.status === 'inconclusive').length, recorded, next: 'Run /pan-plan-phase ' + phaseArg + ' --gaps to plan the fixes' }
`;

  return [
    { name: 'pan-review-pipeline.js', content: reviewPipeline },
    { name: 'pan-map-codebase.js', content: mapCodebase },
    { name: 'pan-exec-waves.js', content: execWaves },
    { name: 'pan-diagnose-issues.js', content: diagnoseIssues },
  ];
}

// ─── AGENTS.md universal rules layer (ADR-0028 Phase 3) ─────────────────────
//
// The builders + markers live under pan-wizard-core/ (the single source of
// truth, shipped into every install) so the installer and the installed
// `pan-tools memory rebuild` regenerate byte-identical content. They are
// re-exported here so all existing installer callers and tests keep importing
// them from install-lib unchanged.

const {
  PAN_AGENTS_BEGIN,
  PAN_AGENTS_END,
  buildAgentsMdSection,
  upsertAgentsMdSection,
  removeAgentsMdSection,
  ensureClaudeMdImport,
  removeClaudeMdImport,
} = require('../pan-wizard-core/bin/lib/agents-md.cjs');

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
  PAN_SETTINGS_HOOKS,
  stripPanHookEntries,
  mergeCodexHooksConfig,
  MCP_REGISTRATION,
  buildMcpServerEntry,
  mergeMcpRegistration,
  stripMcpRegistration,
  buildCodexMcpSnippet,
  removeCodexPanHooks,
  buildNativeWorkflowScripts,
  namespaceWorkflowAgentTypes,
  rewriteUnifiedSkillCommandContent,
  rewriteSharedCoreMarkdown,
  rewriteAgentReferenceCopy,
  stripInternalLearningsTopics,
  AGENT_PLUGINS_VERSION,
  AGENT_PLUGIN_MANIFEST_SCHEMA,
  AGENT_PLUGIN_MCP_SCHEMA,
  AGENT_PLUGIN_ROOT_TOKEN,
  AGENT_PLUGIN_RUNTIME_HOME_TOKEN,
  AGENT_PLUGIN_RUNTIME_DIR_TOKEN,
  buildAgentPluginManifest,
  buildAgentPluginMcpConfig,
  agentPluginSkillAdapterNote,
  buildCopilotPluginHooksConfig,
  COPILOT_PLUGIN_NAMESPACE,
  buildPluginManifest,
  buildPluginHooksConfig,
  buildPluginMcpConfig,
  buildPluginSelfTestCommand,
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

/**
 * Content digest of a directory tree: sha256 over the sorted list of
 * `<relative posix path>:<sha256 of bytes>` lines. Order-independent, content-
 * sensitive, ignores mtimes. Used by release-check Gate 8 to refuse a stale
 * dist/pan-agent-plugin — the Codex and Copilot marketplaces install from that path
 * with no rebuild-on-resolve, so a stale bundle would ship silently (reality check
 * RC12 / plan item R10, 2026-09-10; two fresh builds were measured byte-identical).
 * Pure apart from reading the tree; throws if `dir` is not a directory.
 */
function dirDigest(dir) {
  // Local requires: install-lib keeps no module-level filesystem imports (its top
  // level is pure); this helper is the one export that reads a tree.
  const fs = require('fs');
  const path = require('path');
  const crypto = require('crypto');
  const lines = [];
  const walk = (abs, rel) => {
    const entries = fs.readdirSync(abs, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entries) {
      const childAbs = path.join(abs, e.name);
      const childRel = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(childAbs, childRel);
      else lines.push(`${childRel}:${crypto.createHash('sha256').update(fs.readFileSync(childAbs)).digest('hex')}`);
    }
  };
  walk(dir, '');
  return crypto.createHash('sha256').update(lines.join('\n')).digest('hex');
}
module.exports.dirDigest = dirDigest;
