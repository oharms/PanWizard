# Project Standards

Standards selected for this project. Agents reference this file during planning, execution, and verification.

{{#each standards}}
## {{name}}

**Category:** {{category}} | **Level:** {{level}}
**Reference:** {{url}}

{{description}}

### Checklist
{{#each checklist}}
- [ ] {{this}}
{{/each}}

{{/each}}

---

> **How this works:** PAN agents read this file as context during planning and verification.
> Standards guide AI decisions — they do not replace dedicated scanning tools (Semgrep, SonarQube, Snyk).
> Manage standards with `pan-tools standards select|remove|status`.
