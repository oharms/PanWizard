# /build - Build PAN Wizard Hooks

Copy the PAN Wizard hook scripts to `hooks/dist/`. PAN's hooks are pure Node.js with zero dependencies, so this is a copy step — there is no bundler or compile pass.

## ⛔ Self-Protection Gate

This is the PAN Wizard SOURCE REPOSITORY. NEVER run `node bin/install.js` from here.
Installation testing goes to `d:\pantesting`.

---

## Steps

1. **Read CLAUDE.md** for current build context
2. **Build hooks** (the only build step):

```powershell
npm run build:hooks
```

3. **Verify outputs exist** in `hooks/dist/`:
   - `pan-check-update.js`
   - `pan-context-monitor.js`
   - `pan-statusline.js`

4. **Check timestamps** to confirm fresh build:

```powershell
Get-ChildItem hooks/dist/*.js | Select-Object Name, LastWriteTime, Length
```

5. **Run quick tests** to verify nothing broke:

```powershell
npm test
```

6. Report build status and any errors.

## If Build Fails

1. Check `scripts/build-hooks.js` for the list of hooks it copies
2. Verify source hooks exist in `hooks/*.js`
3. Confirm `hooks/dist/` is writable
