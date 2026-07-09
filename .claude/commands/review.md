Review the current code changes:

## ⛔ Self-Protection Gate

This is the PAN Wizard SOURCE REPOSITORY. These reviews are for PAN development code.

---

1. Check git diff to see what's changed:
   ```powershell
   git status
   git diff --stat
   git diff
   ```

2. Review changes for:
   - **Bugs and logic errors** in installer, core libs, commands, agents
   - **Security vulnerabilities** (OWASP top 10, especially injection in shell commands)
   - **Cross-platform compatibility** (Windows/macOS/Linux path handling)
   - **All 5 runtime targets** (claude, codex, gemini, opencode, github) handled consistently
   - **Code style consistency** (CommonJS patterns, consistent error handling)
   - **Test coverage** — are new features covered by tests?
   - **Self-install protection** — changes don't weaken the PAN_SOURCE_ROOT guard

3. Check for PAN-specific concerns:
   - Commands/agents are runtime-agnostic (no PAN-specific hardcoding in shipped content)
   - Installer handles all 5 runtimes with proper path mapping
   - Pure functions in `install-lib.cjs` remain side-effect free
   - Hook scripts copy cleanly to `hooks/dist/` (copy-only, no bundler)

4. Run tests to validate:
   ```powershell
   npm test
   ```

5. Suggest improvements if needed
