---
name: pan:help
group: System
description: Show available PAN commands and usage guide
---
<objective>
Display the complete PAN command reference.

Output ONLY the reference content below. Do NOT add:
- Project-specific analysis
- Git status or file context
- Next-step suggestions
- Any commentary beyond the reference
</objective>

<execution_context>
@~/.claude/pan-wizard-core/workflows/help.md
</execution_context>

<process>
Output the complete PAN command reference from @~/.claude/pan-wizard-core/workflows/help.md.
Display the reference content directly — no additions or modifications.
</process>
