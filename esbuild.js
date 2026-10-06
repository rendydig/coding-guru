const esbuild = require("esbuild");

const production = process.argv.includes("--production");
const watch = process.argv.includes("--watch");

const shared = {
  bundle: true,
  minify: production,
  sourcemap: !production,
  sourcesContent: false,
  logLevel: "info",
};

/** Extension host: Node + CommonJS, `vscode` provided by the host. */
const extensionOptions = {
  ...shared,
  entryPoints: ["src/extension.ts"],
  format: "cjs",
  platform: "node",
  target: "node20",
  outfile: "dist/extension.js",
  external: ["vscode"],
};

/** Coach webview: browser + IIFE. Emits coach.js and coach.css into outdir. */
const webviewOptions = {
  ...shared,
  entryPoints: ["src/webview/coach.ts"],
  format: "iife",
  platform: "browser",
  target: "es2022",
  outdir: "dist/webview",
};

async function main() {
  if (watch) {
    const contexts = await Promise.all([extensionOptions, webviewOptions].map((o) => esbuild.context(o)));
    // The "watching" marker must precede the first "build finished" so the
    // background task in .vscode/tasks.json sees begins before ends.
    console.log("[esbuild] watching…");
    await Promise.all(contexts.map((ctx) => ctx.watch()));
  } else {
    await Promise.all([extensionOptions, webviewOptions].map((o) => esbuild.build(o)));
  }
  // Printed once, after *both* targets succeed, so the debugger never attaches
  // to a half-built extension.
  console.log("[esbuild] build finished");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
