# /check-platform - Cross-Platform Verification

Verify PAN Wizard works across all supported platforms and runtimes.

## ⛔ Self-Protection Gate

This is the PAN Wizard SOURCE REPOSITORY. Installation testing goes to `d:\pantesting`.

---

## Steps

1. **Check platform-specific code** in `bin/install.js` and `bin/install-lib.cjs`:
   - Path separators (posix vs win32)
   - Forward-slash conversion (`displayPath()`, and `.replace(/\\/g, '/')` in `buildHookCommand()`); `toPosix()` lives in `pan-wizard-core/bin/lib/core.cjs`, not in the installer
   - Symlink/junction resolution in the source-repo guard (`isInsideSourceRepo()` uses `fs.realpathSync`); the installer creates no symlinks
   - Line ending normalization

2. **Run unit tests** (they use OS temp dirs, work on any platform):
   ```powershell
   npm test
   ```

3. **Run scenario tests** (installer end-to-end):
   ```powershell
   npm run test:scenarios
   ```

4. **Verify all 5 runtimes** install correctly:
   ```powershell
   cd d:\pantesting
   node d:\PanWizard\bin\install.js --claude --local
   node d:\PanWizard\bin\install.js --codex --local
   node d:\PanWizard\bin\install.js --gemini --local
   node d:\PanWizard\bin\install.js --opencode --local
   node d:\PanWizard\bin\install.js --copilot --local
   ```

5. **Check runtime-specific paths**:

| Runtime | Install Dir | Commands Dir | Agents Dir |
|---------|-------------|--------------|------------|
| Claude | `.claude/` | `commands/pan/` | `agents/` |
| Codex | `.codex/` | `.agents/skills/pan-*/` at the project root (not under `.codex/`) | `agents/` (`.toml`) |
| Gemini | `.gemini/` | `commands/pan/` (`.toml`) | `agents/` |
| OpenCode | `.opencode/` | `commands/` (flat `pan-*.md`) | `agents/` |
| Copilot | `.github/` | `skills/pan-*/` | `agents/` (`.agent.md`) |

6. **Report** any platform-specific issues found.

## Common Cross-Platform Issues

| Issue | Where to Look | Fix Pattern |
|-------|---------------|-------------|
| Path separators | `install.js`, `install-lib.cjs` | Forward slashes via `displayPath()` / `.replace(/\\/g, '/')`; `toPosix()` is in `core.cjs` |
| Symlinks | `install.js` | None created; only `isInsideSourceRepo()` resolves them (`fs.realpathSync`) |
| Line endings | `.gitattributes` | Ensure `* text=auto` |
| Permissions | Hooks install | No `chmod`: every hook command runs its script through `node` (`buildHookCommand()` builds `node "<path>"` for a global install; a local install registers `node <dir>/hooks/<hook>.js`) |
| npm global | `--global` flag | Different paths per OS |
