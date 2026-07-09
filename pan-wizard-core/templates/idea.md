---
title: "<one-line idea title>"
created: "<ISO-8601>"
created_by: "<user>"
runtime_preference: claude
budget: 80
priority: medium
---

# Idea: <title>

## Problem

What user pain does this address? Be concrete — what's broken, slow, or missing today?

## Success Criteria

What does "this works" look like? List 3-5 measurable outcomes:

- SC-1: [observable, testable]
- SC-2: ...
- SC-3: ...

## Scope

| In Scope | Out of Scope |
|----------|--------------|
| ... | ... |

## Constraints

- **Tech stack:** <language, framework>
- **Dependencies:** <required libs, services>
- **Deadlines:** <if any>
- **Runtime support:** <which AI coding tools must work>
- **Performance:** <if any non-functional requirements>

## Reference Material (optional)

- @path/to/related-doc.md
- https://link/to/inspiration

## Notes (optional)

Free-form context the external agent should know — design preferences, prior
art to mimic, things explicitly to avoid.

---

> **How this is consumed:** This file is read by `/pan:experiment new <slug>`
> and copied to `<experiment-folder>/.planning/idea.md`. The experiment's
> external AI session reads it as the Phase 0 answer when scaffolding.
