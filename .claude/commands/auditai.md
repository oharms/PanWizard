# /auditai - Deep Feature Audit

Audit a PAN Wizard feature for completeness and correctness: $ARGUMENTS

## ⛔ Self-Protection Gate

This is the PAN Wizard SOURCE REPOSITORY. Audits examine source code here.
Installation verification goes to `d:\pantesting`.

---

## MANDATORY: Complete All Phases Without Asking

Execute ALL phases automatically. Do NOT stop to ask questions.

---

## Phase 1: Feature Identification

1. Parse $ARGUMENTS to identify the feature to audit
2. Document scope:
   - Feature name and location
   - Related files (installer, core libs, commands, agents, tests)
   - Claimed status from docs

## Phase 2: Code Verification

**Trust nothing. Verify everything.**

### 2.1 File Existence Check
For each claimed implementation file:
```
| Claimed File | Exists? | Lines | Non-Empty? |
|--------------|---------|-------|------------|
```

### 2.2 Code Substance Check
Verify real implementation, not stubs:
- Not just `// TODO` or empty functions
- Has actual business logic
- Handles edge cases
- Has error handling where appropriate

### 2.3 Test Coverage Check
For the feature, verify:
- Unit tests exist in `tests/*.test.cjs`
- Tests actually exercise the feature (not just import it)
- Tests have meaningful assertions
- Edge cases are covered

```powershell
# Run relevant tests
node --test tests/<relevant>.test.cjs
```

### 2.4 Runtime Coverage Check
Does the feature work for all 5 runtimes?
- Claude (.claude/)
- Codex (.codex/)
- Gemini (.gemini/)
- OpenCode (.opencode/)
- GitHub (.github/)

### 2.5 Install Verification
Test the feature end-to-end:
```powershell
cd d:\pantesting
node d:\PanWizard\bin\install.js --all --local
# Then verify the feature in the installed output
```

## Phase 3: Gap Analysis

Produce a checklist:
```
| Area | Status | Evidence | Action Needed |
|------|--------|----------|---------------|
| Implementation | ✅/⚠️/❌ | file:line | ... |
| Unit tests | ✅/⚠️/❌ | test file | ... |
| All runtimes | ✅/⚠️/❌ | which ones | ... |
| Documentation | ✅/⚠️/❌ | doc file | ... |
| Install works | ✅/⚠️/❌ | verified | ... |
```

## Phase 4: Enhancement Recommendations

Based on the audit, recommend:
1. Missing test cases
2. Missing runtime support
3. Documentation gaps
4. Edge cases not handled
5. Security concerns
