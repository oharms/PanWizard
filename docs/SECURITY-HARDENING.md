# Security Hardening — Manual Actions

The code changes that can land in git are now committed (CI/CodeQL/Dependabot, narrowed `.gitignore`, sanitised `.claude/settings.json`, refreshed [SECURITY.md](../SECURITY.md), esbuild upgrade). The items in this file **require a human in front of a browser or terminal** — Claude Code can't do them.

Work top-down. Each section says what to do and why.

---

## GitHub repo settings — do these in the web UI

Open https://github.com/oharms/PanWizard/settings.

### Security → Code security and analysis

| Setting | Action | Why |
|---|---|---|
| Dependency graph | Enable | Required for Dependabot alerts |
| Dependabot alerts | Enable | Email when a published vuln hits one of your deps |
| Dependabot security updates | Enable | Auto-open PRs that bump to a fixed version |
| Grouped security updates | Enable | Less PR noise (one PR per advisory group) |
| Code scanning (CodeQL) | Default → "Disable default setup" if shown | We ship our own `.github/workflows/codeql.yml` |
| Secret scanning | Enable | Catches accidental token commits already in the repo |
| **Push protection** | Enable | Blocks the push when secret patterns are detected — single best win here |
| Private vulnerability reporting | Enable | Replaces the old `security@pan-wizard.dev` email |

### Branches → Branch protection rules → `main`

Add a rule for `main` with:

