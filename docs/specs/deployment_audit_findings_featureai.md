# Deployment Integrity & Post-Install Validation — Feature Specification

**Generated:** 2026-03-09
**Version:** 1.0
**Status:** Proposed
**Source:** Deployment audit of d:\pantesting (PAN v2.8.0, Claude Code runtime)

---

## Problem Statement

A real-world deployment audit of PAN Wizard v2.8.0 revealed gaps in installation integrity tracking, post-install guidance, and self-validation tooling. Specifically:

1. **Hook files are not tracked in the manifest.** The 3 hook scripts (`pan-check-update.js`, `pan-context-monitor.js`, `pan-statusline.js`) exist on disk but are absent from `pan-file-manifest.json`. This means user modifications to hooks are invisible during upgrades — `saveLocalPatches()` cannot detect or preserve them, and the update process silently overwrites customized hooks.

2. **No post-install self-validation.** After installation the user gets "Done! Run /pan:new-project" but there is no programmatic way to verify the installation succeeded. If a file copy failed silently, anti-virus quarantined a `.cjs` file, or a partial install occurred, the user discovers it only when a command crashes at runtime.

3. **No built-in deployment audit.** The `/pan:health` command validates `.planning/` state but has zero coverage of the installation itself — core modules, settings.json hook wiring, manifest integrity, and agent/command completeness are never checked. Users who modify PAN files, run partial upgrades, or experience filesystem issues have no diagnostic tool.

4. **`audit-deployment` command has no backing workflow or CLI route.** The new command we created is prompt-only — it relies on the AI reading instructions and executing steps manually. Unlike `/pan:health` which calls `pan-tools.cjs validate health`, there is no `pan-tools.cjs validate deployment` route, making the audit non-deterministic and unrepeatable.

## Demand Evidence

| Evidence Type | Source | Finding |
|---|---|---|
| Deployment audit | d:\pantesting | 3 hook files orphaned from manifest — untracked modifications |
| Deployment audit | d:\pantesting | Fresh install has no self-test mechanism |
| Code review | install-lib.cjs | `generateManifest()` skips `hooks/` directory entirely |
| Code review | pan-tools.cjs | `validate health` route exists but no `validate deployment` route |
| Code review | settings.json | Hook paths are hardcoded strings — no validation they resolve to real files |
| User workflow | Post-install | Users must manually verify installation by running commands and hoping they work |
| Upgrade flow | saveLocalPatches() | Hook modifications are silently lost on upgrade since they aren't in the manifest |

## Success Criteria

```
SC-1: All installed files including hooks are tracked in pan-file-manifest.json with SHA256 hashes
SC-2: `pan-tools.cjs validate deployment` returns structured JSON with pass/fail for every installation component
SC-3: Post-install automatically runs a lightweight self-check and reports issues before the "Done!" message
SC-4: Settings.json hook paths are validated against actual file existence during install and health checks
SC-5: No regression in existing 1622+ tests
SC-6: Works across all 5 runtimes (Claude, Gemini, OpenCode, Codex, Copilot)
SC-7: Audit results are deterministic and reproducible (CLI-driven, not prompt-dependent)
```

## Competitive Landscape

No competing tool (Aider, Cursor, Cline, Windsurf) has post-install self-validation or deployment auditing. This is brownfield territory.

| Tool | Install Validation | Manifest Tracking | Deployment Audit |
|---|---|---|---|
| **PAN Wizard** | None | Partial (no hooks) | None (prompt-only) |
| **Aider** | pip install + import check | None | None |
| **Cursor** | Extension marketplace | None | None |
| **Cline** | Extension marketplace | None | None |
| **Windsurf** | N/A (SaaS) | N/A | N/A |

## Design

### Architecture

