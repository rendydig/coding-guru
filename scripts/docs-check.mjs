/**
 * Verifies the syllabus build guides rendered by `src/syllabus/documents.ts`.
 *
 * Deterministic — the documents are derived from the syllabus, so this needs no
 * OpenCode server or model. `documents.ts` pulls in `model/store.ts`, which
 * imports `vscode`; that module is stubbed so the bundle runs in plain Node.
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

  const { writeDocuments } = await import(pathToFileURL(bundlePath).href);

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
            steps: ["Create package.json", "Add a route"],
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

  const written = writeDocuments(goal, syllabus);
  const docsDir = path.join(workspacePath, "docs");
  const files = fs.readdirSync(docsDir).sort();

  check("writeDocuments returns one path per file", written.length === files.length, `${written.length} files`);
  check("index document is written", files.includes("README.md"), files.join(", "));
  check("section document is written", files.includes("01-http-basics.md"), files.join(", "));
  check(
    "task documents are written",
    files.includes("01-01-hello-endpoint.md") && files.includes("01-02-health-check.md"),
    files.join(", ")
  );

  const index = fs.readFileSync(path.join(docsDir, "README.md"), "utf8");
  check(
    "index links the section and every task",
    index.includes("(01-http-basics.md)") &&
      index.includes("(01-01-hello-endpoint.md)") &&
      index.includes("(01-02-health-check.md)")
  );

  const taskDoc = fs.readFileSync(path.join(docsDir, "01-01-hello-endpoint.md"), "utf8");
  check("task doc shows the deliverable", taskDoc.includes("A running server with GET /hello returning JSON."));
  check("task doc lists concepts and steps", taskDoc.includes("## Concepts") && taskDoc.includes("## Suggested steps"));
  check("task doc lists acceptance criteria", taskDoc.includes("- [ ] GET /hello returns 200"));
  check("task doc links back to its section", taskDoc.includes("(01-http-basics.md)"));

  const minimal = fs.readFileSync(path.join(docsDir, "01-02-health-check.md"), "utf8");
  check(
    "missing optional fields still render",
    minimal.includes("## What you'll build") && !minimal.includes("## Why it matters")
  );
} finally {
  fs.rmSync(outDir, { recursive: true, force: true });
}

const failed = results.filter((r) => !r.passed);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length === 0 ? 0 : 1);
