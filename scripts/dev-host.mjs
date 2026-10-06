/**
 * Launches an isolated Extension Development Host for CodingGuru.
 *
 * This is the CLI equivalent of the "Run CodingGuru (sandbox)" debug config: the
 * extension is loaded straight from source, with its own user-data-dir and with
 * all other installed extensions disabled, so testing never disturbs your real
 * editor profile.
 *
 * Override the editor binary with CODINGGURU_EDITOR, e.g.:
 *   CODINGGURU_EDITOR=code npm run sandbox
 */
import { spawn } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sandbox = path.join(root, ".dev-sandbox");
fs.mkdirSync(sandbox, { recursive: true });

const editor = process.env.CODINGGURU_EDITOR || "devin-desktop";

const args = [
  `--extensionDevelopmentPath=${root}`,
  `--user-data-dir=${path.join(sandbox, "user-data")}`,
  "--disable-extensions",
  "--disable-workspace-trust",
];

console.log(`Launching "${editor}" as an isolated dev host`);
console.log(`  extension: ${root}`);
console.log(`  profile:   ${sandbox}`);
console.log("Close the window to stop.\n");

const child = spawn(editor, args, {
  stdio: "inherit",
  shell: process.platform === "win32",
  windowsHide: false,
});

child.on("error", (error) => {
  console.error(`Could not launch "${editor}": ${error.message}`);
  console.error('Set CODINGGURU_EDITOR to your editor binary, e.g. CODINGGURU_EDITOR=code');
  process.exit(1);
});

child.on("exit", (code) => process.exit(code ?? 0));