- [x] Require a pull request before merging
  - Required approvals: 1 (or 0 if you're solo and want to self-merge after CI)
  - Dismiss stale pull request approvals when new commits are pushed
- [x] Require status checks to pass before merging
  - Require branches to be up to date before merging
  - Required checks (search for these once CI runs at least once):
    - `test (ubuntu-latest · node 22)`
    - `test (windows-latest · node 22)`
    - `test (macos-latest · node 22)`
    - `npm audit (production)`
    - `Analyze JavaScript`
- [x] Require signed commits — depends on local commit signing (see below)
- [x] Require linear history (optional; prevents merge commits)
- [x] Do not allow bypassing the above settings — even for admins
- [x] Restrict who can push to matching branches → leave empty (no force-push)
- [x] Allow force pushes → **OFF**
- [x] Allow deletions → **OFF**

### Actions → General

| Setting | Value |
|---|---|
| Actions permissions | "Allow `oharms` actions and reusable workflows" + "Allow actions created by GitHub" + "Allow actions from verified creators" |
| Workflow permissions | **Read repository contents and packages permissions** |
| Allow GitHub Actions to create and approve pull requests | **OFF** (Dependabot uses a separate, scoped token) |

### General → Pull Requests

- [x] Automatically delete head branches (post-merge cleanup)
- [ ] Allow merge commits — off (linear history pairs with the branch protection above)
- [x] Allow squash merging — default "Pull request title and description"
- [ ] Allow rebase merging — off (squash is cleaner for a small repo)

### Account-level

Open https://github.com/settings.

- **Two-factor authentication** → Settings → Password and authentication. Required modes:
  - TOTP app (e.g. 1Password, Aegis, Authy)
  - Hardware security key as backup (YubiKey/SoloKey/Titan) — **strongest layer**
  - Save recovery codes to an encrypted password vault, not a Notes app
- **Sessions** → Settings → Sessions → revoke anything you don't recognise
- **SSH and GPG keys** → after generating your signing key below, add the public key here under "New SSH key" → key type "Signing key"
- **Personal access tokens** → Settings → Developer settings → tokens (classic + fine-grained)
  - Delete any token you don't actively use
  - Replace any classic token with a fine-grained token scoped to `pan-wizard` only
  - Set the shortest expiry you can tolerate (30 or 60 days)

---

## Local commit signing (SSH)

Combined with branch protection's "require signed commits", a stolen PAT can no longer push commits authored as you.

```powershell
# Generate the signing key (separate from any existing auth key).
ssh-keygen -t ed25519 -C "oharms signing key" -f $env:USERPROFILE\.ssh\id_ed25519_signing

# Tell Git to use it.
git config --global gpg.format ssh
git config --global user.signingkey "$env:USERPROFILE\.ssh\id_ed25519_signing.pub"
git config --global commit.gpgsign true
git config --global tag.gpgsign true

# Tell Git which signing keys are trusted (yours).
$allowed = "$env:USERPROFILE\.ssh\allowed_signers"
"$(git config user.email) namespaces=`"git`" $(Get-Content "$env:USERPROFILE\.ssh\id_ed25519_signing.pub")" | Set-Content $allowed
git config --global gpg.ssh.allowedSignersFile $allowed
```

Add the public key (`id_ed25519_signing.pub`) to GitHub under Settings → SSH and GPG keys → **New SSH key** → Key type: **Signing Key**.

Verify with `git log --show-signature -1` after the next commit. GitHub will display a "Verified" badge on signed commits.

---

## npm publishing hardening

Only if you publish `pan-wizard` to npm. Skip if you don't.

1. **Audit existing tokens**
   ```bash
   npm token list
   ```
   Delete anything with `read+write` scope you don't actively use:
   ```bash
   npm token revoke <token-id>
   ```

2. **Enable npm 2FA for writes**
   - https://www.npmjs.com/settings/oharms/profile (substitute your username) → Two-Factor Authentication → **Auth and writes**. Forces an OTP on every `npm publish`.

3. **Create a granular token scoped to `pan-wizard` only**
   - https://www.npmjs.com/settings/oharms/tokens → Generate new token → Granular access
   - Packages: `pan-wizard` only
   - Permissions: `Read and write`
   - Expires: 90 days
   - Save to a password vault — do **not** put it in `~/.npmrc`

4. **Publish from a GitHub Action with provenance** (the recommended path — workflow is now committed at [.github/workflows/release.yml](../.github/workflows/release.yml)).

   One-time setup:

   1. **Create an Automation token on npm** — different from the granular publish tokens above. Automation tokens are designed for CI and **bypass the 2FA "Auth and writes" prompt** that would otherwise stall a non-interactive publish.
      - https://www.npmjs.com/settings/oharms/tokens → **Generate New Token** → **Automation**.
      - Name: `pan-wizard-ci-release`.
      - Expires: 90 days (set a calendar reminder to rotate).
      - Packages and scopes: select **Only select packages** → `pan-wizard`.
      - Permission: Read and write.
   2. **Store the token as a GitHub secret**: https://github.com/oharms/PanWizard/settings/secrets/actions → **New repository secret** → name `NPM_TOKEN`, paste the token value. The secret is encrypted at rest and never visible after creation, even to you. The workflow reads it via `${{ secrets.NPM_TOKEN }}`.

   How to ship a release from now on:

   ```powershell
   # 1. Bump the version (npm rewrites package.json + tags the commit).
   npm version patch    # 3.8.0 → 3.8.1   (or `minor` / `major`)

   # 2. Push commit AND the new tag together.
   git push --follow-tags
   ```

   The tag push triggers [.github/workflows/release.yml](../.github/workflows/release.yml), which:
   - Checks the tag version matches `package.json` (catches drift).
   - Reruns the full release-check (build, test:all, audit, doc-lint, pack-dryrun, smoke-install) via `prepublishOnly`.
   - Calls `npm publish --provenance --access public`.
   - The `--provenance` flag has GitHub's runner exchange a short-lived OIDC token with sigstore for a signing certificate. The resulting tarball carries a cryptographic attestation that anyone can verify against https://www.npmjs.com/package/pan-wizard.

   No token on your laptop. No token in any chat. No `.npmrc`. The whole publish surface is a tag push.

5. **Manual publish (fallback only)**
   Only if the workflow is broken or you need to ship from an offline laptop.
   ```bash
   npm publish --access public
   # Omit --provenance for manual publishes — the flag needs a workflow OIDC
   # token. You'll get the 2FA OTP prompt; have your authenticator ready.
   ```

---

## Local PC hygiene

- **Windows Defender**: Settings → Privacy & security → Windows Security → Virus & threat protection. Verify:
  - Real-time protection ON
  - Cloud-delivered protection ON
  - Automatic sample submission ON
  - Tamper protection ON
- **Updates**: Settings → Windows Update → Pause updates ≤ 0 days. Reboot weekly.
- **Browser**: enable HTTPS-only mode and an ad/script blocker (uBlock Origin).
- **gitleaks pre-commit hook** — catches secret leaks before they reach the
  remote. Installs **automatically** on every clone via the `prepare` npm
  script — you just need gitleaks itself on PATH:
  ```powershell
  winget install --id gitleaks.gitleaks
  # Inside the repo:
  npm install            # `prepare` runs scripts/install-git-hooks.js
                         # → sets core.hooksPath → scripts/git-hooks/
  ```
  The hook honours [.gitleaks.toml](../.gitleaks.toml), which narrowly allowlists
  the two confirmed false-positive patterns (SHA-256 hashes in
  `pan-file-manifest.json` and test-fixture filenames).
  Bypass once with `SKIP_GITLEAKS=1 git commit -m "..."` if you ever need to
  (creates a paper trail).
- **Secret-scan the whole history** (already clean; CI now runs this on every push):
  ```bash
  gitleaks detect --no-banner --config .gitleaks.toml --report-path d:/tmp/gitleaks-report.json
  ```

---

## Checklist — work top-down

- [ ] GitHub → Settings → Code security: Dependency graph, Dependabot alerts + security updates, secret scanning + push protection, private vulnerability reporting
- [ ] GitHub → Settings → Branches: protect `main` with the ruleset above
- [ ] GitHub → Settings → Actions: read-only default permissions, scoped allowlist
- [ ] GitHub → Settings → Account: 2FA with TOTP + hardware key, revoke unused PATs/sessions
- [ ] Local: generate SSH signing key, configure git to sign, add signing key to GitHub
- [ ] (If publishing) npm: rotate tokens to granular + 90-day expiry, enable Auth-and-writes 2FA
- [ ] Local: confirm Windows Defender tamper protection on, install gitleaks, add pre-commit hook
- [ ] Optional: enable `Require signed commits` on the `main` branch protection rule once your first signed commit lands

Track these here; come back and tick boxes as you finish them.
