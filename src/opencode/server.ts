import { ChildProcess, spawn } from "child_process";
import * as net from "net";

export interface ServerHandle {
  url: string;
  stop(): void;
}

function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => (port ? resolve(port) : reject(new Error("Could not allocate a port"))));
    });
  });
}

function quote(command: string): string {
  return /\s/.test(command) && !command.startsWith('"') ? `"${command}"` : command;
}

/**
 * Spawns `opencode serve` rooted at `cwd` and waits for it to report its URL.
 *
 * The coach agent definition is injected through `OPENCODE_CONFIG_CONTENT`, which
 * OpenCode layers on top of the user's global config — so the user's providers
 * and default model keep working.
 */
export async function startOpencodeServer(options: {
  cwd: string;
  binPath: string;
  config: unknown;
  timeoutMs?: number;
}): Promise<ServerHandle> {
  const timeoutMs = options.timeoutMs ?? 20_000;
  const port = await findFreePort();
  const args = ["serve", "--hostname=127.0.0.1", `--port=${port}`];

  // npm-installed CLIs on Windows are `.cmd` shims that require a shell.
  const useShell = process.platform === "win32";
  const command = useShell ? quote(options.binPath) : options.binPath;

  const proc: ChildProcess = spawn(command, args, {
    cwd: options.cwd,
    shell: useShell,
    windowsHide: true,
    env: {
      ...process.env,
      OPENCODE_CONFIG_CONTENT: JSON.stringify(options.config ?? {}),
    },
  });

  const url = await new Promise<string>((resolve, reject) => {
    let output = "";
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      fn();
    };
    const timer = setTimeout(() => {
      finish(() => {
        killTree(proc);
        reject(new Error(`OpenCode server did not start within ${timeoutMs}ms.\n${output.trim()}`));
      });
    }, timeoutMs);

    const inspect = (chunk: Buffer) => {
      output += chunk.toString();
      const match = /opencode server listening on\s+(https?:\/\/\S+)/.exec(output);
      if (match) {
        finish(() => resolve(match[1]));
      }
    };

    proc.stdout?.on("data", inspect);
    proc.stderr?.on("data", inspect);
    proc.on("error", (error) => finish(() => reject(error)));
    proc.on("exit", (code) =>
      finish(() => reject(new Error(`OpenCode server exited with code ${code}.\n${output.trim()}`)))
    );
  });

  return {
    url,
    stop: () => killTree(proc),
  };
}

function killTree(proc: ChildProcess): void {
  if (proc.exitCode !== null || proc.killed) {
    return;
  }
  if (process.platform === "win32" && proc.pid) {
    // Killing the shell alone can orphan the real server process.
    try {
      spawn("taskkill", ["/pid", String(proc.pid), "/T", "/F"], { windowsHide: true });
      return;
    } catch {
      // fall through to a plain kill
    }
  }
  try {
    proc.kill();
  } catch {
    // already gone
  }
}
