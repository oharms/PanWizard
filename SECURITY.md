# Security Policy

## Supported Versions

PAN Wizard is a fast-moving project. Only the latest minor release receives security fixes.

| Version | Supported          |
|---------|--------------------|
| 3.13.x  | :white_check_mark: |
| < 3.13  | :x: — upgrade to the latest 3.x |

Run `npm view pan-wizard version` to check the current release.

## Reporting a Vulnerability

**Do not report security issues through public GitHub issues, Discord, or pull requests.**

Use GitHub's Private Vulnerability Reporting:

1. Open https://github.com/oharms/PanWizard/security/advisories/new
2. Fill in the advisory form (description, impact, reproduction steps, suggested fix if you have one).
3. Submit — only repository maintainers can see it.

If Private Vulnerability Reporting is unavailable for any reason, open a minimal public issue saying "security disclosure — please contact me privately" without any details, and a maintainer will reach out.

## Response Timeline

- **Acknowledgment**: within 72 hours.
- **Initial assessment**: within 1 week.
- **Fix timeline** (target, not guarantee):
  - Critical (RCE, credential theft, supply chain): 24–72 hours.
  - High (privilege escalation, data exposure): 1 week.
  - Medium / Low: bundled into the next release.

## Scope

In scope:

- Code in this repository (installer, hooks, `pan-wizard-core/`, agents, commands) that could:
  - Execute arbitrary code on a user's machine.
  - Expose secrets, credentials, or session tokens.
  - Tamper with generated plans, code, or commits.
  - Escalate privileges from the runtime sandbox (Claude Code, Codex, Gemini, OpenCode, Copilot).
- The npm package `pan-wizard` published from this repo.

Out of scope:

- Vulnerabilities in third-party AI runtimes (report to Anthropic / OpenAI / Google / GitHub directly).
- Issues that require the attacker to already control the user's local filesystem or shell.
- Issues in `experiments/` — these are research artifacts, not shipped code.

## Disclosure & Credit

We coordinate disclosure with the reporter:

- Fix lands in `main`, version is bumped, advisory is published with CVE if applicable.
- Reporters are credited in the advisory and release notes unless they request anonymity.
- No bug bounty — this is a volunteer project, but every responsible disclosure gets a thank-you.

## Defensive Posture (for transparency)

- Zero runtime dependencies — supply-chain attack surface is the Node stdlib only.
- `npm audit --omit=dev` is enforced as a release gate in [scripts/release-check.js](scripts/release-check.js).
- Hooks ship via [hooks/dist/](hooks/dist/) bundled by esbuild — auditable in one place.
- The installer refuses to run inside its own source repo (`PAN_SOURCE_ROOT` guard in `bin/install.js`).
- CI runs CodeQL JavaScript analysis on every push to `main` and weekly.
- Dependabot opens PRs for npm dev-deps and GitHub Actions weekly.
