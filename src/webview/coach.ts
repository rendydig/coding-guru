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

type ToolStatus = "pending" | "running" | "completed" | "error";

interface ToolActivity {
  callID: string;
  name: string;
  status: ToolStatus;
  title?: string;
  target?: string;
}

interface HistoryEntry {
  sessionIndex: number;
  role: "user" | "assistant" | "summary" | "notice" | "review";
  text?: string;
  at: string;
  reasoning?: string;
  tools?: ToolActivity[];
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

interface Bubble {
  element: HTMLDivElement;
  raw: string;
  /** Re-renders the body, honoring the raw/rendered toggle. */
  paint: () => void;
}

interface ThinkingBlock {
  root: HTMLDetailsElement;
  label: HTMLElement;
  reasoning: HTMLDivElement;
  list: HTMLDivElement;
  rows: Map<string, HTMLDivElement>;
  raw: string;
  count: number;
  collapsed: boolean;
  /** Created lazily with the first reasoning delta, so tool-only turns have no toggle. */
  actions?: HTMLDivElement;
  paintReasoning?: () => void;
}

let current: Bubble | null = null;
let thinking: ThinkingBlock | null = null;
let renderQueued = false;
let thinkingRenderQueued = false;
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
      appendBubble("user", message.text);
      break;
    case "assistantStart":
      current = createStreamingBubble();
      thinking = null;
      break;
    case "assistantDelta":
      if (current) {
        // The answer is starting — fold the activity block away.
        if (thinking && thinking.root.open && !thinking.collapsed) {
          thinking.root.open = false;
          thinking.collapsed = true;
        }
        current.raw += message.text;
        scheduleRender();
      }
      break;
    case "thinkingDelta":
      appendReasoning(message.text);
      break;
    case "assistantEnd":
      finishStreaming();
      finalizeThinking();
      break;
    case "notice":
      appendNotice(message.text, message.kind);
      break;
    case "tool":
      appendTool(message.tool);
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
      thinking = null;
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
 * Adds a `</>` toggle that flips `body` between rendered Markdown and the raw
 * source. Returns the paint function so callers can re-render while streaming.
 */
function attachRawToggle(host: HTMLElement, body: HTMLElement, raw: () => string): () => void {
  let rawMode = false;
  const button = document.createElement("button");
  button.className = "raw-toggle";
  button.type = "button";
  button.textContent = "</>";

  const paint = (): void => {
    if (rawMode) {
      const pre = document.createElement("pre");
      pre.className = "raw";
      pre.textContent = raw();
      body.replaceChildren(pre);
    } else {
      body.innerHTML = renderMarkdown(raw());
    }
    button.classList.toggle("active", rawMode);
    button.title = rawMode ? "Show rendered" : "Show raw markdown";
    button.setAttribute("aria-label", button.title);
  };

  button.addEventListener("click", (event) => {
    event.stopPropagation();
    event.preventDefault();
    rawMode = !rawMode;
    paint();
    scroll();
  });

  host.appendChild(button);
  return paint;
}

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
      current.paint();
      scroll();
    }
  });
}

function finishStreaming(): void {
  if (current) {
    current.paint();
    current.element.classList.remove("streaming");
    scroll();
  }
  current = null;
}

function createBubble(kind: "user" | "assistant", raw: string, streaming: boolean): Bubble {
  const element = document.createElement("div");
  element.className = `bubble ${kind}${streaming ? " streaming" : ""}`;
  const body = document.createElement("div");
  body.className = "body";
  element.appendChild(body);
  const bubble: Bubble = { element, raw, paint: () => undefined };
  const paint = attachRawToggle(element, body, () => bubble.raw);
  bubble.paint = paint;
  paint();
  return bubble;
}

function createStreamingBubble(): Bubble {
  const bubble = createBubble("assistant", "", true);
  append(bubble.element);
  return bubble;
}

