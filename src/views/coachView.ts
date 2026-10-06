import * as vscode from "vscode";
import { ReviewResult } from "../model/types";
import { htmlShell } from "./webview";

export const COACH_VIEW_TYPE = "codingguru.coach";

export interface CoachContext {
  hasGoal: boolean;
  goalTitle?: string;
  sectionTitle?: string;
  taskTitle?: string;
  status?: string;
  workspacePath?: string;
}

export interface CoachRequest {
  type: "ask" | "action";
  text?: string;
  action?: "review" | "hint" | "explain" | "progress" | "lint";
}

type IncomingMessage = CoachRequest | { type: "ready" };

/** Renders the Coach chat and relays messages to/from the extension. */
export class CoachViewProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;
  private ready = false;
  private readonly buffer: unknown[] = [];

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly onRequest: (request: CoachRequest) => void
  ) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    this.ready = false;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "media")],
    };
    view.webview.html = htmlShell({
      webview: view.webview,
      extensionUri: this.extensionUri,
      title: "CodingGuru Coach",
      style: "media/coach.css",
      script: "media/coach.js",
      body: COACH_BODY,
    });

    view.webview.onDidReceiveMessage((message: IncomingMessage) => {
      if (message.type === "ready") {
        this.ready = true;
        this.flush();
        return;
      }
      this.onRequest(message as CoachRequest);
    });

    view.onDidDispose(() => {
      this.view = undefined;
      this.ready = false;
    });
  }

  async reveal(): Promise<void> {
    if (this.view) {
      this.view.show?.(true);
      return;
    }
    await vscode.commands.executeCommand(`${COACH_VIEW_TYPE}.focus`);
  }

  post(message: unknown): void {
    if (this.view && this.ready) {
      void this.view.webview.postMessage(message);
    } else {
      this.buffer.push(message);
    }
  }

  private flush(): void {
    if (!this.view) {
      return;
    }
    for (const message of this.buffer.splice(0)) {
      void this.view.webview.postMessage(message);
    }
  }

  setContext(context: CoachContext): void {
    this.post({ type: "context", context });
  }

  user(text: string): void {
    this.post({ type: "user", text });
  }

  assistantStart(): void {
    this.post({ type: "assistantStart" });
  }

  delta(text: string): void {
    this.post({ type: "assistantDelta", text });
  }

  assistantEnd(): void {
    this.post({ type: "assistantEnd" });
  }

  notice(text: string, kind: "info" | "error" = "info"): void {
    this.post({ type: "notice", text, kind });
  }

  tool(name: string): void {
    this.post({ type: "tool", name });
  }

  review(result: ReviewResult): void {
    this.post({ type: "review", result });
  }

  busy(busy: boolean): void {
    this.post({ type: "busy", busy });
  }

  clear(): void {
    this.post({ type: "clear" });
  }
}

const COACH_BODY = `<header id="header">
  <div class="title" id="goal-title">No goal yet</div>
  <div class="crumb" id="task-title">Create a learning goal to get started.</div>
</header>
<div id="messages" class="messages">
  <div class="notice">Ask your coach anything about the current task. The coach reads your code but never edits it.</div>
</div>
<div class="actions" id="actions">
  <button data-action="review" title="Review the current task against its acceptance criteria">Review task</button>
  <button data-action="hint" title="Get a nudge without the full answer">Hint</button>
  <button data-action="explain" title="Explain the current task">Explain</button>
  <button data-action="progress" title="Ask how you are doing overall">Progress</button>
  <button data-action="lint" title="Run the workspace linter">Lint</button>
</div>
<form id="composer" autocomplete="off">
  <textarea id="input" rows="2" placeholder="Ask your coach…"></textarea>
  <button id="send" type="submit" title="Send">Send</button>
</form>`;
