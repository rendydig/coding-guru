# CodingGuru — agent notes

VS Code / Devin Desktop extension (TypeScript) that scaffolds a learning workspace
and provides a read-only OpenCode-powered coach.

## Commands

| Command | Purpose |
| --- | --- |
| `npm install` | Install dependencies |
| `npm run build` | Bundle `src/` → `dist/extension.js` with esbuild |
| `npm run watch` | Rebuild on change |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run smoke` | End-to-end check against a real `opencode serve` (needs the OpenCode CLI and a reachable model) |
| `npm run docs:check` | Render the syllabus build guides from a fixture and assert the `docs/` files (no model needed) |
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

## Things to know before editing

- **The extension host is Node + CommonJS** (`format: "cjs"` in `esbuild.js`), but
  `@opencode-ai/sdk` is ESM-only. `tsconfig.json` therefore uses
  `moduleResolution: "Bundler"`; esbuild does the ESM→CJS conversion. Do not switch
  to `NodeNext`.
- **OpenCode's SDK types lag the server.** `global.health()` does not exist in
  `1.18.34`, and `message.part.delta` events are emitted but absent from the `Event`
  union. Narrow those events structurally (see `src/opencode/service.ts`).
- **The coach must stay read-only.** Its permissions (`edit: deny`, `bash: deny`)
  live in `src/opencode/coach.ts` and are verified by `npm run smoke`. Never loosen
  them without updating that test.
- **`OPENCODE_CONFIG_CONTENT` merges with the user's global OpenCode config**, so the
  coach agent is added without disturbing their providers or default model.
- Learning workspaces are created under `~/CodingGuru/<slug>/` (configurable). All
  per-goal state lives in `.codingguru/*.json`.
- **Views are gated on the `codingguru.hasWorkspace` context key.** `package.json`
  hides `codingguru.syllabus` / `codingguru.coach` unless an open folder contains a
  `.codingguru` directory, and shows `codingguru.getStarted` otherwise. The key is
  set in `src/extension.ts` and kept fresh by `Store.onDidChange`; the
  `workspaceContains:**/.codingguru/**` activation event keeps the extension dormant
  in unrelated folders. Keep these in sync if you add or rename views.
- **Build guides in `docs/` are generated, not authored.** `src/syllabus/documents.ts`
  renders one index, one overview per section, and one document per task straight from
  `syllabus.json` — no extra model call. The explanatory fields (`section.overview`,
  `task.deliverable/why/concepts/steps`) come from the same `syllabusPrompt` call, so if
  you change that JSON schema, update the parser in `generate.ts` and the renderer in
  `documents.ts` together.
