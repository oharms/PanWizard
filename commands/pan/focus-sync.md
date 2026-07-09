---
name: focus-sync
group: Focus
description: Synchronize documentation after changes — check staleness and update counts
allowed-tools:
  - Read
  - Bash
  - Grep
  - Glob
  - Edit
  - Write
---

# /pan:focus-sync — Documentation Synchronization

Synchronize project documentation across all files. $ARGUMENTS

**Goal:** Detect stale documentation (wrong counts, missing commands, outdated references) and optionally fix it. Documentation should reflect the actual codebase at all times.

---

## CRITICAL: Project Scope Boundary

This command synchronizes the **host project's documentation** — NOT PAN Wizard's own infrastructure files.

**NEVER sync, modify, or report staleness in these PAN directories:**
- `.claude/`, `.github/copilot-instructions.md`, `.opencode/`, `.gemini/`, `.codex/` — PAN runtime directories
- Any `pan-wizard-core/`, `pan-tools`, agent `.md`, or command `.md` files within PAN runtime directories

**These directories are PAN's own tooling.** Documentation sync applies to the project's README, docs, guides, and code comments — not to PAN's installed agents or command definitions.

---

## Usage

```
/pan:focus-sync                  # Full sync check: report staleness
/pan:focus-sync --readme         # Check README.md only
/pan:focus-sync --docs           # Verify documentation matches implementations
/pan:focus-sync --arch           # Verify architecture docs match actual structure
/pan:focus-sync --all            # Full sync of everything + auto-fix
```

---

## Sync Operations

### README Sync
1. Read `README.md`
2. Cross-reference with `package.json` (or equivalent) for version, description
3. Verify counts mentioned in README match actual project artifacts (e.g., source modules, API endpoints, components, commands)
4. Update any stale counts or descriptions

### Documentation Sync
1. Read the project's primary documentation files (e.g., docs/, wiki, guides)
2. Verify all public features/APIs are documented
3. Verify descriptions match actual implementations
4. Flag any missing or outdated entries

### Source-to-Docs Cross-Reference
1. List the project's main source modules/components
2. Cross-reference with documentation references
3. Verify each documented feature has a corresponding implementation
4. Report orphaned documentation or undocumented features

### Architecture Sync
1. Read architecture documentation (if it exists)
2. Verify component/module/service counts match actual
3. Verify described patterns match implemented patterns
4. Flag structural drift

### CHANGELOG Sync
1. Verify latest version entry matches `package.json` (or equivalent) version
2. Check all recent features are documented

---

## Source of Truth Hierarchy

```
package.json              <- Version, description, entry points
  |
README.md                 <- Public documentation
  |
docs/USER-GUIDE.md        <- Detailed user guide
  |
CHANGELOG.md              <- Version history
```

---

## Report

Output via `pan-tools focus sync`:

```
| Area | Status | Finding |
|------|--------|---------|
| README | stale | Components: documented 12, actual 15 |
| Docs | stale | Missing 3 recently added features |
| Architecture | stale | Modules: documented 8, actual 10 |
| CHANGELOG | current | Version matches |
| Source-Docs | current | All features documented |
```
