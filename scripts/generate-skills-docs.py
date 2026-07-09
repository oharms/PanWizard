#!/usr/bin/env python3
"""
Generate PAN Wizard skills documentation from source command files.

Reads all shipped skills (commands/pan/*.md) and dev skills (.claude/commands/*.md),
parses their YAML frontmatter and content, and produces two documents:

  docs/SKILLS-REFERENCE.md  — Organized summary with tables, descriptions, tool matrix
  docs/SKILLS-FULL-TEXT.md  — Complete unabridged prompt text of every skill

Usage:
    python scripts/generate-skills-docs.py              # from repo root
    python scripts/generate-skills-docs.py --dry-run    # preview without writing
    python scripts/generate-skills-docs.py --full-only  # only generate SKILLS-FULL-TEXT.md
    python scripts/generate-skills-docs.py --ref-only   # only generate SKILLS-REFERENCE.md
"""

import json
import os
import re
import sys
from pathlib import Path

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

REPO_ROOT = Path(__file__).resolve().parent.parent
SHIPPED_DIR = REPO_ROOT / "commands" / "pan"
DEV_DIR = REPO_ROOT / ".claude" / "commands"
PACKAGE_JSON = REPO_ROOT / "package.json"
OUT_REFERENCE = REPO_ROOT / "docs" / "SKILLS-REFERENCE.md"
OUT_FULL_TEXT = REPO_ROOT / "docs" / "SKILLS-FULL-TEXT.md"

# Group ordering for the reference doc (shipped skills)
GROUP_ORDER = [
    "Getting Started",
    "Phase Lifecycle",
    "Phase Management",
    "Focus",
    "Milestone",
    "Milestone Lifecycle",
    "Session & Progress",
    "System",
    "Community",
]

# Dev skill categorization (filename -> category)
DEV_CATEGORIES = {
    "Development Workflow": [
        "pandev", "execplan", "superplan", "featureAI", "review",
    ],
    "Testing & Verification": [
        "test", "quick", "pantest", "check", "check-platform", "auditai",
    ],
    "Documentation & Audit": [
        "doc-audit", "docs", "sync",
    ],
    "Build & Deploy": [
        "build", "run", "commit",
    ],
    "Session Management": [
        "session-start", "session-end",
    ],
}

# All tools that shipped skills can reference
ALL_TOOLS = [
    "Read", "Write", "Edit", "Bash", "Grep", "Glob",
    "Agent", "Task", "TodoWrite", "AskUserQuestion",
    "SlashCommand", "WebSearch", "WebFetch",
]

# ---------------------------------------------------------------------------
# Frontmatter parser
# ---------------------------------------------------------------------------

def parse_frontmatter(content: str) -> tuple[dict, str]:
    """Parse YAML frontmatter from markdown content.

    Returns (metadata_dict, body_after_frontmatter).
    If no frontmatter found, returns (empty dict, full content).
    """
    if not content.startswith("---"):
        return {}, content

    end = content.find("---", 3)
    if end == -1:
        return {}, content

    raw = content[3:end].strip()
    body = content[end + 3:].strip()
    meta = {}

    current_key = None
    current_list = None

    for line in raw.split("\n"):
        stripped = line.strip()
        if not stripped:
            continue

        # List item under a key
        if stripped.startswith("- ") and current_key:
            if current_list is None:
                current_list = []
            current_list.append(stripped[2:].strip())
            meta[current_key] = current_list
            continue

        # Key: value pair
        if ":" in stripped:
            # Save previous list if any
            if current_list is not None:
                current_list = None

            colon_idx = stripped.index(":")
            key = stripped[:colon_idx].strip()
            value = stripped[colon_idx + 1:].strip()

            current_key = key

            if value:
                # Strip quotes
                if value.startswith('"') and value.endswith('"'):
                    value = value[1:-1]
                elif value.startswith("'") and value.endswith("'"):
                    value = value[1:-1]
                meta[key] = value
                current_list = None
            else:
                # Value might be a list on following lines
                current_list = []
                meta[key] = current_list

    return meta, body


def extract_first_heading(body: str) -> str:
    """Extract the first # heading from the body."""
    for line in body.split("\n"):
        line = line.strip()
        if line.startswith("# "):
            return line[2:].strip()
    return ""


# ---------------------------------------------------------------------------
# Skill loading
# ---------------------------------------------------------------------------

