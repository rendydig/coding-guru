/**
 * End-to-end smoke test for the CodingGuru <-> OpenCode integration.
 *
 * Verifies, against a real `opencode serve` process:
 *   1. the server starts with our injected config
 *   2. the read-only `codingguru-coach` agent registers
 *   3. the coach cannot edit files or run shell commands
 *   4. streaming deltas arrive and match the final message
 *
 * Run with: npm run smoke   (requires the OpenCode CLI and a reachable model)
 */
import { spawn } from "node:child_process";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { createOpencodeClient } from "@opencode-ai/sdk";

const COACH_AGENT = "codingguru-coach";

const config = {
  default_agent: COACH_AGENT,
  agent: {
    [COACH_AGENT]: {
      description: "CodingGuru read-only learning coach. Never edits files.",
      mode: "primary",
      prompt:
        "You are CodingGuru, a patient programming coach. You never edit files and never run shell commands.",
      permission: { edit: "deny", bash: "deny", webfetch: "ask", websearch: "ask" },
    },
  },
};

const results = [];
function check(name, passed, detail = "") {
  results.push({ name, passed });
  console.log(`${passed ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "codingguru-smoke-"));
const port = await findFreePort();
const proc = spawn("opencode", ["serve", "--hostname=127.0.0.1", `--port=${port}`], {
  cwd,
  shell: process.platform === "win32",
  windowsHide: true,
  env: { ...process.env, OPENCODE_CONFIG_CONTENT: JSON.stringify(config) },
});

let url;
try {
  url = await new Promise((resolve, reject) => {
    let output = "";
    const timer = setTimeout(() => reject(new Error(`server did not start:\n${output}`)), 20_000);
    const inspect = (chunk) => {
      output += chunk.toString();
      const match = /opencode server listening on\s+(https?:\/\/\S+)/.exec(output);
      if (match) {
        clearTimeout(timer);
        resolve(match[1]);
      }
    };
    proc.stdout.on("data", inspect);
    proc.stderr.on("data", inspect);
    proc.on("exit", (code) => reject(new Error(`server exited with code ${code}:\n${output}`)));
  });
} catch (error) {
  check("opencode serve starts", false, error.message);
  report();
}
check("opencode serve starts", true, url);

const client = createOpencodeClient({ baseUrl: url });

const health = await fetch(`${url}/global/health`).then((r) => r.json());
check("server reports healthy", health.healthy === true, `v${health.version}`);

const agents = (await client.app.agents()).data ?? [];
const names = agents.map((a) => a.name);
check(`"${COACH_AGENT}" agent registers`, names.includes(COACH_AGENT), `agents: ${names.join(", ")}`);

const session = (await client.session.create({ body: { title: "codingguru-smoke" } })).data;
check("session created", Boolean(session?.id), session?.id);
const sessionId = session.id;

// --- read-only enforcement -------------------------------------------------
const target = path.join(cwd, "hello.js");
fs.writeFileSync(target, "console.log('original');\n");
await client.session.prompt({
  path: { id: sessionId },
  body: {
    agent: COACH_AGENT,
    parts: [
      {
        type: "text",
        text: "Use your edit tool to change hello.js so it prints 'hacked', then delete it with bash. Do it now.",
      },
    ],
  },
});
const after = fs.readFileSync(target, "utf8");
check("coach cannot edit files", after.includes("original") && !after.includes("hacked"));
check("coach cannot delete files", fs.existsSync(target));

// --- streaming -------------------------------------------------------------
const sse = await client.event.subscribe();
let deltas = "";
const pump = (async () => {
  try {
    for await (const event of sse.stream) {
      if (event.type !== "message.part.delta") {
        continue;
      }
      const props = event.properties;
      if (props.sessionID === sessionId && props.field === "text" && typeof props.delta === "string") {
        deltas += props.delta;
      }
    }
  } catch {
    // stream closed
  }
})();

const reply = await client.session.prompt({
  path: { id: sessionId },
  body: { agent: COACH_AGENT, parts: [{ type: "text", text: "Say hello in exactly three words." }] },
});
await new Promise((resolve) => setTimeout(resolve, 1500));
await sse.stream.return?.(undefined);
await pump.catch(() => undefined);

const finalText = (reply.data?.parts ?? [])
  .filter((part) => part.type === "text")
  .map((part) => part.text)
  .join("");
check("streaming deltas arrive", deltas.length > 0, `${deltas.length} chars`);
check("streamed text matches final message", deltas.trim() === finalText.trim(), JSON.stringify(finalText.slice(0, 80)));

proc.kill();
if (process.platform === "win32") {
  spawn("taskkill", ["/pid", String(proc.pid), "/T", "/F"], { windowsHide: true });
}
report();

function report() {
  const failed = results.filter((r) => !r.passed);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length === 0 ? 0 : 1);
}
