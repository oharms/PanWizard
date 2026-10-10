# Verification Report Template

Template for `.planning/phases/XX-name/{phase_num}-verification.md` — phase goal verification results.

---

## File Template

```markdown
---
phase: XX-name
verified: YYYY-MM-DDTHH:MM:SSZ
# verified_commit: git rev-parse HEAD before writing this file; `pan-tools verify stale` compares against it
verified_commit: <sha>
status: passed | gaps_found | human_needed
score: N/M must-haves verified
test_gate: passed | failed | skipped
# Only for checks that could not run, with why (a skipped test gate is one): write not_checked uncommented
# not_checked:
#   - check: "tests"
#     reason: "no test script in package.json"
# Only if status: gaps_found; read by `findings record` and /pan:plan-phase --gaps: write gaps uncommented
# gaps:
#   - truth: "Observable truth that failed"
#     status: failed
#     reason: "Why it failed"
#     artifacts:
#       - path: "src/path/to/file.tsx"
#         issue: "What's wrong"
#     missing:
#       - "Specific thing to add/fix"
# Only if status: human_needed: write human_verification uncommented
# human_verification:
#   - test: "What to do"
#     expected: "What should happen"
#     why_human: "Why it cannot be verified programmatically"
# Only when the scope check (`pan-tools verify scope <phase>`) found work no plan asked for: write unrequested uncommented
# unrequested:
#   - path: "src/admin/panel.tsx"
#     what: "An admin panel no plan or requirement asked for"
---

# Phase {X}: {Name} Verification Report

**Phase Goal:** {goal from roadmap.md}
**Verified:** {timestamp}
**Status:** {passed | gaps_found | human_needed}

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | {truth from must_haves} | ✓ VERIFIED | {what confirmed it} |
| 2 | {truth from must_haves} | ✗ FAILED | {what's wrong} |
| 3 | {truth from must_haves} | ? UNCERTAIN | {why can't verify} |

**Score:** {N}/{M} truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/components/Chat.tsx` | Message list component | ✓ EXISTS + SUBSTANTIVE | Exports ChatList, renders Message[], no stubs |
| `src/app/api/chat/route.ts` | Message CRUD | ✗ STUB | File exists but POST returns placeholder |
| `prisma/schema.prisma` | Message model | ✓ EXISTS + SUBSTANTIVE | Model defined with all fields |

**Artifacts:** {N}/{M} verified

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| Chat.tsx | /api/chat | fetch in useEffect | ✓ WIRED | Line 23: `fetch('/api/chat')` with response handling |
| ChatInput | /api/chat POST | onSubmit handler | ✗ NOT WIRED | onSubmit only calls console.log |
| /api/chat POST | database | prisma.message.create | ✗ NOT WIRED | Returns hardcoded response, no DB call |

**Wiring:** {N}/{M} connections verified

## Requirements Coverage

| Requirement | Status | Blocking Issue |
|-------------|--------|----------------|
| {REQ-01}: {description} | ✓ SATISFIED | - |
| {REQ-02}: {description} | ✗ BLOCKED | API route is stub |
| {REQ-03}: {description} | ? NEEDS HUMAN | Can't verify WebSocket programmatically |

**Coverage:** {N}/{M} requirements satisfied

## Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| src/app/api/chat/route.ts | 12 | `// TODO: implement` | ⚠️ Warning | Indicates incomplete |
| src/components/Chat.tsx | 45 | `return <div>Placeholder</div>` | 🛑 Blocker | Renders no content |
| src/hooks/useChat.ts | - | File missing | 🛑 Blocker | Expected hook doesn't exist |

**Anti-patterns:** {N} found ({blockers} blockers, {warnings} warnings)

## Human Verification Required

{If no human verification needed:}
None — all verifiable items checked programmatically.

{If human verification needed:}

