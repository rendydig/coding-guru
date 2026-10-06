import "./coach.css";
import { renderMarkdown } from "./markdown";

interface ReviewFinding {
  severity: "info" | "warning" | "error";
  message: string;
  file?: string;
  line?: number;
}

interface ReviewResult {
  verdict: "passed" | "needs_work";
  score: number;
  summary: string;
  findings: ReviewFinding[];
  nextSteps: string[];
}

interface CoachContext {
  hasGoal: boolean;
  goalTitle?: string;
  sectionTitle?: string;
  taskTitle?: string;
  status?: string;
}

interface HistoryEntry {
  sessionIndex: number;
  role: "user" | "assistant" | "summary" | "notice" | "review";
  text?: string;
  at: string;
  review?: ReviewResult;
}

const vscode = acquireVsCodeApi();

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) {
    throw new Error(`CodingGuru webview is missing #${id}`);
  }
  return node as T;
}

const messages = el<HTMLDivElement>("messages");
const input = el<HTMLTextAreaElement>("input");
const composer = el<HTMLFormElement>("composer");
const actions = el<HTMLDivElement>("actions");
const goalTitle = el<HTMLDivElement>("goal-title");
const taskTitle = el<HTMLDivElement>("task-title");

interface StreamingBubble {
  element: HTMLDivElement;
  body: HTMLDivElement;
  raw: string;
}

let current: StreamingBubble | null = null;
let renderQueued = false;
/** Follow new output unless the reader has scrolled up to read history. */
let stickToBottom = true;

// ---------------------------------------------------------------- events

composer.addEventListener("submit", (event) => {
  event.preventDefault();
  submitPrompt();
});

input.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    submitPrompt();
  }
});

actions.addEventListener("click", (event) => {
  const button = (event.target as HTMLElement | null)?.closest<HTMLElement>("button[data-action]");
  if (button?.dataset.action) {
    vscode.postMessage({ type: "action", action: button.dataset.action });
  }
});

messages.addEventListener("scroll", () => {
  const distance = messages.scrollHeight - messages.scrollTop - messages.clientHeight;
  stickToBottom = distance < 40;
});

// Delegated so handlers survive the frequent innerHTML re-renders while streaming.
messages.addEventListener("click", (event) => {
  const target = event.target as HTMLElement | null;
  if (!target) {
    return;
  }

  const copyButton = target.closest<HTMLElement>(".code-copy");
  if (copyButton) {
    const code = copyButton.closest(".code-block")?.querySelector("code");
    if (code) {
      // Read from the DOM rather than a data-attribute: no escaping a whole
      // snippet into markup.
      vscode.postMessage({ type: "copy", text: code.textContent ?? "" });
      copyButton.textContent = "Copied";
      window.setTimeout(() => {
        copyButton.textContent = "Copy";
      }, 1200);
    }
    return;
  }

  const link = target.closest<HTMLAnchorElement>("a[href]");
  if (link) {
    event.preventDefault();
    vscode.postMessage({ type: "openLink", href: link.getAttribute("href") ?? "" });
  }
});

function submitPrompt(): void {
  const text = input.value.trim();
  if (!text) {
    return;
  }
  input.value = "";
  vscode.postMessage({ type: "ask", text });
}

// ------------------------------------------------------------- messages

window.addEventListener("message", (event) => {
  const message = event.data;
  switch (message.type) {
    case "context":
      applyContext(message.context);
      break;
    case "user":
      appendBubble("user", renderMarkdown(message.text));
      break;
    case "assistantStart":
      current = createStreamingBubble();
      break;
    case "assistantDelta":
      if (current) {
        current.raw += message.text;
        scheduleRender();
      }
      break;
    case "assistantEnd":
      finishStreaming();
      break;
    case "notice":
      appendNotice(message.text, message.kind);
      break;
    case "tool":
      appendTool(message.name);
      break;
    case "review":
      appendReview(message.result);
      break;
    case "sessionDivider":
      appendDivider(message.index, message.at);
      break;
    case "summary":
      appendSummary(message.text, message.at);
      break;
    case "history":
      replay(message.entries);
      break;
    case "busy":
      input.disabled = message.busy;
      el<HTMLButtonElement>("send").disabled = message.busy;
      break;
    case "clear":
      messages.innerHTML = "";
      current = null;
      stickToBottom = true;
      break;
  }
});

function applyContext(context: CoachContext): void {
  goalTitle.textContent = context.hasGoal ? context.goalTitle || "Learning goal" : "No goal yet";
  if (!context.hasGoal) {
    taskTitle.textContent = "Create a learning goal to get started.";
    return;
  }
  const parts: string[] = [];
  if (context.sectionTitle) {
    parts.push(context.sectionTitle);
  }
  if (context.taskTitle) {
    parts.push(context.taskTitle);
  }
  if (context.status) {
    parts.push(`· ${context.status}`);
  }
  taskTitle.textContent = parts.join(" › ") || "Ask your coach anything.";
}

// -------------------------------------------------------------- rendering

