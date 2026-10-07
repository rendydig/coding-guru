# Security Policy

## Reporting a vulnerability

Please **do not** open a public issue for security problems.

Use GitHub's private vulnerability reporting instead:
**[Report a vulnerability](https://github.com/rendydig/coding-guru/security/advisories/new)**
(repository **Security** tab → *Report a vulnerability*). If you cannot use that
form, open a minimal issue asking for a private channel and we will follow up.

Please include, where you can:

- a description of the issue and its impact,
- the affected version (`codingguru` extension version, and your OpenCode CLI version),
- reproduction steps or a proof of concept,
- any suggested fix.

We aim to acknowledge reports within a few days and will credit you in the
advisory unless you ask us not to.

## Supported versions

The latest released version receives security fixes. Older versions are not
patched.

## Security model (what to expect)

- **The coach is read-only.** The `codingguru-coach` and `codingguru-author`
  OpenCode agents are defined with `edit: deny` and `bash: deny`; the guarantee is
  enforced by OpenCode's permission system, not just by prompt wording. `npm run
  smoke` asserts this. Do not loosen those permissions.
- **No credentials are stored in this repository.** Provider credentials live in
  your own OpenCode configuration; CodingGuru injects its agent definitions through
  `OPENCODE_CONFIG_CONTENT`, which layers on top of your existing config.
- **The coach server is local.** `opencode serve` is bound to `127.0.0.1` on an
  ephemeral port and is never exposed to the network.
- **The coach webview is sandboxed.** Its Content-Security-Policy is
  `default-src 'none'` with a per-render nonce for scripts; markdown from the model
  is sanitised with DOMPurify.

## Handling secrets

Never commit credentials, tokens, or `.env` files. Two guards help:

- `npm run secrets` — scans the working tree with
  [secretlint](https://github.com/secretlint/secretlint).
- A `gitleaks` GitHub Action scans every push and pull request, including full
  history.

If a secret is ever committed, treat it as compromised: rotate the credential
first, then remove it from history.
