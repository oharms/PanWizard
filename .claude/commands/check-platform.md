# /check-platform - Cross-Platform Verification

Verify PAN Wizard works across all supported platforms and runtimes.

## ⛔ Self-Protection Gate

This is the PAN Wizard SOURCE REPOSITORY. Installation testing goes to `d:\pantesting`.

---

## Steps

1. **Check platform-specific code** in `bin/install.js` and `bin/install-lib.cjs`:
   - Path separators (posix vs win32)
   - `toPosix()` usage for cross-platform paths
   - Symlink handling differences
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
   node d:\PanWizard\bin\install.js --github --local
   ```

5. **Check runtime-specific paths**:

| Runtime | Install Dir | Commands Dir | Agents Dir |
|---------|-------------|--------------|------------|
| Claude | `.claude/` | `commands/pan/` | `agents/` |
| Codex | `.codex/` | `commands/pan/` | `agents/` |
| Gemini | `.gemini/` | `commands/pan/` | `agents/` |
| OpenCode | `.opencode/` | `commands/pan/` | `agents/` |
| GitHub | `.github/` | `commands/pan/` | `agents/` |

6. **Report** any platform-specific issues found.

## Common Cross-Platform Issues

| Issue | Where to Look | Fix Pattern |
|-------|---------------|-------------|
| Path separators | `install-lib.cjs` | Use `toPosix()` or `path.posix` |
| Symlinks | `install.js` | Check `fs.symlink` vs copy fallback |
| Line endings | `.gitattributes` | Ensure `* text=auto` |
| Permissions | Hooks install | Check `chmod` on non-Windows |
| npm global | `--global` flag | Different paths per OS |