/**
 * Coalesces the stream's deltas into one render per animation frame. Rendering
 * on every delta is quadratic over a reply and destroys text selection.
 */
function scheduleRender(): void {
  if (renderQueued) {
    return;
  }
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    if (current) {
      current.body.innerHTML = renderMarkdown(current.raw);
      scroll();
    }
  });
}

function finishStreaming(): void {
  if (current) {
    current.body.innerHTML = renderMarkdown(current.raw);
    current.element.classList.remove("streaming");
    scroll();
  }
  current = null;
}

function createStreamingBubble(): StreamingBubble {
  const element = document.createElement("div");
  element.className = "bubble assistant streaming";
  const body = document.createElement("div");
  body.className = "body";
  element.appendChild(body);
  append(element);
  return { element, body, raw: "" };
}

function appendBubble(kind: "user" | "assistant", html: string): void {
  const element = document.createElement("div");
  element.className = `bubble ${kind}`;
  const body = document.createElement("div");
  body.className = "body";
  body.innerHTML = html;
  element.appendChild(body);
  append(element);
}

function appendSummary(text: string, at: string): void {
  const element = document.createElement("div");
  element.className = "bubble summary";

  const label = document.createElement("div");
  label.className = "summary-label";
  // Static markup only — no interpolation.
  label.innerHTML =
    '<svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">' +
    '<path d="M3 2h10a1 1 0 0 1 1 1v11.5a.5.5 0 0 1-.77.42L8 12.2l-5.23 2.72A.5.5 0 0 1 2 14.5V3a1 1 0 0 1 1-1Z"/></svg>' +
    "<span>Session summary</span>";
  const stamp = document.createElement("span");
  stamp.className = "loc";
  stamp.textContent = formatStamp(at);
  label.appendChild(stamp);

  const body = document.createElement("div");
  body.className = "body";
  body.innerHTML = renderMarkdown(text);

  element.append(label, body);
  append(element);
}

function appendDivider(index: number, at: string): void {
  const divider = document.createElement("div");
  divider.className = "session-divider";
  const label = document.createElement("span");
  label.textContent = `Session ${index} · ${formatStamp(at)}`;
  divider.appendChild(label);
  append(divider);
}

function appendNotice(text: string, kind?: string): void {
  const notice = document.createElement("div");
  notice.className = kind === "error" ? "notice error" : "notice";
  notice.textContent = text;
  append(notice);
}

function appendTool(name: string): void {
  const tool = document.createElement("div");
  tool.className = "tool";
  tool.textContent = `⚙ ${name}`;
  append(tool);
}

function appendReview(result: ReviewResult): void {
  const card = document.createElement("div");
  card.className = `review ${result.verdict === "passed" ? "pass" : "fail"}`;
  const findings = (result.findings ?? [])
    .map(
      (finding) =>
        `<li class="sev-${escapeHtml(finding.severity)}">${escapeHtml(finding.message)}${
          finding.file
            ? ` <span class="loc">${escapeHtml(finding.file)}${finding.line ? `:${finding.line}` : ""}</span>`
            : ""
        }</li>`
    )
    .join("");
  const steps = (result.nextSteps ?? []).map((step) => `<li>${escapeHtml(step)}</li>`).join("");
  card.innerHTML = `
    <div class="review-head">
      <span class="verdict">${result.verdict === "passed" ? "✓ Passed" : "✗ Needs work"}</span>
      <span class="score">${result.score}/100</span>
    </div>
    <div class="review-summary">${escapeHtml(result.summary ?? "")}</div>
    ${findings ? `<ul class="findings">${findings}</ul>` : ""}
    ${steps ? `<div class="steps-title">Next steps</div><ul class="steps">${steps}</ul>` : ""}
  `;
  append(card);
}

function replay(entries: HistoryEntry[]): void {
  messages.innerHTML = "";
  current = null;
  if (!entries.length) {
    return;
  }
  // The first session has no boundary to mark; dividers only appear between them.
  let session = entries[0].sessionIndex;
  for (const entry of entries) {
    if (entry.sessionIndex !== session) {
      session = entry.sessionIndex;
      appendDivider(session, entry.at);
    }
    switch (entry.role) {
      case "user":
        appendBubble("user", renderMarkdown(entry.text ?? ""));
        break;
      case "assistant":
        appendBubble("assistant", renderMarkdown(entry.text ?? ""));
        break;
      case "summary":
        appendSummary(entry.text ?? "", entry.at);
        break;
      case "review":
        if (entry.review) {
          appendReview(entry.review);
        }
        break;
      case "notice":
        appendNotice(entry.text ?? "");
        break;
    }
  }
  stickToBottom = true;
  scroll();
}

// ---------------------------------------------------------------- helpers

function append(node: HTMLElement): void {
  messages.appendChild(node);
  stickToBottom = true;
  scroll();
}

function scroll(): void {
  if (stickToBottom) {
    messages.scrollTop = messages.scrollHeight;
  }
}

function formatStamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function escapeHtml(text: string): string {
  return String(text).replace(/[&<>"']/g, (char) => {
    switch (char) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}

vscode.postMessage({ type: "ready" });
