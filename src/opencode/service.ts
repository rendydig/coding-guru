import { createOpencodeClient, OpencodeClient, Part, TextPart } from "@opencode-ai/sdk";
import * as vscode from "vscode";
import { ToolActivity, ToolStatus } from "../model/types";
import { extractJson } from "../util/json";
import { buildOpencodeConfig, COACH_AGENT } from "./coach";
import { ServerHandle, startOpencodeServer } from "./server";

export interface StreamHandler {
  onText(delta: string): void;
  onReasoning?(delta: string): void;
  onTool?(tool: ToolActivity): void;
}

/** Input key that best describes what each tool acted on, mirroring OpenCode's UI. */
const TOOL_TARGET_KEYS: Record<string, string> = {
  read: "filePath",
  list: "path",
  glob: "pattern",
  grep: "pattern",
  webfetch: "url",
  websearch: "query",
  bash: "command",
};

function toolTarget(name: string, input: Record<string, unknown> | undefined): string | undefined {
  const value = input && TOOL_TARGET_KEYS[name] ? input[TOOL_TARGET_KEYS[name]] : undefined;
  return typeof value === "string" && value ? value : undefined;
}

function toolStatus(status: string | undefined): ToolStatus {
  return status === "pending" || status === "running" || status === "completed" || status === "error"
    ? status
    : "running";
}

function textOfParts(parts: Part[] | undefined): string {
  if (!parts) {
    return "";
  }
  return parts
    .filter((part): part is TextPart => part.type === "text" && !part.synthetic)
    .map((part) => part.text)
    .join("");
}

/**
 * Owns the lifecycle of one local `opencode serve` process (rooted at the active
 * learning workspace) plus the typed client used to talk to it.
 */
export class OpencodeService implements vscode.Disposable {
  private handle?: ServerHandle;
  private client?: OpencodeClient;
  private workspace?: string;
  private pending?: Promise<OpencodeClient>;

  constructor(private readonly log: (message: string) => void) {}

  async ensure(workspacePath: string): Promise<OpencodeClient> {
    if (this.client && this.workspace === workspacePath) {
      return this.client;
    }
    if (!this.pending) {
      this.pending = this.start(workspacePath).finally(() => {
        this.pending = undefined;
      });
    }
    const client = await this.pending;
    if (this.workspace !== workspacePath) {
      return this.ensure(workspacePath);
    }
    return client;
  }

  private async start(workspacePath: string): Promise<OpencodeClient> {
    this.stopServer();
    const config = vscode.workspace.getConfiguration("codingguru");
    const binPath = config.get<string>("opencodePath")?.trim() || "opencode";
    const model = config.get<string>("model") ?? "";
    const allowBash = config.get<boolean>("coachAllowBash") ?? false;

    this.log(`Starting OpenCode server in ${workspacePath} (binary: ${binPath})`);
    const handle = await startOpencodeServer({
      cwd: workspacePath,
      binPath,
      config: buildOpencodeConfig({ model, allowBash }),
    });
    this.handle = handle;
    this.workspace = workspacePath;
    this.client = createOpencodeClient({ baseUrl: handle.url });
    this.log(`OpenCode server listening at ${handle.url}`);
    return this.client;
  }

  async createSession(workspacePath: string, title: string): Promise<string> {
    const client = await this.ensure(workspacePath);
    const { data, error } = await client.session.create({ body: { title } });
    if (error || !data) {
      throw new Error(`Could not create a coach session: ${JSON.stringify(error)}`);
    }
    return data.id;
  }

  async listAgents(workspacePath: string): Promise<string[]> {
    const client = await this.ensure(workspacePath);
    const { data } = await client.app.agents();
    return (data ?? []).map((agent) => agent.name);
  }

  async promptText(workspacePath: string, sessionId: string, text: string, agent = COACH_AGENT): Promise<string> {
    const client = await this.ensure(workspacePath);
    const { data, error } = await client.session.prompt({
      path: { id: sessionId },
      body: { agent, parts: [{ type: "text", text }] },
    });
    if (error || !data) {
      throw new Error(`The coach could not respond: ${JSON.stringify(error)}`);
    }
    return textOfParts(data.parts);
  }

