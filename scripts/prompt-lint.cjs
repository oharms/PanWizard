#!/usr/bin/env node
'use strict';
/**
 * Prompt-contract lint (program L2): the contract a shipped prompt has with the
 * engine and the host, checked in code. Applied to commands/pan, agents and
 * pan-wizard-core/workflows by tests/prompt-lint.test.cjs, with
 * tests/fixtures/prompt-lint-allowlist.json (every entry names its reason, usually
 * the plan item that fixes it).
 *
 *   unknown-verb        a `pan-tools <verb> [<sub>]` call naming a verb or a subcommand
 *                       the engine does not have (tests/fixtures/surface.json)
 *   tool-not-granted    an agent told to use a tool its frontmatter `tools:` does not grant
 *   pasted-source       an @-include of engine source (`*.cjs` / `*.js`) into a prompt
 *   oversized-question  an AskUserQuestion block offering more than four options (the
 *                       host's limit: two to four)
 *   untyped-spawn       a Task( spawn without `model=`, or a general-purpose spawn told
 *                       to read a role file instead of naming the agent type
 *   dev-skill           a shipped prompt sending the user to a dev-only skill of this
 *                       repository (.claude/commands/*.md), which no install carries
 *
 *   node scripts/prompt-lint.cjs            # report the current tree, exit 1 on a finding
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const TOOLS = ['Write', 'Edit', 'WebSearch', 'WebFetch', 'Task'];

function surface(root = ROOT) {
  const s = JSON.parse(fs.readFileSync(path.join(root, 'tests', 'fixtures', 'surface.json'), 'utf8'));
  const subs = new Map();
  for (const entry of s.subcommands) {
    const [verb, sub] = entry.split(' ');
    if (!subs.has(verb)) subs.set(verb, new Set());
    subs.get(verb).add(sub);
  }
  return { verbs: new Set(s.verbs), subs };
}

function devSkills(root = ROOT) {
  try {
    return fs.readdirSync(path.join(root, '.claude', 'commands')).filter((f) => f.endsWith('.md')).map((f) => f.replace(/\.md$/, ''));
  } catch { return []; }
}

const lineOf = (text, index) => text.slice(0, index).split('\n').length;

function frontmatterTools(text) {
  const fm = text.match(/^---\n([\s\S]*?)\n---/);
  if (!fm) return null;
  const m = fm[1].match(/^tools:[ \t]*(.+)$/m);
  return m ? new Set(m[1].split(',').map((t) => t.trim().replace(/\*$/, '')).filter(Boolean)) : null;
}

/**
 * Lint one file's text.
 * @param {string} rel - repository-relative path (decides which rules apply)
 * @param {string} raw - file content
 * @param {{verbs: Set, subs: Map, dev: string[]}} ctx
 * @returns {Array<{rule, file, line, text}>}
 */