### 1. {Test Name}
**Test:** {What to do}
**Expected:** {What should happen}
**Why human:** {Why can't verify programmatically}

### 2. {Test Name}
**Test:** {What to do}
**Expected:** {What should happen}
**Why human:** {Why can't verify programmatically}

## Unrequested Work

{If the scope check found none:}
None: every change traces to a plan.

{Otherwise, one row per `unrequested:` entry:}

| File | What it adds | Why no plan covers it |
|------|--------------|-----------------------|
| src/admin/panel.tsx | An admin panel | No requirement mentions admin tooling |

Unrequested work is recorded, not blocking: the status does not change because of it.

## Gaps Summary

{If no gaps:}
**No gaps found.** Phase goal achieved. Ready to proceed.

{If gaps found:}

### Critical Gaps (Block Progress)

1. **{Gap name}**
   - Missing: {what's missing}
   - Impact: {why this blocks the goal}
   - Fix: {what needs to happen}

2. **{Gap name}**
   - Missing: {what's missing}
   - Impact: {why this blocks the goal}
   - Fix: {what needs to happen}

### Non-Critical Gaps (Can Defer)

1. **{Gap name}**
   - Issue: {what's wrong}
   - Impact: {limited impact because...}
   - Recommendation: {fix now or defer}

## Recommended Fix Plans

{If gaps found, generate fix plan recommendations:}

### {phase}-{next}-plan.md: {Fix Name}

**Objective:** {What this fixes}

**Tasks:**
1. {Task to fix gap 1}
2. {Task to fix gap 2}
3. {Verification task}

**Estimated scope:** {Small / Medium}

---

### {phase}-{next+1}-plan.md: {Fix Name}

**Objective:** {What this fixes}

**Tasks:**
1. {Task}
2. {Task}

**Estimated scope:** {Small / Medium}

---

## Verification Metadata

**Verification approach:** Goal-backward (derived from phase goal)
**Must-haves source:** {plan.md frontmatter | derived from roadmap.md goal}
**Automated checks:** {N} passed, {M} failed
**Human checks required:** {N}
**Total verification time:** {duration}

---
*Verified: {timestamp}*
*Verifier: Claude (subagent)*
```

---

## Guidelines

**Status values:**
- `passed` — All must-haves verified, no blockers
- `gaps_found` — One or more critical gaps found
- `human_needed` — Automated checks pass but human verification required

**Evidence types:**
- For EXISTS: "File at path, exports X"
- For SUBSTANTIVE: "N lines, has patterns X, Y, Z"
- For WIRED: "Line N: code that connects A to B"
- For FAILED: "Missing because X" or "Stub because Y"

**Severity levels:**
- 🛑 Blocker: Prevents goal achievement, must fix
- ⚠️ Warning: Indicates incomplete but doesn't block
- ℹ️ Info: Notable but not problematic

**Fix plan generation:**
- Only generate if gaps_found
- Group related fixes into single plans
- Keep to 2-3 tasks per plan
- Include verification task in each plan

---

## Example

```markdown
---
phase: 03-chat
verified: 2025-01-15T14:30:00Z
verified_commit: 4f2a9c1
status: gaps_found
score: 1/5 must-haves verified
test_gate: passed
gaps:
  - truth: "User can see existing messages"
    status: failed
    reason: "Chat.tsx renders a placeholder, not message data"
    artifacts:
      - path: "src/components/Chat.tsx"
        issue: "Returns a placeholder div and fetches nothing"
    missing:
      - "Fetch from /api/chat and render the messages"
  - truth: "User can send a message"
    status: failed
    reason: "The onSubmit handler only logs"
    artifacts:
      - path: "src/components/ChatInput.tsx"
        issue: "onSubmit calls console.log, no fetch"
    missing:
      - "POST to /api/chat on submit"
  - truth: "Sent message appears in list"
    status: failed
    reason: "No state update after send, and the API routes return hardcoded values"
    artifacts:
      - path: "src/app/api/chat/route.ts"
        issue: "GET returns [], POST returns { ok: true }, no database call"
    missing:
      - "prisma.message.findMany and create in the route handlers, and a list refresh after send"
---

# Phase 3: Chat Interface Verification Report

**Phase Goal:** Working chat interface where users can send and receive messages
**Verified:** 2025-01-15T14:30:00Z
**Status:** gaps_found

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | User can see existing messages | ✗ FAILED | Component renders placeholder, not message data |
| 2 | User can type a message | ✓ VERIFIED | Input field exists with onChange handler |
| 3 | User can send a message | ✗ FAILED | onSubmit handler is console.log only |
| 4 | Sent message appears in list | ✗ FAILED | No state update after send |
| 5 | Messages persist across refresh | ? UNCERTAIN | Can't verify - send doesn't work |

**Score:** 1/5 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/components/Chat.tsx` | Message list component | ✗ STUB | Returns `<div>Chat will be here</div>` |
| `src/components/ChatInput.tsx` | Message input | ✓ EXISTS + SUBSTANTIVE | Form with input, submit button, handlers |
| `src/app/api/chat/route.ts` | Message CRUD | ✗ STUB | GET returns [], POST returns { ok: true } |
| `prisma/schema.prisma` | Message model | ✓ EXISTS + SUBSTANTIVE | Message model with id, content, userId, createdAt |

**Artifacts:** 2/4 verified

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| Chat.tsx | /api/chat GET | fetch | ✗ NOT WIRED | No fetch call in component |
| ChatInput | /api/chat POST | onSubmit | ✗ NOT WIRED | Handler only logs, doesn't fetch |
| /api/chat GET | database | prisma.message.findMany | ✗ NOT WIRED | Returns hardcoded [] |
| /api/chat POST | database | prisma.message.create | ✗ NOT WIRED | Returns { ok: true }, no DB call |

**Wiring:** 0/4 connections verified

## Requirements Coverage

| Requirement | Status | Blocking Issue |
|-------------|--------|----------------|
| CHAT-01: User can send message | ✗ BLOCKED | API POST is stub |
| CHAT-02: User can view messages | ✗ BLOCKED | Component is placeholder |
| CHAT-03: Messages persist | ✗ BLOCKED | No database integration |

**Coverage:** 0/3 requirements satisfied

## Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| src/components/Chat.tsx | 8 | `<div>Chat will be here</div>` | 🛑 Blocker | No actual content |
| src/app/api/chat/route.ts | 5 | `return Response.json([])` | 🛑 Blocker | Hardcoded empty |
| src/app/api/chat/route.ts | 12 | `// TODO: save to database` | ⚠️ Warning | Incomplete |

**Anti-patterns:** 3 found (2 blockers, 1 warning)

## Human Verification Required

None needed until automated gaps are fixed.

## Gaps Summary

### Critical Gaps (Block Progress)

1. **Chat component is placeholder**
   - Missing: Actual message list rendering
   - Impact: Users see "Chat will be here" instead of messages
   - Fix: Implement Chat.tsx to fetch and render messages

2. **API routes are stubs**
   - Missing: Database integration in GET and POST
   - Impact: No data persistence, no real functionality
   - Fix: Wire prisma calls in route handlers

3. **No wiring between frontend and backend**
   - Missing: fetch calls in components
   - Impact: Even if API worked, UI wouldn't call it
   - Fix: Add useEffect fetch in Chat, onSubmit fetch in ChatInput

## Recommended Fix Plans

### 03-04-plan.md: Implement Chat API

**Objective:** Wire API routes to database

**Tasks:**
1. Implement GET /api/chat with prisma.message.findMany
2. Implement POST /api/chat with prisma.message.create
3. Verify: API returns real data, POST creates records

**Estimated scope:** Small

---

### 03-05-plan.md: Implement Chat UI

**Objective:** Wire Chat component to API

**Tasks:**
1. Implement Chat.tsx with useEffect fetch and message rendering
2. Wire ChatInput onSubmit to POST /api/chat
3. Verify: Messages display, new messages appear after send

**Estimated scope:** Small

---

## Verification Metadata

**Verification approach:** Goal-backward (derived from phase goal)
**Must-haves source:** 03-01-plan.md frontmatter
**Automated checks:** 2 passed, 8 failed
**Human checks required:** 0 (blocked by automated failures)
**Total verification time:** 2 min

---
*Verified: 2025-01-15T14:30:00Z*
*Verifier: Claude (subagent)*
```