  async promptJson<T>(workspacePath: string, sessionId: string, text: string, label: string): Promise<T> {
    const raw = await this.promptText(workspacePath, sessionId, text);
    const parsed = extractJson<T>(raw);
    if (parsed === undefined) {
      throw new Error(`The coach did not return valid JSON for ${label}.\n\n${raw.slice(0, 2000)}`);
    }
    return parsed;
  }

  /**
   * Streams the coach's reply through `handler` while the prompt runs, returning
   * the final text. Falls back to the complete message if no deltas arrive.
   */
  async promptStreaming(
    workspacePath: string,
    sessionId: string,
    text: string,
    handler: StreamHandler
  ): Promise<string> {
    const client = await this.ensure(workspacePath);
    const sse = await client.event.subscribe();
    const stream = sse.stream;
    let streamed = "";
    let stopped = false;

    // `message.part.delta` is emitted by the server but missing from the SDK's
    // event union, so events are narrowed structurally rather than by type.
    let sawPartDelta = false;
    let sawReasoningDelta = false;
    const onEvent = (event: unknown) => {
      const typed = event as { type?: string; properties?: Record<string, unknown> };
      if (!typed || typeof typed.type !== "string") {
        return;
      }
      const props = typed.properties ?? {};

      if (typed.type === "message.part.delta") {
        if (props.sessionID !== sessionId) {
          return;
        }
        const delta = props.delta;
        if (typeof delta !== "string" || !delta) {
          return;
        }
        if (props.field === "text") {
          sawPartDelta = true;
          streamed += delta;
          handler.onText(delta);
        } else if (props.field === "reasoning") {
          sawReasoningDelta = true;
          handler.onReasoning?.(delta);
        }
        return;
      }

      if (typed.type === "message.part.updated") {
        const part = props.part as Part | undefined;
        if (!part || part.sessionID !== sessionId) {
          return;
        }
        if (part.type === "tool") {
          const tool = part as typeof part & {
            callID?: string;
            state?: { status?: string; input?: Record<string, unknown>; title?: string };
          };
          const state = tool.state ?? {};
          handler.onTool?.({
            callID: tool.callID ?? tool.tool,
            name: tool.tool,
            status: toolStatus(state.status),
            title: typeof state.title === "string" ? state.title : undefined,
            target: toolTarget(tool.tool, state.input),
          });
          return;
        }
        // `reasoning` parts are emitted by the server but absent from the SDK's
        // `Part` union in 1.18.34, so narrow structurally like the delta events.
        if ((part as { type?: string }).type === "reasoning") {
          const text = (part as { text?: string }).text;
          if (!sawReasoningDelta && typeof text === "string" && text) {
            sawReasoningDelta = true;
            handler.onReasoning?.(text);
          }
          return;
        }
        const delta = props.delta;
        if (!sawPartDelta && part.type === "text" && !part.synthetic && typeof delta === "string" && delta) {
          streamed += delta;
          handler.onText(delta);
        }
      }
    };

    const pump = (async () => {
      try {
        for await (const event of stream) {
          if (stopped) {
            break;
          }
          onEvent(event);
        }
      } catch {
        // The SSE stream closing is expected once the prompt completes.
      }
    })();

    try {
      const { data, error } = await client.session.prompt({
        path: { id: sessionId },
        body: { agent: COACH_AGENT, parts: [{ type: "text", text }] },
      });
      if (error || !data) {
        throw new Error(`The coach could not respond: ${JSON.stringify(error)}`);
      }
      const final = textOfParts(data.parts);
      if (!streamed) {
        handler.onText(final);
      }
      return final;
    } finally {
      stopped = true;
      void stream.return?.(undefined as never);
      await pump.catch(() => undefined);
    }
  }

  dispose(): void {
    this.stopServer();
  }

  private stopServer(): void {
    this.handle?.stop();
    this.handle = undefined;
    this.client = undefined;
    this.workspace = undefined;
  }
}
