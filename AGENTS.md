# CodingGuru — agent notes

VS Code / Devin Desktop extension (TypeScript) that scaffolds a learning workspace
and provides a read-only OpenCode-powered coach.

## Commands

| Command | Purpose |
| --- | --- |
| `npm install` | Install dependencies |
| `npm run build` | Bundle `src/` → `dist/extension.js` and the coach webview → `dist/webview/coach.{js,css}` with esbuild |
| `npm run watch` | Rebuild on change |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run smoke` | End-to-end check against a real `opencode serve` (needs the OpenCode CLI and a reachable model) |
| `npm run docs:check` | Render the syllabus build guides from a fixture and assert the `docs/` files (no model needed) |
| `npm run secrets` | Scan the tree for committed credentials with secretlint |
| `npm run sandbox` | Launch an isolated Extension Development Host (own profile, other extensions disabled) |
| `npm run package` | Produce `codingguru-<version>.vsix` |

Press <kbd>F5</kbd> to debug; `.vscode/launch.json` offers a normal dev host and a
sandboxed one, both gated on the `watch` background task. `esbuild.js` prints
`[esbuild] watching…` / `[esbuild] build finished` markers that the task's problem
matcher depends on — keep those strings if you edit the build script.

## Verifying a change

Run `npm run typecheck && npm run build`. For anything touching
`src/opencode/`, also run `npm run smoke` — it asserts server startup, coach agent
registration, read-only enforcement, and streaming.

## Secrets — before you push

- **Never commit credentials, tokens, or `.env` files.** Provider keys live in the
  user's own OpenCode config; this repo only injects agent definitions through
  `OPENCODE_CONFIG_CONTENT`.
- Run `npm run secrets` (secretlint) before pushing. Rules are in
  `.secretlintrc.json`; `.secretlintignore` skips `node_modules/`, `dist/`, `*.vsix`,
  and the lockfile.
- A tracked pre-commit hook scans staged files. Enable it once per clone with
  `git config core.hooksPath .githooks`.
- `.github/workflows/secret-scan.yml` runs gitleaks on every push and pull request,
  over the full history.
- `.gitignore` / `.vscodeignore` exclude `.env*`, `*.local`, `opencode.json`, and
  `auth.json`. Keep them in sync if you add secret-bearing config.
- If a secret ever lands in history, **rotate the credential first**, then rewrite
  history.

## Things to know before editing

- **The extension host is Node + CommonJS** (`format: "cjs"` in `esbuild.js`), but
  `@opencode-ai/sdk` is ESM-only. `tsconfig.json` therefore uses
  `moduleResolution: "Bundler"`; esbuild does the ESM→CJS conversion. Do not switch
  to `NodeNext`.
- **OpenCode's SDK types lag the server.** `global.health()` does not exist in
  `1.18.34`, and `message.part.delta` events are emitted but absent from the `Event`
  union. Narrow those events structurally (see `src/opencode/service.ts`).
- **The coach webview is bundled, not hand-written.** `esbuild.js` compiles
  `src/webview/coach.ts` (browser/IIFE) to `dist/webview/coach.js` + `coach.css`, and
  `src/views/coachView.ts` loads them from `dist/webview` (its `localResourceRoots` is
  `dist`). `media/` now holds only the goal wizard (`wizard.*`) and icons. If you move
  the output, update `esbuild.js` and `coachView.ts` together.
- **Streaming carries text, reasoning, and tools.** `StreamHandler` in
  `src/opencode/service.ts` exposes `onText` / `onReasoning` / `onTool`. Tool parts
  (`message.part.updated`) fire several times per call (pending → running → completed),
  so consumers must upsert by `callID` rather than append. `reasoning` parts/deltas are
  emitted by the server but absent from the SDK unions — narrow them structurally too.
- **The coach transcript is persisted** to `.codingguru/chat.json`
  (`readTranscript` / `appendChatEntry` in `src/model/store.ts`). The webview replays it
  via the `history` message when the panel (re)loads, and groups each assistant turn's
  reasoning + tool calls into a collapsed "Thinking" block.
- **The coach must stay read-only.** Its permissions (`edit: deny`, `bash: deny`)
  live in `src/opencode/coach.ts` and are verified by `npm run smoke`. Never loosen
  them without updating that test. The `codingguru-author` agent shares the same
  permissions — it may show complete code in a manual, but it still never edits files.
- **`OPENCODE_CONFIG_CONTENT` merges with the user's global OpenCode config**, so the
  coach and author agents are added without disturbing their providers or default model.
  `scripts/smoke.mjs` re-declares both agents inline (it cannot import the TS); keep it
  in sync when you change `buildOpencodeConfig`.
- Learning workspaces are created under `~/CodingGuru/<slug>/` (configurable). All
  per-goal state lives in `.codingguru/*.json`.
- **Views are gated on the `codingguru.hasWorkspace` context key.** `package.json`
  hides `codingguru.syllabus` / `codingguru.coach` unless an open folder contains a
  `.codingguru` directory, and shows `codingguru.getStarted` otherwise. The key is
  set in `src/extension.ts` and kept fresh by `Store.onDidChange`; the
  `workspaceContains:**/.codingguru/**` activation event keeps the extension dormant
  in unrelated folders. Keep these in sync if you add or rename views.
- **`docs/` mixes deterministic and authored content.** `src/syllabus/documents.ts`
  renders the index (`docs/README.md`) and one overview per section straight from
  `syllabus.json` — no model call. **Task guides are authored on demand**: the first time
  a task's guide is opened, `src/syllabus/guides.ts` asks the `codingguru-author` agent
  for a Markdown manual and caches it via `taskGuideMarkdown` (deterministic header +
  authored body + footer). The syllabus schema fields (`section.overview`,
  `task.deliverable/why/concepts/steps`) still come from `syllabusPrompt`, so changing
  that JSON means updating `generate.ts` and `documents.ts` together. `npm run docs:check`
  covers the deterministic half and the guide composition.