```
install.js (existing)
  └─ NEW: runPostInstallValidation(configDir, runtime)
       ├─ verifyAllManifestFiles(configDir)
       ├─ verifySettingsHookPaths(configDir, runtime)
       └─ output summary or warnings

pan-tools.cjs → 'validate' → 'deployment' case (NEW)
  └─ verify.cjs: cmdValidateDeployment(cwd, raw, args)
       ├─ loadManifest(configDir)
       ├─ verifyAllHashes(configDir, manifest)
       ├─ findOrphanedFiles(configDir, manifest)
       ├─ verifySettingsIntegrity(configDir, runtime)
       ├─ verifyAgentCompleteness(configDir)
       ├─ verifyCommandCompleteness(configDir, runtime)
       └─ output(result, raw, summary)

generateManifest() (existing, modified)
  └─ CHANGE: Include hooks/ directory in file manifest
```

### Command Interface

```
pan-tools.cjs validate deployment [--fix]

Output (JSON):
{
  "status": "healthy" | "degraded" | "broken",
  "version": "2.8.0",
  "runtime": "claude",
  "checks": {
    "manifest_files": { "total": 157, "present": 157, "missing": 0 },
    "hash_integrity": { "verified": 157, "modified": 0, "files": [] },
    "orphaned_files": { "count": 0, "files": [] },
    "hooks": { "registered": 3, "files_exist": 3, "paths_valid": true },
    "agents": { "expected": 12, "found": 12 },
    "commands": { "expected": 40, "found": 40 },
    "core_modules": { "expected": 16, "found": 16 },
    "workflows": { "min": 25, "found": 31 },
    "templates": { "min": 20, "found": 27 },
    "references": { "min": 10, "found": 13 }
  },
  "errors": [],
  "warnings": [],
  "fixable_count": 0,
  "summary": "deployment: healthy — 157 files verified, 0 issues"
}
```

### Post-Install Self-Check

Added to `install.js` after the "Done!" message:

```javascript
// Lightweight self-check (< 100ms)
const selfCheck = verifyInstallation(configDir, runtime);
if (selfCheck.errors.length > 0) {
  console.log(`\n  ⚠ ${selfCheck.errors.length} issue(s) detected:`);
  selfCheck.errors.forEach(e => console.log(`    • ${e}`));
  console.log(`\n  Run: node ${configDir}/pan-wizard-core/bin/pan-tools.cjs validate deployment`);
}
```

### Error Handling

| Condition | Behavior |
|---|---|
| No manifest file | Return "broken" with instruction to reinstall |
| Corrupt manifest JSON | Return "broken" with instruction to reinstall |
| Missing hook files | Return "degraded" with list + fix instructions |
| Modified PAN files | Return "healthy" with info about modifications |
| Wrong runtime detected | Try all runtimes, report whichever matches |

## Feature Ladder

| Version | Scope | Value | Effort |
|---|---|---|---|
| **v0 (MVP)** | Include hooks in manifest + `validate deployment` CLI + post-install self-check | Deterministic deployment validation | S-M (14 pts) |
| **v1** | Settings.json deep validation + cross-runtime audit + `--fix` flag | Self-healing deployments | M (12 pts) |
| **v2** | Deployment health dashboard in statusline + scheduled re-validation hook | Continuous deployment health | M (10 pts) |

## Implementation Tasks

| # | ID | Title | Files | Effort | Pts | Priority |
|---|---|---|---|---|---|---|
| 1 | A.1 | Include hooks in generateManifest | install-lib.cjs, install.js | XS | 1 | P1 |
| 2 | A.2 | cmdValidateDeployment function | pan-wizard-core/bin/lib/verify.cjs | M | 4 | P1 |
| 3 | A.3 | Route validate deployment in dispatcher | pan-wizard-core/bin/pan-tools.cjs | XS | 1 | P1 |
| 4 | A.4 | Post-install self-check in installer | bin/install.js | S | 2 | P1 |
| 5 | A.5 | Settings.json hook path validation | pan-wizard-core/bin/lib/verify.cjs | S | 2 | P2 |
| 6 | A.6 | Agent/command completeness checks | pan-wizard-core/bin/lib/verify.cjs | S | 2 | P2 |
| 7 | A.7 | Audit-deployment workflow (backing) | pan-wizard-core/workflows/audit-deployment.md | S | 2 | P2 |
| 8 | A.8 | Test suite (25+ tests) | tests/deployment-audit.test.cjs | M | 4 | P1 |
| 9 | A.9 | Cross-runtime audit support | pan-wizard-core/bin/lib/verify.cjs | M | 3 | P3 |
| 10 | A.10 | Documentation | README, USER-GUIDE, CLI-REFERENCE, CHANGELOG | S | 2 | P3 |

