/**
 * Verifies the deterministic part of the syllabus docs and the task-guide
 * composition in `src/syllabus/documents.ts`.
 *
 * Deterministic — no OpenCode server or model needed. `documents.ts` pulls in
 * `model/store.ts`, which imports `vscode`; that module is stubbed so the bundle
 * runs in plain Node.
 *
 * Run with: npm run docs:check
 */
import esbuild from "esbuild";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const results = [];
function check(name, passed, detail = "") {
  results.push({ name, passed });
  console.log(`${passed ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

const vscodeStub = {
  name: "vscode-stub",
  setup(build) {
    build.onResolve({ filter: /^vscode$/ }, () => ({ path: "vscode", namespace: "vscode-stub" }));
    build.onLoad({ filter: /.*/, namespace: "vscode-stub" }, () => ({
      contents: "export const workspace = { getConfiguration: () => ({ get: () => undefined }) };",
      loader: "js",
    }));
  },
};

const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "codingguru-docs-"));
const bundlePath = path.join(outDir, "documents.mjs");

try {
  await esbuild.build({
    entryPoints: ["src/syllabus/documents.ts"],
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    outfile: bundlePath,
    plugins: [vscodeStub],
    logLevel: "silent",
  });

  const { writeDocuments, taskGuideMarkdown } = await import(pathToFileURL(bundlePath).href);

  const workspacePath = path.join(outDir, "my-goal");
  const goal = {
    id: "goal_fixture",
    slug: "my-goal",
    title: "Build a REST API",
    description: "Learn to build and test a small HTTP API.",
    stack: ["Node.js", "Express"],
    level: "beginner",
    createdAt: new Date().toISOString(),
    workspacePath,
  };
  const syllabus = {
    goalId: goal.id,
    title: goal.title,
    generatedAt: new Date().toISOString(),
    sections: [
      {
        id: "sec_1",
        title: "HTTP Basics",
        description: "Understand requests and responses.",
        overview: "A tiny server that answers one route.",
        tasks: [
          {
            id: "task_1",
            title: "Hello endpoint",
            description: "Return a greeting.",
            deliverable: "A running server with GET /hello returning JSON.",
            why: "Every API starts with a route.",
            concepts: ["routing", "JSON"],
            acceptanceCriteria: ["GET /hello returns 200"],
            verification: ["curl localhost:3000/hello"],
            resources: ["https://expressjs.com"],
          },
          {
            id: "task_2",
            title: "Health check",
            description: "Add a health route.",
            acceptanceCriteria: ["GET /health returns 200"],
          },
        ],
      },
    ],
  };
  const section = syllabus.sections[0];
  const [task1, task2] = section.tasks;

  const written = writeDocuments(goal, syllabus);
  const docsDir = path.join(workspacePath, "docs");
  const files = fs.readdirSync(docsDir).sort();

  check("writeDocuments writes the deterministic docs", written.length === 2, files.join(", "));
  check("index document is written", files.includes("README.md"));
  check("section document is written", files.includes("01-http-basics.md"));
  check(
    "task guides are NOT written eagerly",
    !files.some((name) => /^\d\d-\d\d-/.test(name)),
    files.join(", ")
  );

  const index = fs.readFileSync(path.join(docsDir, "README.md"), "utf8");
  check(
    "index links the section and every task",
    index.includes("(01-http-basics.md)") &&
      index.includes("(01-01-hello-endpoint.md)") &&
      index.includes("(01-02-health-check.md)")
  );

  const body =
    "## Before you start\n\nRun `npm init -y`.\n\n" +
    "## Step by step\n\n1. Add a route.\n\n" +
    "## Full example\n\n```js\napp.get('/hello', (req, res) => res.json({ ok: true }));\n```\n\n" +
    "## Watch out for\n\nForgetting to call `app.listen`.";
  const guide = taskGuideMarkdown(goal, section, task1, 0, 0, body);

  check("guide header carries the numbered title", guide.includes("# 1.1 Hello endpoint"));
  check("guide shows the deliverable", guide.includes("A running server with GET /hello returning JSON."));
  check("guide lists concepts", guide.includes("## Concepts") && guide.includes("- routing"));
  check("guide lists acceptance criteria", guide.includes("- [ ] GET /hello returns 200"));
  check("guide embeds the authored body", guide.includes("Run `npm init -y`.") && guide.includes("## Full example"));
  check("guide keeps the verify footer", guide.includes("## How to verify") && guide.includes("curl localhost:3000/hello"));
  check("guide links to the next task", guide.includes("(01-02-health-check.md)"));

  const bodyIndex = guide.indexOf("## Full example");
  const footerIndex = guide.indexOf("## How to verify");
  check("authored body sits above the footer", bodyIndex > 0 && bodyIndex < footerIndex);

  const minimal = taskGuideMarkdown(goal, section, task2, 0, 1, "BODY_MARKER");
  check(
    "a task without optional fields still composes",
    minimal.includes("BODY_MARKER") &&
      minimal.includes("## What you'll build") &&
      !minimal.includes("## Why it matters")
  );
  check("guide links to the previous task", minimal.includes("(01-01-hello-endpoint.md)"));
} finally {
  fs.rmSync(outDir, { recursive: true, force: true });
}

const failed = results.filter((r) => !r.passed);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length === 0 ? 0 : 1);