class Skill:
    def __init__(self, filepath: Path, is_dev: bool = False):
        self.filepath = filepath
        self.is_dev = is_dev
        self.filename = filepath.stem  # e.g., "focus-auto"
        self.content = filepath.read_text(encoding="utf-8")
        self.line_count = self.content.count("\n") + (1 if not self.content.endswith("\n") else 0)
        self.meta, self.body = parse_frontmatter(self.content)

        # Derive fields
        if is_dev:
            self.name = self.meta.get("name", f"/{self.filename}")
            self.command = f"/{self.filename}"
        else:
            raw_name = self.meta.get("name", f"pan:{self.filename}")
            # Normalize to /pan: prefix
            if not raw_name.startswith("pan:") and not raw_name.startswith("/pan:"):
                self.name = f"/pan:{raw_name}"
            elif raw_name.startswith("pan:"):
                self.name = f"/{raw_name}"
            else:
                self.name = raw_name
            self.command = self.name

        self.group = self.meta.get("group", "System")
        self.description = self.meta.get("description", "")
        raw_tools = self.meta.get("allowed-tools", [])
        if isinstance(raw_tools, str):
            # Handle comma-separated format: "Read, Write, Edit"
            self.tools = [t.strip() for t in raw_tools.split(",") if t.strip()]
        elif isinstance(raw_tools, list):
            self.tools = raw_tools
        else:
            self.tools = []
        self.argument_hint = self.meta.get("argument-hint", "")
        self.heading = extract_first_heading(self.body)


def load_shipped_skills() -> list[Skill]:
    """Load all shipped skills from commands/pan/."""
    if not SHIPPED_DIR.exists():
        print(f"Warning: {SHIPPED_DIR} not found", file=sys.stderr)
        return []
    skills = []
    for f in sorted(SHIPPED_DIR.glob("*.md")):
        skills.append(Skill(f, is_dev=False))
    return skills


def load_dev_skills() -> list[Skill]:
    """Load all dev skills from .claude/commands/."""
    if not DEV_DIR.exists():
        print(f"Warning: {DEV_DIR} not found", file=sys.stderr)
        return []
    skills = []
    for f in sorted(DEV_DIR.glob("*.md")):
        skills.append(Skill(f, is_dev=True))
    return skills


def get_version() -> str:
    """Read version from package.json."""
    try:
        with open(PACKAGE_JSON, encoding="utf-8") as f:
            return json.load(f)["version"]
    except (FileNotFoundError, KeyError):
        return "unknown"


# ---------------------------------------------------------------------------
# SKILLS-FULL-TEXT.md generator
# ---------------------------------------------------------------------------

def generate_full_text(shipped: list[Skill], dev: list[Skill], version: str) -> str:
    """Generate the complete full-text document."""
    lines = []
    w = lines.append

    w("# PAN Wizard — Complete Skills Full Text")
    w("")
    w("Every skill (slash command) available in PAN Wizard, reproduced in full.")
    w("This is the actual prompt text that Claude receives when a skill is invoked.")
    w("")
    w(f"**Version:** {version}")
    w("")
    w("> Auto-generated by `scripts/generate-skills-docs.py` — do not edit manually.")
    w("> For canonical counts (commands / agents / modules / etc.), see `CLAUDE.md`.")
    w("")
    w("---")
    w("")
    w("## Part 1: Shipped Skills")
    w("")
    w("These are installed into host projects via the PAN installer.")

    for skill in shipped:
        w("")
        w("---")
        w("")
        w(f"### {skill.command} ({skill.line_count} lines)")
        w("")
        w("```markdown")
        w(skill.content.rstrip())
        w("```")
        w("")

    w("")
    w("---")
    w("")
    w("## Part 2: Dev Skills")
    w("")
    w("These exist only in the PAN source repository and are NOT shipped to end users.")

    for skill in dev:
        w("")
        w("---")
        w("")
        w(f"### {skill.command} ({skill.line_count} lines)")
        w("")
        w("```markdown")
        w(skill.content.rstrip())
        w("```")
        w("")

    return "\n".join(lines)


# ---------------------------------------------------------------------------
# SKILLS-REFERENCE.md generator
# ---------------------------------------------------------------------------

def group_skills_by(skills: list[Skill]) -> dict[str, list[Skill]]:
    """Group shipped skills by their group field."""
    groups: dict[str, list[Skill]] = {}
    for s in skills:
        groups.setdefault(s.group, []).append(s)
    return groups


