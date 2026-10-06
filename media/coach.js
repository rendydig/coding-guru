const vscode = acquireVsCodeApi();
const messages = document.getElementById("messages");
const input = document.getElementById("input");
const composer = document.getElementById("composer");
const actions = document.getElementById("actions");
const goalTitle = document.getElementById("goal-title");
const taskTitle = document.getElementById("task-title");

let current = null;

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
  const button = event.target.closest("button[data-action]");
  if (!button) {
    return;
  }
  vscode.postMessage({ type: "action", action: button.dataset.action });
});

function submitPrompt() {
  const text = input.value.trim();
  if (!text) {
    return;
  }
  input.value = "";
  vscode.postMessage({ type: "ask", text });
}

window.addEventListener("message", (event) => {
  const message = event.data;
  switch (message.type) {
    case "context":
      applyContext(message.context);
      break;
    case "user":
      appendBubble("user", escapeHtml(message.text));
      break;
    case "assistantStart":
      current = appendBubble("assistant", "", true);
      break;
    case "assistantDelta":
      if (current) {
        current.raw += message.text;
        current.body.innerHTML = renderMarkdown(current.raw);
        scroll();
      }
      break;
    case "assistantEnd":
      current = null;
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
    case "busy":
      input.disabled = message.busy;
      document.getElementById("send").disabled = message.busy;
      break;
    case "clear":
      messages.innerHTML = "";
      current = null;
      break;
  }
});

function applyContext(context) {
  goalTitle.textContent = context.hasGoal ? context.goalTitle || "Learning goal" : "No goal yet";
  if (!context.hasGoal) {
    taskTitle.textContent = "Create a learning goal to get started.";
    return;
  }
  const parts = [];
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

function appendBubble(kind, html, streaming) {
  const bubble = document.createElement("div");
  bubble.className = `bubble ${kind}`;
  const body = document.createElement("div");
  body.className = "body";
  body.innerHTML = html;
  bubble.appendChild(body);
  messages.appendChild(bubble);
  scroll();
  return streaming ? { element: bubble, body, raw: "" } : null;
}

function appendNotice(text, kind) {
  const notice = document.createElement("div");
  notice.className = kind === "error" ? "notice error" : "notice";
  notice.textContent = text;
  messages.appendChild(notice);
  scroll();
}

function appendTool(name) {
  const tool = document.createElement("div");
  tool.className = "tool";
  tool.textContent = `⚙ ${name}`;
  messages.appendChild(tool);
  scroll();
}

function appendReview(result) {
  const card = document.createElement("div");
  card.className = `review ${result.verdict === "passed" ? "pass" : "fail"}`;
  const findings = (result.findings || [])
    .map(
      (finding) =>
        `<li class="sev-${finding.severity}">${escapeHtml(finding.message)}${
          finding.file ? ` <span class="loc">${escapeHtml(finding.file)}${finding.line ? `:${finding.line}` : ""}</span>` : ""
        }</li>`
    )
    .join("");
  const steps = (result.nextSteps || []).map((step) => `<li>${escapeHtml(step)}</li>`).join("");
  card.innerHTML = `
    <div class="review-head">
      <span class="verdict">${result.verdict === "passed" ? "✓ Passed" : "✗ Needs work"}</span>
      <span class="score">${result.score}/100</span>
    </div>
    <div class="review-summary">${escapeHtml(result.summary || "")}</div>
    ${findings ? `<ul class="findings">${findings}</ul>` : ""}
    ${steps ? `<div class="steps-title">Next steps</div><ul class="steps">${steps}</ul>` : ""}
  `;
  messages.appendChild(card);
  scroll();
}

function scroll() {
  messages.scrollTop = messages.scrollHeight;
}

function escapeHtml(text) {
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

function renderMarkdown(text) {
  const segments = text.split("```");
  return segments
    .map((segment, index) => {
      if (index % 2 === 1) {
        return `<pre><code>${escapeHtml(segment.replace(/^[a-zA-Z]*\n/, ""))}</code></pre>`;
      }
      return escapeHtml(segment)
        .replace(/`([^`]+)`/g, "<code>$1</code>")
        .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
        .replace(/\n/g, "<br>");
    })
    .join("");
}

vscode.postMessage({ type: "ready" });
