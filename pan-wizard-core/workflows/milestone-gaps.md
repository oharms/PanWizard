<purpose>
Create all phases necessary to close gaps identified by `/pan:milestone-audit`. Reads milestone-audit.md, groups gaps into logical phases, creates phase entries in roadmap.md, and offers to plan each phase. One command creates all fix phases — no manual `/pan:add-phase` per gap.
</purpose>

<required_reading>
Read all files referenced by the invoking prompt's execution_context before starting.
</required_reading>

<process>

## 1. Load Audit Results

```bash
# Find the most recent audit file
ls -t .planning/v*-milestone-audit.md 2>/dev/null | head -1
```

Parse YAML frontmatter to extract structured gaps:
- `gaps.requirements` — unsatisfied requirements
- `gaps.integration` — missing cross-phase connections
- `gaps.flows` — broken E2E flows

If no audit file exists or has no gaps, error:
```
No audit gaps found. Run `/pan:milestone-audit` first.
```

## 2. Prioritize Gaps

Group gaps by their audit status (requirements.md records no priority; each `gaps.requirements[]` entry carries `status`):

| Status | Action |
|--------|--------|
| `unsatisfied` | Create phase, blocks milestone |
| `partial` | Create phase, recommended (the audit's FAIL gate forces `gaps_found` only for `unsatisfied` and `orphaned`) |
| `orphaned` | Create phase, blocks milestone (the audit treats an orphaned requirement as unsatisfied) |

For integration/flow gaps, take the status of the requirements they affect.

## 3. Group Gaps into Phases

Cluster related gaps into logical phases:

**Grouping rules:**
- Same affected phase → combine into one fix phase
- Same subsystem (auth, API, UI) → combine
- Dependency order (fix stubs before wiring)
- Keep phases focused: 2-4 tasks each

**Example grouping:**
```
Gap: DASH-01 unsatisfied (Dashboard doesn't fetch)
Gap: Integration Phase 1→3 (Auth not passed to API calls)
Gap: Flow "View dashboard" broken at data fetch

→ Phase 6: "Wire Dashboard to API"
  - Add fetch to Dashboard.tsx
  - Include auth header in fetch
  - Handle response, update state
  - Render user data
```

## 4. Determine Phase Numbers

Find highest existing phase:
```bash
# Get sorted phase list, extract last one
HIGHEST=$(node ~/.claude/pan-wizard-core/bin/pan-tools.cjs phases list --raw | tail -1)
```

New phases continue from there:
- If Phase 5 is highest, gaps become Phase 6, 7, 8...

## 5. Present Gap Closure Plan

```markdown
## Gap Closure Plan

**Milestone:** {version}
**Gaps to close:** {N} requirements, {M} integration, {K} flows

### Proposed Phases

**Phase {N}: {Name}**
Closes:
- {REQ-ID}: {description}
- Integration: {from} → {to}
Tasks: {count}

**Phase {N+1}: {Name}**
Closes:
- {REQ-ID}: {description}
- Flow: {flow name}
Tasks: {count}

{If partial gaps exist:}

### Recommended (partial — not one of the gaps that force the audit's `gaps_found`)

These gaps are optional. Include them?
- {gap description}
- {gap description}

---

Create these {X} phases? (yes / adjust / defer all optional)
```

Wait for user confirmation.

## 6. Update roadmap.md

Add each new phase with the CLI, which writes its checklist line (what `phase complete` ticks), its `### Phase N:` section and its directory:

```bash
node ~/.claude/pan-wizard-core/bin/pan-tools.cjs phase add "{Name}"
```

Then edit the new section: set **Goal:** to {derived from gaps being closed}, **Requirements:** to {REQ-IDs being satisfied}, and add `**Gap Closure:** Closes gaps from audit`.

## 7. Update requirements.md Traceability Table (REQUIRED)

For each REQ-ID assigned to a gap closure phase:
- Update the Phase column to reflect the new gap closure phase
- Reset Status to `Pending`

Reset checked-off requirements the audit found unsatisfied:
- Change `[x]` → `[ ]` for any requirement marked unsatisfied in the audit
- Update coverage count at top of requirements.md

```bash
# Verify traceability table reflects gap closure assignments
grep -c "Pending" .planning/requirements.md
```

## 8. Create Phase Directories

`phase add` (step 6) already created each phase's directory.

## 9. Commit Roadmap and Requirements Update

```bash
node ~/.claude/pan-wizard-core/bin/pan-tools.cjs commit "docs(roadmap): add gap closure phases {N}-{M}" --files .planning/roadmap.md .planning/requirements.md
```

## 10. Offer Next Steps

```markdown
## ✓ Gap Closure Phases Created

**Phases added:** {N} - {M}
**Gaps addressed:** {count} requirements, {count} integration, {count} flows

---

## ▶ Next Up

**Plan first gap closure phase**

`/pan:plan-phase {N}`

<sub>`/clear` first → fresh context window</sub>

---

**Also available:**
- `/pan:exec-phase {N}` — if plans already exist
- `cat .planning/roadmap.md` — see updated roadmap

---

**After all gap phases complete:**

`/pan:milestone-audit` — re-audit to verify gaps closed
`/pan:milestone-done {version}` — archive when audit passes
```

</process>

<gap_to_phase_mapping>

## How Gaps Become Tasks

**Requirement gap → Tasks:**
```yaml
gap:
  id: DASH-01
  description: "User sees their data"
  reason: "Dashboard exists but doesn't fetch from API"
  missing:
    - "useEffect with fetch to /api/user/data"
    - "State for user data"
    - "Render user data in JSX"

becomes:

phase: "Wire Dashboard Data"
tasks:
  - name: "Add data fetching"
    files: [src/components/Dashboard.tsx]
    action: "Add useEffect that fetches /api/user/data on mount"

  - name: "Add state management"
    files: [src/components/Dashboard.tsx]
    action: "Add useState for userData, loading, error states"

  - name: "Render user data"
    files: [src/components/Dashboard.tsx]
    action: "Replace placeholder with userData.map rendering"
```

**Integration gap → Tasks:**
```yaml
gap:
  from_phase: 1
  to_phase: 3
  connection: "Auth token → API calls"
  reason: "Dashboard API calls don't include auth header"
  missing:
    - "Auth header in fetch calls"
    - "Token refresh on 401"

becomes:

phase: "Add Auth to Dashboard API Calls"
tasks:
  - name: "Add auth header to fetches"
    files: [src/components/Dashboard.tsx, src/lib/api.ts]
    action: "Include Authorization header with token in all API calls"

  - name: "Handle 401 responses"
    files: [src/lib/api.ts]
    action: "Add interceptor to refresh token or redirect to login on 401"
```

**Flow gap → Tasks:**
```yaml
gap:
  name: "User views dashboard after login"
  broken_at: "Dashboard data load"
  reason: "No fetch call"
  missing:
    - "Fetch user data on mount"
    - "Display loading state"
    - "Render user data"

becomes:

# Usually same phase as requirement/integration gap
# Flow gaps often overlap with other gap types
```

</gap_to_phase_mapping>

<success_criteria>
- [ ] milestone-audit.md loaded and gaps parsed
- [ ] Gaps grouped by audit status (unsatisfied and orphaned block the milestone, partial is recommended)
- [ ] Gaps grouped into logical phases
- [ ] User confirmed phase plan
- [ ] roadmap.md updated with new phases
- [ ] requirements.md traceability table updated with gap closure phase assignments
- [ ] Unsatisfied requirement checkboxes reset (`[x]` → `[ ]`)
- [ ] Coverage count updated in requirements.md
- [ ] Phase directories created
- [ ] Changes committed (includes requirements.md)
- [ ] User knows to run `/pan:plan-phase` next
</success_criteria>
