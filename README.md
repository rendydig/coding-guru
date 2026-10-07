# CodingGuru

A VS Code / Devin Desktop extension that turns a coding goal into a step-by-step
syllabus, scaffolds a learning workspace, and coaches you through it with a
**read-only** AI agent that never touches your files.

## How it works

1. **Describe a goal** — "I want to build a Node.js + Express app with PostgreSQL."
2. **Get a syllabus** — CodingGuru generates sections and tasks, each with
   observable acceptance criteria.
3. **Get build guides** — `docs/` gets an index and one overview per section right
   away; each task's full manual (setup, step-by-step, a worked example, pitfalls) is
   written the first time you open it, then cached.
4. **Get a workspace** — a folder is created at `~/CodingGuru/<goal>/` and opened.
5. **You write the code** — in VS Code's normal explorer and editor.
6. **The coach reviews** — ask for a review of any task and get a verdict, findings,
   and the next concrete step. It never edits your files; it explains and nudges.

Two read-only [OpenCode](https://opencode.ai) agents back this: `codingguru-coach`
(coaching and reviews) and `codingguru-author` (the build manuals), both defined with
`edit: deny` and `bash: deny`, so the "never touches your files" guarantee is enforced
by OpenCode's permission system, not just by prompt wording.

## Requirements

- **OpenCode CLI** installed and on your `PATH` (developed against `1.18.34`).
  Check with `opencode --version`.
- **A model configured for OpenCode.** CodingGuru uses your OpenCode default model
  unless you set `codingguru.model`. Verify with `opencode models`.

## Install

Grab the latest `codingguru-<version>.vsix` (from the releases page, or build one with
`npm run package`), then either:

- **Extensions view** → `...` menu → *Install from VSIX…* → pick the `.vsix`, or
- **CLI**: `devin-desktop --install-extension codingguru-0.1.5.vsix`
  (`code --install-extension …` for stock VS Code)

Building and packaging from source, plus publishing to the VS Code Marketplace or the
Open VSX registry that Devin Desktop uses, is covered in
[Publishing & distribution](#publishing--distribution).

For development, press <kbd>F5</kbd> to launch an Extension Development Host.

## Usage

Open the **CodingGuru** icon in the activity bar.

| Area | What it does |
| --- | --- |
| **Get started** | Shown when the open folder is not a learning workspace; creates your first goal |
| **Syllabus** view | Your goal → sections → tasks, with status icons. Expand a task to reveal its **Build guide** |
| **Coach** view | Chat with the coach; quick actions for review / hint / explain / progress / lint |

The **Syllabus** and **Coach** views appear only when an open folder contains a
`.codingguru` directory (a CodingGuru learning workspace). In any other folder you
get the **Get started** view, whose button opens the goal wizard — or run
**CodingGuru: Create Learning Goal** from the command palette.

Work through tasks in order. Each task's **Build guide** (a child of the task in the
tree) is written on first open and then cached in `docs/` — it walks through setup, the
steps, a complete worked example, and the mistakes to avoid. Right-click it and pick
**Regenerate Build Guide** to rebuild it. When you think a task is done, hit
**Review task** (or the check icon on the tree item). The coach reads your code, checks
it against the task's acceptance criteria, and records a verdict in
`.codingguru/progress.json`.

## Commands

| Command | Description |
| --- | --- |
| `CodingGuru: Create Learning Goal` | Open the goal wizard |
| `CodingGuru: Open Learning Workspace` | Reopen a goal's folder |
| `CodingGuru: Review Task with Coach` | Review the current/selected task |
| `CodingGuru: Start Task` | Mark a task in progress |
| `CodingGuru: Mark Task Done` | Mark a task passed manually |
| `CodingGuru: Open Document` | Open a task or section build guide (also by clicking its tree item) |
| `CodingGuru: Regenerate Build Guide` | Rewrite a task's cached manual (right-click its guide in the tree) |
| `CodingGuru: Ask Coach About Progress` | Overall status update |
| `CodingGuru: Run Lint Check` | Run ESLint / `tsc --noEmit`, publish diagnostics |
| `CodingGuru: Refresh Syllabus` | Reload the tree |
| `CodingGuru: Set OpenCode Executable Path` | Open the relevant setting |
| `CodingGuru: Show Log` | Open the CodingGuru output channel |

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `codingguru.workspaceRoot` | `~/CodingGuru` | Where learning workspaces are created |
| `codingguru.opencodePath` | `opencode` | Path to the OpenCode executable |
| `codingguru.model` | *(empty)* | Model for the coach; empty uses your OpenCode default |
| `codingguru.coachAllowBash` | `false` | Let the coach *ask* to run shell commands (never auto-approved) |
| `codingguru.autoReview` | `true` | Run the linter before a task review |

## What gets created

```
~/CodingGuru/
├── opencode.json                     # only if you run OpenCode here yourself
└── my-goal/
    ├── .codingguru/
    │   ├── goal.json                 # the learning goal
    │   ├── syllabus.json             # sections + tasks
    │   ├── progress.json             # per-task status and review notes
    │   └── coach-prompt.md           # the coach persona
    ├── docs/
    │   ├── README.md                 # table of contents
    │   ├── 01-<section>.md           # section overview (written at creation)
    │   └── 01-01-<task>.md           # task build guide (written on first open)
    ├── opencode.json                 # read-only coach + author agent definitions
    ├── AGENTS.md                     # "do not write code for the learner" rules
    ├── README.md                     # the syllabus, human-readable, links into docs/
    └── … your code
```

`docs/` is safe to delete: the index and section overviews are regenerated
deterministically, and each task guide is re-authored the next time you open it.

## Architecture

- `src/opencode/` — spawns `opencode serve` (one process per active workspace) and
  talks to it with `@opencode-ai/sdk`. The coach agent is injected through
  `OPENCODE_CONFIG_CONTENT`, which layers on top of your existing OpenCode config.
- `src/syllabus/` — structured syllabus generation and workspace scaffolding.
- `src/views/` — the syllabus tree and the coach chat webview.
- `src/lint/` — runs the workspace's own ESLint/TypeScript and publishes diagnostics.

### A note on "explorer and editor in the web app"

Building a custom Monaco editor and file tree would duplicate VS Code. As an
extension, CodingGuru uses VS Code's native explorer, editor, diagnostics, and
tasks — which are better and free. The coach service is self-contained, so a
separate web UI could reuse it later if you ever want one.

## Publishing & distribution

CodingGuru is an ordinary VS Code extension, so it ships through the ordinary channels.
Pick the row that matches where you want people to get it.

| Channel | Who it reaches | How |
| --- | --- | --- |
| **VSIX file** | Anyone you hand it to; fastest loop | `npm run package`, then install the `.vsix` |
| **VS Code Marketplace** | VS Code, VS Code Insiders | `vsce publish` |
| **Open VSX Registry** | **Devin Desktop**, Windsurf, VSCodium, Gitpod | `ovsx publish` |
| **Private feed / release** | Your team, air-gapped machines | Attach the `.vsix` to a GitHub Release or an internal feed |

Devin Desktop is a VS Code fork that resolves extensions from the **Open VSX Registry**, not
the Microsoft Marketplace — a Marketplace-only release will never appear in its Extensions
panel. Publish to both registries, or hand out the `.vsix`.

### Before you package

```bash
npm install
npm run typecheck      # tsc --noEmit, extension + webview
npm run build          # esbuild → dist/extension.js + dist/webview/coach.{js,css}
npm run docs:check     # syllabus/guide rendering, no model needed
npm run secrets        # secretlint over the repo, before anything is published
npm run smoke          # only if you touched src/opencode/ — needs the OpenCode CLI
```

`vsce` runs the `vscode:prepublish` script before packaging, and here that script is
`node esbuild.js --production`. The packaged bundle is therefore always minified and
sourcemap-free, even if your last build was `npm run watch` — don't be surprised when
`dist/extension.js` shrinks after a `package`.

### What ends up in the VSIX

`npx vsce ls --tree` prints the exact file list; `.vscodeignore` decides it. For 0.1.5:

```
codingguru-0.1.5.vsix
├─ extension.vsixmanifest
├─ [Content_Types].xml
└─ extension/
   ├─ AGENTS.md
   ├─ LICENSE.txt
   ├─ README.md
   ├─ package.json
   ├─ dist/
   │  ├─ extension.js
   │  └─ webview/{coach.css,coach.js}
   └─ media/{coach.svg,guru.svg,syllabus.svg,wizard.css,wizard.js}
```

(The two entries above `extension/` are packaging metadata that `vsce` generates; everything
else is the payload, and `LICENSE` is renamed to `LICENSE.txt` inside the archive.)

`src/`, `scripts/`, `node_modules/`, `esbuild.js`, `tsconfig.json` and `*.map` are excluded,
along with the repo's own machinery: `.github/**`, `.githooks/**`, `SECURITY.md`, the
secretlint config, and anything secret-bearing (`.env*`, `*.local`, `opencode.json`,
`auth.json`). `--no-dependencies` (already in `npm run package`) is what makes excluding
`node_modules/` safe: esbuild inlines every runtime dependency into `dist/`, leaving only
`vscode` external.

**Anything the ignore file doesn't match is published**, so re-check this tree whenever you
add files at the repo root — `AGENTS.md` ships today, harmless but easily dropped.
`npx vsce ls --tree` is the authoritative answer; it reads whatever is currently in `dist/`,
so build first if you want the tree to match the artifact you're about to ship.

Secrets get a second look from `vsce` itself, which refuses to package a credential it
recognises (`--allow-package-secrets` overrides that, and you almost never want to). Run
`npm run secrets` first — it scans the repo rather than the VSIX, so a stray key never makes
it to the packaging step. [AGENTS.md](AGENTS.md) covers the pre-commit hook and the gitleaks
workflow.

### Versioning

`package.json` → `version` is the single source of truth. It names the artifact
(`codingguru-0.1.5.vsix`) and must be bumped for every release, because neither registry
will overwrite a version that already exists. `vsce publish minor` (or `major`, `patch`, or
an explicit `1.2.0`) bumps and publishes in one step, and — when run inside a git repo —
creates a version commit and tag through `npm version`.

There is no `CHANGELOG.md` yet. The Marketplace renders one from `CHANGELOG.md` at the
extension root, which is the cheapest way to make releases readable; `vsce` warns when it's
missing but still packages. `--changelog-path <path>` points at a different file.

### Build a VSIX

```bash
npm run package        # → vsce package --no-dependencies --allow-missing-repository
```

That writes `codingguru-<version>.vsix` to the repo root. The two flags exist because this
package has no `repository` field and its dependencies are already bundled; drop
`--allow-missing-repository` once you add one (see [Troubleshooting](#troubleshooting)).

Useful extras:

| Flag | Effect |
| --- | --- |
| `-o dist/codingguru.vsix` | Write the artifact somewhere else |
| `--pre-release` | Mark the build as a pre-release; users opt in via *Install Pre-Release Version* |
| `-t win32-x64` | Platform-specific package (only matters if you ship native binaries — CodingGuru doesn't) |
| `--ignoreFile .vscodeignore.ci` | Use an alternative ignore file |

### Install a VSIX

| Editor | UI | CLI |
| --- | --- | --- |
| VS Code | Extensions view → `...` → *Install from VSIX…* | `code --install-extension codingguru-0.1.5.vsix` |
| VS Code Insiders | same | `code-insiders --install-extension …` |
| Devin Desktop | Extensions view → `...` → *Install from VSIX…*, or drag the file onto the Extensions pane | `devin-desktop --install-extension codingguru-0.1.5.vsix` |
| Windsurf / Cursor / VSCodium | same | `windsurf --install-extension …` (etc.) |

Reload the window if the editor doesn't offer to. The extension ID is
`codingguru.codingguru`, so removal is
`devin-desktop --uninstall-extension codingguru.codingguru`.

### Publish to the VS Code Marketplace

1. **Create a publisher.** Sign in to the [Marketplace publisher management
   page](https://marketplace.visualstudio.com/manage) with a Microsoft account and create a
   publisher. Its **ID** must equal `publisher` in `package.json` — currently `codingguru`.
2. **Create a Personal Access Token (PAT)** in [Azure DevOps](https://dev.azure.com): user
   settings → *Personal access tokens* → *New Token*, organization **All accessible
   organizations**, scope **Marketplace → Manage**.
3. **Verify and publish.**

   ```bash
   npx vsce login codingguru         # paste the PAT when prompted
   npx vsce publish --no-dependencies --allow-missing-repository
   npx vsce publish minor --no-dependencies --allow-missing-repository   # bump + publish
   ```

   Those two flags are easy to forget on every invocation; a `publish` npm script that
   wraps them is worth it once you release regularly.

   The listing then lives at
   `https://marketplace.visualstudio.com/items?itemName=codingguru.codingguru`.
4. **Unpublish** from the publisher page (*More Actions → Unpublish*) or with
   `npx vsce unpublish codingguru.codingguru`. Unpublishing keeps the stats and lets you
   re-publish the same name; deleting does not.

> **PAT retirement.** Azure DevOps retires global Personal Access Tokens on
> **1 December 2026**. After that, automated publishing has to use Microsoft Entra ID
> (workload identity federation) with `vsce publish --azure-credential`, and interactive
> `vsce login` with a PAT stops working. See the [VS Code publishing
> guide](https://code.visualstudio.com/api/working-with-extensions/publishing-extension).

### Publish to Open VSX (Devin Desktop)

Devin Desktop, Windsurf, VSCodium and other forks pull from
[open-vsx.org](https://open-vsx.org). Same flow, different tool:

```bash
# 1. Create an access token: https://open-vsx.org/user-settings/tokens
# 2. Claim the namespace once — it must match `publisher` in package.json
npx ovsx create-namespace codingguru -p <token>
# 3. Publish the artifact you already built
npx ovsx publish codingguru-0.1.5.vsix -p <token>
```

- `ovsx publish` with no path packages the current directory first; it drives `vsce`
  internally, so `vscode:prepublish` still runs. Publishing a prebuilt `.vsix` does not.
- Export `OVSX_PAT` instead of passing `-p` to keep the token out of your shell history.
- `--skip-duplicate` turns a re-run of an existing version into a no-op instead of an error.
- `-r https://your.registry` targets a self-hosted registry.
- On CI that provides an OIDC token, `--trusted-publishing` exchanges it for a short-lived
  publishing token — no long-lived secret to rotate.
- Namespaces belong to the account that created them. If `codingguru` is taken, publish from
  another account or change `publisher` in `package.json` — which also changes the
  extension ID and the install/uninstall commands above.

Once it's on Open VSX, Devin Desktop users can install it straight from the Extensions panel.

### Private / offline distribution

- Attach the `.vsix` to a GitHub Release. `*.vsix` is in `.gitignore`, so don't commit it —
  upload it as a release asset and link the release from this README.
- `--install-extension` accepts any local path, including a network share, which is enough
  for an air-gapped machine.
- Teams that want versioning and access control mirror the VSIX into an internal feed
  (Azure Artifacts, Artifactory, S3) and install from there.

### Automating releases

Tag-driven release with GitHub Actions. The two registry steps are independent, so a
Marketplace outage can't block Open VSX. Store `VSCE_PAT` and `OVSX_PAT` as repository
secrets (or switch to `--azure-credential` / `--trusted-publishing` once your CI supports
OIDC).

```yaml
name: release
on:
  push:
    tags: ["v*"]

jobs:
  publish:
    runs-on: ubuntu-latest
    permissions:
      contents: write
      id-token: write
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm ci
      - run: npm run typecheck
      - run: npm run docs:check
      - run: npm run secrets
      - run: npm run package
      - name: VS Code Marketplace
        run: npx vsce publish --no-dependencies --allow-missing-repository --packagePath codingguru-*.vsix
        env:
          VSCE_PAT: ${{ secrets.VSCE_PAT }}
      - name: Open VSX
        run: npx ovsx publish codingguru-*.vsix --skip-duplicate
        env:
          OVSX_PAT: ${{ secrets.OVSX_PAT }}
      - uses: softprops/action-gh-release@v2
        with:
          files: codingguru-*.vsix
```

The glob in `--packagePath` relies on the shell expanding it. If you'd rather be explicit,
add a `publish:vsix` npm script that passes the versioned filename. Also make sure the tag
matches `package.json` → `version` before pushing — the registries reject a mismatch.

### Release checklist

1. `npm run typecheck && npm run build && npm run docs:check && npm run secrets`
2. `npm run smoke` if anything under `src/opencode/` changed
3. Bump `version` in `package.json` (and record it in `CHANGELOG.md` if you add one)
4. `npm run package`, then install that VSIX into a clean profile and exercise it —
   `npm run sandbox` loads from source and does **not** test the packaged artifact
5. Manually smoke-test: create a goal, open a build guide, ask the coach for a review
6. `npx vsce publish --no-dependencies --allow-missing-repository` and
   `npx ovsx publish <file>` — both flags go away once `package.json` has a `repository`
7. Tag the commit and attach the VSIX to the release

### Troubleshooting

| Symptom | Fix |
| --- | --- |
| `A 'repository' field is missing from 'package.json'` | Keep `--allow-missing-repository`, or add `"repository"` (relative README links then resolve on the Marketplace) |
| `Missing publisher name` | Add `"publisher"` to `package.json`; it must match the Marketplace / Open VSX namespace |
| `Icon must be a PNG` / SVG rejected | Publishing refuses SVG icons. Add a 128×128 PNG as `"icon"` if you want a listing tile |
| `Extension version already exists` | Bump `package.json` → `version`; neither registry overwrites a published version |
| Extension installs, but the CodingGuru views never show | Views are gated on `codingguru.hasWorkspace`: the open folder needs a `.codingguru/` directory, and `workspaceContains:**/.codingguru/**` is what wakes the extension |
| `Cannot find module …` at runtime from the packaged build | Something fell out of the bundle — check `external` in `esbuild.js` (only `vscode` may be external) and that `--no-dependencies` is used |
| Open VSX: `Namespace not found` | Run `npx ovsx create-namespace codingguru -p <token>` before the first publish |
| Devin Desktop can't find CodingGuru in the Extensions panel | It isn't on Open VSX yet — publish there, or side-load the `.vsix` |
| Windows: a stray `nul` file shows up in `vsce ls` | `.vscodeignore` already excludes `nul` (a Windows console artifact); keep that line |
| A test fixture or scanner config appears in the Marketplace listing | It wasn't matched by `.vscodeignore` — add a pattern for it and re-check with `npx vsce ls --tree`. `.secretlintrc.json`, `.secretlintignore`, `.githooks/**` and `.github/**` are already excluded |

## Development

```bash
npm run watch      # rebuild on change
npm run typecheck  # tsc --noEmit
npm run smoke      # end-to-end check against a real OpenCode server
npm run sandbox    # launch an isolated dev host (see below)
npm run package    # build a .vsix
npm run secrets    # scan the tree for committed credentials
```

### Dev mode / sandbox

You don't need to package and install a `.vsix` to try a change. The **Extension
Development Host** loads the extension straight from source.

**From the editor** — open this folder and press <kbd>F5</kbd>, then pick a config:

| Config | What it does |
| --- | --- |
| **Run CodingGuru** | Dev host using your normal profile and your other extensions |
| **Run CodingGuru (sandbox)** | Dev host with its own `user-data-dir` and all other extensions disabled |

Both start `npm run watch` first and wait for the build to finish, so edits are
picked up by reloading the dev-host window (<kbd>Ctrl</kbd>+<kbd>R</kbd>).

**From the terminal** — the same sandbox without touching the debugger:

```bash
npm run sandbox
```

This launches your editor with `--extensionDevelopmentPath` pointing at this repo,
an isolated profile in `.dev-sandbox/` (gitignored), and `--disable-extensions`.
Nothing it does affects your real editor profile. Close the window to stop.

To use a different editor binary (e.g. stock VS Code):

```bash
CODINGGURU_EDITOR=code npm run sandbox
```

### Tests

`npm run smoke` verifies the integration against a live OpenCode process: server
startup, coach agent registration, read-only enforcement (it tries to get the coach
to edit and delete a file), and streaming. Run it after upgrading OpenCode — the
server API is still evolving.

### Secrets

Never commit credentials or `.env` files. Two guards keep it that way:

- `npm run secrets` scans the tree with [secretlint](https://github.com/secretlint/secretlint)
  (rules in `.secretlintrc.json`). Run it before you push.
- A tracked pre-commit hook scans staged files — enable it once with
  `git config core.hooksPath .githooks`. A `gitleaks` GitHub Action covers every push
  and pull request server-side, so the hook is a convenience rather than the only line
  of defence.

If a secret ever lands in history, rotate the credential first, then rewrite history.
