# PAN-Z — Known Beta Risks & M0 Open Questions

ZCode is a fast-moving, closed Beta: three subsystems PAN-Z touches (subagent
frontmatter, plugin/skill layout, MCP config path) changed within a single ~12-day
window on ZCode's changelog. This ledger tracks what the design deliberately does **not**
hard-depend on, and the go/no-go facts that can only be settled on a real ZCode install
(the **M0 verify spike**). Re-check these before trusting any on-disk format.

## M0 — go/no-go (settle empirically on a real ZCode)

| # | Question | If NO → fallback (already in the design) |
|---|----------|------------------------------------------|
| 1 | Can a **subagent call MCP tools**? | Primary Agent makes every `pan-mcp` call and feeds results into subagent prompts. Determinism unaffected. |
| 2 | Are **local stdio MCP calls metered** against the MCP-Calls quota? | Read verbs are MCP *resources*, not tools; batch/cache; never make a hosted z.ai MCP load-bearing. |
| 3 | Exact **subagent frontmatter schema** / plugin layout / MCP config path? | Drive ZCode's own Import / Settings; treat `pan-zcode/lib/convert-agent.cjs` output as a labelled fallback, not a contract. |
| 4 | Any **file-based / headless** way to register an MCP server, or GUI-only? | `install-zcode.js` emits a bundle + `INSTALL-ZCODE.md`; the human finishes in ZCode's UI. |
| 5 | Any **lifecycle hook** that can hard-gate a spawn? | Enforce caps at the MCP-tool-call boundary (the orchestrator), not pre-spawn. |

## Standing constraints (confirmed by the review)

- **The merge gate is not self-sufficient.** Under ZCode Full Access, a raw Bash
  `git push` bypasses `pan_confirm_merge`. Non-bypassability rests on **server-side
  branch protection**; the MCP gate is the second, in-process lock. `INSTALL-ZCODE.md`
  mandates branch protection and "never Full Access during install."
- **No subagent nesting.** The army flattens to one delegation layer (PAN already caps
  nesting at 2, so this is tolerable). `Task` is dropped from ported subagents.
- **User-global subagents only.** No repo-scoped rosters or per-project model profiles.
- **Genuinely lost:** scheduled self-resuming multi-day campaigns (no headless/daemon),
  background execution, committable permissions, and custom slash-commands.

## Format-drift policy

Do **not** rely on a passive "write the file and hope" strategy. All three churning
formats are GUI-owned implementation details: prefer ZCode's authoring surfaces, keep the
converter output clearly labelled best-effort, and re-verify against this ledger on every
ZCode version bump.