**Total: 23 points (v0+v1 MVP)**

### Dependency Graph

```
A.1 (Manifest hooks) ──> A.2 (Validate cmd) ──> A.3 (Dispatcher route)
                                    │
                                    ├──> A.5 (Settings validation)
                                    ├──> A.6 (Completeness checks)
                                    └──> A.8 (Tests)

A.4 (Post-install check) ── standalone, uses A.2 internally

A.7 (Workflow) ── standalone, wraps A.3

A.9 (Cross-runtime) ──> depends on A.2 + A.6
A.10 (Docs) ──> after A.2, A.3, A.4
```

## Test Plan

### Test Pyramid

| Level | Count | What It Catches |
|---|---|---|
| Unit | 12+ | Manifest generation with hooks, hash verification, orphan detection, settings validation |
| Integration | 8+ | Full validate deployment JSON output, --fix flag, missing files, corrupt manifest |
| E2E | 5+ | Real install → validate → modify → re-validate → fix cycle |

### Key Test Cases

1. generateManifest includes hooks/ directory files
2. generateManifest hook hashes match actual file content
3. cmdValidateDeployment: clean install → "healthy"
4. cmdValidateDeployment: missing core module → "broken"
5. cmdValidateDeployment: missing hook → "degraded"
6. cmdValidateDeployment: hash mismatch → reported as "modified"
7. cmdValidateDeployment: orphaned files detected
8. cmdValidateDeployment: corrupt manifest → "broken"
9. cmdValidateDeployment: no manifest → "broken" with reinstall instruction
10. cmdValidateDeployment: settings.json missing hook entry → warning
11. cmdValidateDeployment: settings.json hook path points to nonexistent file → error
12. cmdValidateDeployment: agent count < 12 → warning
13. cmdValidateDeployment: command count < expected → warning
14. Post-install self-check: clean install → no warnings
15. Post-install self-check: simulated missing file → warning printed
16. --fix flag: regenerates missing settings.json
17. --fix flag: does NOT regenerate missing core modules (reinstall required)
18. Cross-runtime: Claude config dir detection
19. Cross-runtime: Gemini config dir detection
20. Raw JSON output format matches schema
21. Summary string format is correct
22. Exit code 0 for healthy, 1 for broken
23. Binary/large files skipped in hash verification
24. CRLF vs LF handling in hash comparison
25. Partial install recovery path

## Security

- **Attack surface:** Read-only analysis of local files. No network calls. No code execution beyond Node.js.
- **Path safety:** All paths resolved relative to configDir with `path.resolve()` + containment check.
- **No eval/Function:** Pure file reads and hash comparisons.
- **Manifest tampering:** If manifest is tampered, hash mismatches are detected. If manifest is deleted, reported as "broken".

## Risk Register

| Risk | Probability | Impact | Mitigation |
|---|---|---|---|
| Hook hashes differ across platforms (CRLF) | Medium | Low | Normalize line endings before hashing or use git-style normalization |
| Manifest size growth with hooks | Low | Low | 3 additional entries — negligible |
| Post-install self-check slows install | Low | Low | < 100ms budget enforced via async file stats |
| False positives from AV-quarantined files | Medium | Medium | Clear error message: "file missing, check antivirus quarantine" |
| Breaking change to manifest format | Low | High | Version field in manifest already exists, add migration path |

## Sources

- PAN Wizard deployment audit of d:\pantesting (2026-03-09)
- install-lib.cjs `generateManifest()` code review
- pan-tools.cjs dispatcher code review
- settings.json hook configuration analysis
- install.js post-install flow analysis

---

*Generated by /pan:audit-deployment — 2026-03-09*