def dev_category_for(filename: str) -> str:
    """Find which dev category a filename belongs to."""
    for cat, members in DEV_CATEGORIES.items():
        if filename in members:
            return cat
    return "Other"


def tools_cell(tools: list[str]) -> str:
    """Format tools list for a table cell."""
    if not tools:
        return "*(none)*"
    return ", ".join(tools)


def tool_matrix_row(skill: Skill, all_tools: list[str]) -> str:
    """Generate a tool access matrix row."""
    cells = []
    for t in all_tools:
        # Handle mcp__context7__* wildcard
        if t in skill.tools:
            cells.append("x")
        else:
            # Check for mcp prefix tools
            has_mcp = any(tool.startswith("mcp__") for tool in skill.tools)
            if t == "mcp" and has_mcp:
                cells.append("x")
            else:
                cells.append("")
    name = skill.command.replace("/pan:", "")
    return f"| {name} | " + " | ".join(cells) + " |"


def generate_reference(shipped: list[Skill], dev: list[Skill], version: str) -> str:
    """Generate the reference summary document."""
    lines = []
    w = lines.append

    w("# PAN Wizard — Skills Reference")
    w("")
    w("Complete catalog of every skill (slash command) available in PAN Wizard, organized by purpose.")
    w("Each entry shows the command, what it does, what tools it uses, and when to reach for it.")
    w("")
    w(f"**Version:** {version}")
    w("")
    w("> Auto-generated by `scripts/generate-skills-docs.py` — do not edit manually.")
    w("> For canonical counts (commands / agents / modules / etc.), see `CLAUDE.md`.")
    w("")
    w("---")
    w("")

    # ── Table of Contents ──
    grouped = group_skills_by(shipped)
    ordered_groups = [g for g in GROUP_ORDER if g in grouped]
    # Add any groups not in GROUP_ORDER
    for g in grouped:
        if g not in ordered_groups:
            ordered_groups.append(g)

    w("## Table of Contents")
    w("")
    w("- [Shipped Skills](#shipped-skills) — installed into host projects")
    for g in ordered_groups:
        anchor = g.lower().replace(" & ", "--").replace(" ", "-")
        w(f"  - [{g}](#{anchor})")
    w("- [Dev Skills](#dev-skills) — PAN source repo only")
    for cat in DEV_CATEGORIES:
        anchor = cat.lower().replace(" & ", "--").replace(" ", "-")
        w(f"  - [{cat}](#{anchor})")
    w("")
    w("---")
    w("")

    # ── Shipped Skills ──
    w("## Shipped Skills")
    w("")
    w("These are installed into host projects via the PAN installer and available to end users.")
    w("")

    for group_name in ordered_groups:
        group_skills = grouped[group_name]
        w(f"### {group_name}")
        w("")

        # Summary table
        w("| Skill | Tools | Description |")
        w("|-------|-------|-------------|")
        for s in group_skills:
            w(f"| `{s.command}` | {tools_cell(s.tools)} | {s.description} |")
        w("")

        # Individual entries
        for s in group_skills:
            w(f"#### {s.command}")
            w("")
            if s.description:
                w(s.description)
                w("")
            if s.argument_hint:
                w(f"```")
                w(f"{s.command} {s.argument_hint}")
                w(f"```")
            else:
                w(f"```")
                w(f"{s.command}")
                w(f"```")
            w("")
            w(f"**Tools:** {tools_cell(s.tools)}  ")
            w(f"**Group:** {s.group}  ")
            w(f"**Lines:** {s.line_count}")
            w("")

        w("---")
        w("")

    # ── Dev Skills ──
    w("## Dev Skills")
    w("")
    w("These exist only in the PAN source repository (`.claude/commands/`) and are NOT shipped to end users.")
    w("")

    dev_by_cat: dict[str, list[Skill]] = {}
    for s in dev:
        cat = dev_category_for(s.filename)
        dev_by_cat.setdefault(cat, []).append(s)

    for cat_name in DEV_CATEGORIES:
        if cat_name not in dev_by_cat:
            continue
        cat_skills = dev_by_cat[cat_name]
        w(f"### {cat_name}")
        w("")
        w("| Skill | Description |")
        w("|-------|-------------|")
        for s in cat_skills:
            desc = s.description or s.heading or s.filename
            w(f"| `{s.command}` | {desc} |")
        w("")

        for s in cat_skills:
            w(f"#### {s.command}")
            w("")
            desc = s.description or s.heading or ""
            if desc:
                w(desc)
                w("")
            w(f"**Lines:** {s.line_count}")
            w("")

        w("---")
        w("")

    # Handle any dev skills not in a named category
    other_skills = dev_by_cat.get("Other", [])
    if other_skills:
        w("### Other")
        w("")
        w("| Skill | Description |")
        w("|-------|-------------|")
        for s in other_skills:
            desc = s.description or s.heading or s.filename
            w(f"| `{s.command}` | {desc} |")
        w("")
        for s in other_skills:
            w(f"#### {s.command}")
            w("")
            if s.description:
                w(s.description)
                w("")
            w(f"**Lines:** {s.line_count}")
            w("")
        w("---")
        w("")

    # ── Tool Access Matrix ──
    w("## Tool Access Matrix")
    w("")
    w("Which tools each shipped skill can use:")
    w("")

    # Header
    tool_short = ["Read", "Write", "Edit", "Bash", "Grep", "Glob",
                   "Agent", "Task", "TodoWrite", "AskUser",
                   "SlashCmd", "WebSearch", "WebFetch", "mcp"]
    tool_full = ["Read", "Write", "Edit", "Bash", "Grep", "Glob",
                  "Agent", "Task", "TodoWrite", "AskUserQuestion",
                  "SlashCommand", "WebSearch", "WebFetch"]
    header = "| Skill | " + " | ".join(tool_short) + " |"
    sep = "|-------|" + "|".join([":---:" for _ in tool_short]) + "|"
    w(header)
    w(sep)

    for s in shipped:
        cells = []
        for short, full in zip(tool_short, tool_full + ["mcp"]):
            if full == "mcp":
                has_mcp = any(t.startswith("mcp__") for t in s.tools)
                cells.append("x" if has_mcp else "")
            elif full in s.tools:
                cells.append("x")
            else:
                cells.append("")
        name = s.command.replace("/pan:", "")
        w(f"| {name} | " + " | ".join(cells) + " |")

    w("")

    # ── Quick Reference ──
    w("---")
    w("")
    w("## Quick Reference — Common Workflows")
    w("")
    w("| Scenario | Skill sequence |")
    w("|----------|---------------|")
    w("| Greenfield project | `new-project` > `discuss-phase` > `plan-phase` > `exec-phase` > `verify-phase` |")
    w("| Brownfield project | `map-codebase` > `new-project` > `discuss-phase` > `plan-phase` > `exec-phase` > `verify-phase` |")
    w("| Quick bug fix | `quick` |")
    w("| Substantial ad-hoc work | `quick --full` |")
    w("| Start of day | `progress` > `resume` |")
    w("| End of day | `pause` |")
    w("| New version cycle | `milestone-done` > `milestone-new` |")
    w("| Automated from PRD | `new-project --auto @prd.md` > `plan-phase --auto` > `exec-phase` > `verify-phase` |")
    w("| Continuous improvement | `focus-auto --category <cat>` |")
    w("| Execute micro-prompts | `focus-auto --category prompts` |")
    w("| Feature investigation | `focus-design \"description\"` |")
    w("| Doc hygiene | `focus-drift-walking` or `focus-doc-audit` |")
    w("")

    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    dry_run = "--dry-run" in sys.argv
    full_only = "--full-only" in sys.argv
    ref_only = "--ref-only" in sys.argv

    version = get_version()
    shipped = load_shipped_skills()
    dev = load_dev_skills()

    print(f"PAN Wizard v{version}")
    print(f"Shipped skills: {len(shipped)} (from {SHIPPED_DIR})")
    print(f"Dev skills:     {len(dev)} (from {DEV_DIR})")
    print()

    if not ref_only:
        full_text = generate_full_text(shipped, dev, version)
        full_lines = full_text.count("\n") + 1
        if dry_run:
            print(f"[dry-run] Would write {OUT_FULL_TEXT} ({full_lines} lines)")
        else:
            OUT_FULL_TEXT.write_text(full_text, encoding="utf-8")
            print(f"Wrote {OUT_FULL_TEXT} ({full_lines} lines)")

    if not full_only:
        reference = generate_reference(shipped, dev, version)
        ref_lines = reference.count("\n") + 1
        if dry_run:
            print(f"[dry-run] Would write {OUT_REFERENCE} ({ref_lines} lines)")
        else:
            OUT_REFERENCE.write_text(reference, encoding="utf-8")
            print(f"Wrote {OUT_REFERENCE} ({ref_lines} lines)")

    print()
    print("Done.")


if __name__ == "__main__":
    main()