function lintText(rel, raw, ctx) {
  const text = raw.replace(/\r\n/g, '\n');
  const out = [];
  const hit = (rule, index, snippet) => out.push({ rule, file: rel, line: lineOf(text, index), text: String(snippet).trim().slice(0, 140) });

  // unknown-verb
  // An invocation, not prose: the script path (`pan-tools.cjs <verb>`) or a backticked `pan-tools <verb>`.
  const callRe = /(?:pan-tools\.cjs"?|`pan-tools)[ \t]+([a-z][a-z0-9-]*)(?:[ \t]+([a-z][a-z0-9-]*))?/g;
  let m;
  while ((m = callRe.exec(text))) {
    const [, verb, sub] = m;
    if (!ctx.verbs.has(verb)) { hit('unknown-verb', m.index, m[0]); continue; }
    const known = ctx.subs.get(verb);
    if (known && sub && !known.has(sub) && !ctx.verbs.has(sub)) hit('unknown-verb', m.index, m[0]);
  }

  // pasted-source
  const incRe = /^@\S+\.(?:cjs|mjs|js)\s*$/gm;
  while ((m = incRe.exec(text))) hit('pasted-source', m.index, m[0]);

  // tool-not-granted (agents only)
  if (rel.startsWith('agents/')) {
    const granted = frontmatterTools(text);
    if (granted) {
      for (const tool of TOOLS) {
        if (granted.has(tool)) continue;
        const re = new RegExp(`\\b(?:use|using|with|via|call|run)\\s+(?:the\\s+)?\`?${tool}\`?(?:\\s+tool)?\\b|\\bthe\\s+\`?${tool}\`?\\s+tool\\b`, 'g');
        let mm;
        while ((mm = re.exec(text))) {
          // "Never use Edit or Write tools" is the rule being kept, not broken.
          const before = text.slice(Math.max(0, mm.index - 24), mm.index).toLowerCase();
          if (/\b(never|not|don't|do not|no)\s*$/.test(before)) continue;
          hit('tool-not-granted', mm.index, `${tool} (granted: ${[...granted].join(', ')}): ${mm[0]}`);
          break;
        }
      }
    }
  }

  // oversized-question
  const askRe = /AskUserQuestion/g;
  while ((m = askRe.exec(text))) {
    const window = text.slice(m.index, m.index + 6000);
    const optRe = /options\s*:\s*\[/g;
    let o;
    while ((o = optRe.exec(window))) {
      let depth = 0;
      let end = -1;
      for (let i = o.index + o[0].length - 1; i < window.length; i++) {
        if (window[i] === '[') depth++;
        else if (window[i] === ']') { depth--; if (depth === 0) { end = i; break; } }
      }
      if (end < 0) break;
      const labels = (window.slice(o.index, end).match(/\blabel\s*:/g) || []).length;
      if (labels > 4) hit('oversized-question', m.index + o.index, `${labels} options in one question`);
      optRe.lastIndex = end;
    }
    askRe.lastIndex = m.index + 1;
  }

  // untyped-spawn (workflows and commands)
  if (!rel.startsWith('agents/')) {
    const lines = text.split('\n');
    lines.forEach((l, i) => {
      if (!/^\s*Task\(/.test(l)) return;
      let j = i;
      while (j < lines.length - 1 && !/^\s*\)\s*$/.test(lines[j]) && !/description="[^"]*"\s*\)\s*$/.test(lines[j])) j++;
      const block = lines.slice(i, j + 1).join('\n');
      const at = lines.slice(0, i).join('\n').length + 1;
      if (!/\bmodel\s*=/.test(block)) hit('untyped-spawn', at, 'a Task( spawn without model=');
      else if (/subagent_type="general-purpose"/.test(block) && /agents\/pan-[a-z-]+\.md for your role/.test(block)) hit('untyped-spawn', at, 'general-purpose spawn told to read a role file');
    });
  }

  // dev-skill
  if (ctx.dev.length) {
    // Every regex metacharacter escaped, backslash included (inline: CodeQL does not follow a helper).
    const names = ctx.dev.map((d) => d.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&'));
    const devRe = new RegExp(`(^|[\\s\`'"(])/(${names.join('|')})(?=[\\s\`'".,;:)]|$)`, 'gm');
    while ((m = devRe.exec(text))) hit('dev-skill', m.index + m[1].length, m[0]);
  }
  return out;
}

/** The shipped prompt files, repository-relative. */
function shippedPrompts(root = ROOT) {
  const list = [];
  for (const dir of ['commands/pan', 'agents', 'pan-wizard-core/workflows']) {
    for (const f of fs.readdirSync(path.join(root, dir)).filter((x) => x.endsWith('.md')).sort()) list.push(`${dir}/${f}`);
  }
  return list;
}

function lintTree(root = ROOT) {
  const ctx = { ...surface(root), dev: devSkills(root) };
  return shippedPrompts(root).flatMap((rel) => lintText(rel, fs.readFileSync(path.join(root, rel), 'utf8'), ctx));
}

if (require.main === module) {
  const findings = lintTree();
  for (const f of findings) process.stdout.write(`${f.rule} ${f.file}:${f.line} — ${f.text}\n`);
  process.stdout.write(`${findings.length} finding(s)\n`);
  process.exitCode = findings.length ? 1 : 0;
}

module.exports = { lintText, lintTree, shippedPrompts, surface, devSkills, frontmatterTools };