function appendBubble(kind: "user" | "assistant", raw: string): void {
  append(createBubble(kind, raw, false).element);
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

function ensureThinking(): ThinkingBlock {
  if (thinking) {
    return thinking;
  }
  const root = document.createElement("details");
  root.className = "thinking";
  root.open = true;
  const label = document.createElement("summary");
  label.className = "thinking-label";
  label.textContent = "Thinking…";
  const reasoning = document.createElement("div");
  reasoning.className = "thinking-reasoning";
  const list = document.createElement("div");
  list.className = "tool-list";
  root.append(label, reasoning, list);
  // Placed above the streaming reply, so the activity reads before the answer.
  if (current) {
    current.element.before(root);
    stickToBottom = true;
    scroll();
  } else {
    append(root);
  }
  thinking = { root, label, reasoning, list, rows: new Map(), raw: "", count: 0, collapsed: false };
  return thinking;
}

function appendReasoning(text: string): void {
  const block = ensureThinking();
  if (!block.actions) {
    const actions = document.createElement("div");
    actions.className = "thinking-actions";
    block.reasoning.before(actions);
    block.actions = actions;
    block.paintReasoning = attachRawToggle(actions, block.reasoning, () => block.raw);
  }
  block.raw += text;
  scheduleThinkingRender();
}

/** Coalesces reasoning deltas into one render per frame, like scheduleRender. */
function scheduleThinkingRender(): void {
  if (thinkingRenderQueued) {
    return;
  }
  thinkingRenderQueued = true;
  requestAnimationFrame(() => {
    thinkingRenderQueued = false;
    if (thinking) {
      thinking.paintReasoning?.();
      scroll();
    }
  });
}

function appendTool(activity: ToolActivity): void {
  const block = ensureThinking();
  let row = block.rows.get(activity.callID);
  if (!row) {
    row = createToolRow(activity);
    block.rows.set(activity.callID, row);
    block.list.appendChild(row);
    block.count += 1;
  }
  updateToolRow(row, activity);
  scroll();
}

function createToolRow(activity: ToolActivity): HTMLDivElement {
  const row = document.createElement("div");
  row.className = "tool-row";
  const icon = document.createElement("span");
  icon.className = "tool-status";
  const name = document.createElement("span");
  name.className = "tool-name";
  name.textContent = activity.name;
  const target = document.createElement("span");
  target.className = "tool-target";
  row.append(icon, name, target);
  return row;
}

function updateToolRow(row: HTMLDivElement, activity: ToolActivity): void {
  const icon = row.querySelector<HTMLElement>(".tool-status");
  if (icon) {
    icon.className = `tool-status ${activity.status}`;
    icon.textContent = activity.status === "completed" ? "✓" : activity.status === "error" ? "✗" : "";
  }
  const target = row.querySelector<HTMLElement>(".tool-target");
  const label = activity.target ?? activity.title ?? "";
  if (target) {
    target.textContent = label;
    target.title = label;
  }
}

function finalizeThinking(): void {
  if (!thinking) {
    return;
  }
  thinking.root.open = false;
  const steps = thinking.count;
  thinking.label.textContent = steps ? `Thought · ${steps} step${steps === 1 ? "" : "s"}` : "Thought";
  thinking = null;
}

/** Renders a persisted activity block for replay; collapsed like a finished turn. */
function appendThinkingFromHistory(reasoning: string | undefined, tools: ToolActivity[]): void {
  const root = document.createElement("details");
  root.className = "thinking";
  const label = document.createElement("summary");
  label.className = "thinking-label";
  const steps = tools.length;
  label.textContent = steps ? `Thought · ${steps} step${steps === 1 ? "" : "s"}` : "Thought";
  root.appendChild(label);
  if (reasoning) {
    const actions = document.createElement("div");
    actions.className = "thinking-actions";
    const body = document.createElement("div");
    body.className = "thinking-reasoning";
    attachRawToggle(actions, body, () => reasoning)();
    root.append(actions, body);
  }
  if (tools.length) {
    const list = document.createElement("div");
    list.className = "tool-list";
    for (const tool of tools) {
      const row = createToolRow(tool);
      updateToolRow(row, tool);
      list.appendChild(row);
    }
    root.appendChild(list);
  }
  append(root);
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
  thinking = null;
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
        appendBubble("user", entry.text ?? "");
        break;
      case "assistant":
        if (entry.reasoning || entry.tools?.length) {
          appendThinkingFromHistory(entry.reasoning, entry.tools ?? []);
        }
        appendBubble("assistant", entry.text ?? "");
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
