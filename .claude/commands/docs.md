# /docs - PAN Wizard Documentation Management

Manage and synchronize PAN Wizard documentation.

## ⛔ Self-Protection Gate

This is the PAN Wizard SOURCE REPOSITORY. Documentation changes go here.

---

## Usage

```
/docs              # Sync docs with implementation (default)
/docs sync         # Same as above
/docs validate     # Validate doc accuracy against code
```

## Documentation Files

| Document | Purpose |
|----------|---------|
| `README.md` | User-facing overview, install instructions |
| `CLAUDE.md` | Development rules and project structure |
| `CHANGELOG.md` | Version history |
| `CONTRIBUTING.md` | Contributor guidelines |
| `docs/USER-GUIDE.md` | End-user guide |
| `docs/ARCHITECTURE.md` | System architecture |
| `docs/CLI-REFERENCE.md` | CLI flag reference |
| `docs/INTERNALS.md` | Internal design docs |
| `docs/FAQ.md` | Frequently asked questions |
| `docs/TROUBLESHOOTING.md` | Common issues |
| `docs/HOOKS.md` | Hook system documentation |
| `docs/AGENTS.md` | Agent documentation |
| `docs/DEVELOPMENT.md` | Development guide |

---

## Mode: sync (default)

### Step 1: Identify Changes
```powershell
git log --oneline -10
git diff --name-status HEAD~5
```

Check for changes in: `bin/`, `pan-wizard-core/`, `commands/`, `agents/`, `hooks/`

### Step 2: Cross-Reference Docs

For each code change, check if corresponding docs need updating:

| Code Change | Update |
|-------------|--------|
| New CLI flag in `install.js` | `docs/CLI-REFERENCE.md`, `README.md` |
| New command in `commands/` | `docs/USER-GUIDE.md` |
| New agent in `agents/` | `docs/AGENTS.md` |
| Core lib change | `docs/INTERNALS.md`, `docs/ARCHITECTURE.md` |
| Hook change | `docs/HOOKS.md` |
| Version bump | `CHANGELOG.md`, `package.json` |
| Test change | `CLAUDE.md` (test counts) |

### Step 3: Update and Report
```
DOCS SYNC: X updated, Y current, Z need attention
```

---

## Mode: validate

Read each doc and verify claims match the actual codebase:

1. **README.md** — Install commands work? Feature claims accurate?
2. **CLI-REFERENCE.md** — All flags documented? Examples correct?
3. **Test counts** in CLAUDE.md — Match actual `npm test` output?
4. **File counts** — "42 commands", "12 agents" still accurate?

### Never Do
- Update docs without reading the code first
- Leave stale test counts or file counts
- Document features that don't exist yet
