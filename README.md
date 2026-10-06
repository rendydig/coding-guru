# CodingGuru

A VS Code / Devin Desktop extension that turns a coding goal into a step-by-step
syllabus, scaffolds a learning workspace, and coaches you through it with a
**read-only** AI agent that never touches your files.

## How it works

1. **Describe a goal** — "I want to build a Node.js + Express app with PostgreSQL."
2. **Get a syllabus** — CodingGuru generates sections and tasks, each with
   observable acceptance criteria.
3. **Get build guides** — one Markdown document per section and per task lands in
   `docs/`, explaining what you will build, why it matters, and how to verify it.
4. **Get a workspace** — a folder is created at `~/CodingGuru/<goal>/` and opened.
5. **You write the code** — in VS Code's normal explorer and editor.
6. **The coach reviews** — ask for a review of any task and get a verdict, findings,
   and the next concrete step. It never edits your files; it explains and nudges.

The coach is an [OpenCode](https://opencode.ai) agent (`codingguru-coach`) defined
with `edit: deny` and `bash: deny`, so the "coach only" guarantee is enforced by
OpenCode's permission system, not just by prompt wording.

## Requirements

- **OpenCode CLI** installed and on your `PATH` (developed against `1.18.34`).
  Check with `opencode --version`.
- **A model configured for OpenCode.** CodingGuru uses your OpenCode default model
  unless you set `codingguru.model`. Verify with `opencode models`.

## Install

```bash
npm install
npm run build
npm run package        # produces codingguru-0.1.2.vsix
```

Then either:

- **Extensions view** → `...` menu → *Install from VSIX…* → pick the `.vsix`, or
- **CLI**: `devin-desktop --install-extension codingguru-0.1.2.vsix`

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
tree) opens the matching document from `docs/`, explaining what you will build.
When you think a task is done, hit **Review task** (or the check icon on the tree
item). The coach reads your code, checks it against the task's acceptance criteria,
and records a verdict in `.codingguru/progress.json`.

## Commands

| Command | Description |
| --- | --- |
| `CodingGuru: Create Learning Goal` | Open the goal wizard |
| `CodingGuru: Open Learning Workspace` | Reopen a goal's folder |
| `CodingGuru: Review Task with Coach` | Review the current/selected task |
| `CodingGuru: Start Task` | Mark a task in progress |
| `CodingGuru: Mark Task Done` | Mark a task passed manually |
| `CodingGuru: Open Document` | Open a task or section build guide (also by clicking its tree item) |
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
    │   ├── 01-<section>.md           # section overview
    │   └── 01-01-<task>.md           # task build guide
    ├── opencode.json                 # read-only coach agent definition
    ├── AGENTS.md                     # "do not write code for the learner" rules
    ├── README.md                     # the syllabus, human-readable, links into docs/
    └── … your code
```

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

## Development

```bash
npm run watch      # rebuild on change
npm run typecheck  # tsc --noEmit
npm run smoke      # end-to-end check against a real OpenCode server
npm run sandbox    # launch an isolated dev host (see below)
npm run package    # build a .vsix
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
