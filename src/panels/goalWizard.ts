import * as vscode from "vscode";
import { GoalInput, Level } from "../model/types";
import { htmlShell } from "../views/webview";

const LEVELS: Level[] = ["beginner", "intermediate", "advanced"];

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function parseGoalInput(raw: unknown): GoalInput {
  const value = (raw ?? {}) as Record<string, unknown>;
  const title = asString(value.title);
  const description = asString(value.description);
  if (!title) {
    throw new Error("Give your goal a short title.");
  }
  if (description.length < 10) {
    throw new Error("Describe what you want to build in a sentence or two.");
  }
  const stack = asString(value.stack)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const levelValue = asString(value.level) as Level;
  const hours = Number(value.hoursPerWeek);
  return {
    title,
    description,
    stack,
    level: LEVELS.includes(levelValue) ? levelValue : "intermediate",
    hoursPerWeek: Number.isFinite(hours) && hours > 0 ? Math.min(60, Math.round(hours)) : undefined,
  };
}

/**
 * Collects the learner's goal, then hands it to `onSubmit` and reports progress
 * back into the panel while the syllabus is generated.
 */
export class GoalWizard {
  static show(
    extensionUri: vscode.Uri,
    onSubmit: (input: GoalInput, report: (message: string) => void) => Promise<void>
  ): void {
    const panel = vscode.window.createWebviewPanel(
      "codingguru.goalWizard",
      "CodingGuru: New Goal",
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, "media")],
      }
    );

    panel.webview.html = htmlShell({
      webview: panel.webview,
      extensionUri,
      title: "CodingGuru",
      style: "media/wizard.css",
      script: "media/wizard.js",
      body: WIZARD_BODY,
    });

    const report = (message: string) => void panel.webview.postMessage({ type: "status", message });

    panel.webview.onDidReceiveMessage(async (message: { type?: string; payload?: unknown }) => {
      if (message.type !== "submit") {
        return;
      }
      let input: GoalInput;
      try {
        input = parseGoalInput(message.payload);
      } catch (error) {
        void panel.webview.postMessage({
          type: "error",
          message: error instanceof Error ? error.message : String(error),
        });
        return;
      }
      void panel.webview.postMessage({ type: "busy", busy: true });
      try {
        await onSubmit(input, report);
        void panel.webview.postMessage({ type: "done" });
        setTimeout(() => panel.dispose(), 1200);
      } catch (error) {
        void panel.webview.postMessage({
          type: "error",
          message: error instanceof Error ? error.message : String(error),
        });
        void panel.webview.postMessage({ type: "busy", busy: false });
      }
    });
  }
}

const WIZARD_BODY = `<main>
  <h1>CodingGuru</h1>
  <p class="sub">
    Describe what you want to be able to build. CodingGuru turns it into a step-by-step
    syllabus, scaffolds a workspace, and coaches you through it.
  </p>
  <form id="form" autocomplete="off">
    <label>
      <span>Goal title</span>
      <input id="title" required placeholder="Build a REST API in Node.js" />
    </label>
    <label>
      <span>What do you want to build?</span>
      <textarea id="description" rows="4" required
        placeholder="I want to build a Node.js + Express app with PostgreSQL, user auth and a small React frontend…"></textarea>
    </label>
    <label>
      <span>Languages / stack <em>(comma separated)</em></span>
      <input id="stack" placeholder="Node.js, Express, PostgreSQL, React" />
    </label>
    <div class="row">
      <label>
        <span>Experience</span>
        <select id="level">
          <option value="beginner">Beginner</option>
          <option value="intermediate" selected>Intermediate</option>
          <option value="advanced">Advanced</option>
        </select>
      </label>
      <label>
        <span>Hours per week</span>
        <input id="hours" type="number" min="1" max="60" value="8" />
      </label>
    </div>
    <button id="submit" type="submit">Create goal &amp; generate syllabus</button>
  </form>
  <p id="status" class="status" role="status"></p>
</main>`;
