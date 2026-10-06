const vscode = acquireVsCodeApi();
const form = document.getElementById("form");
const status = document.getElementById("status");
const submit = document.getElementById("submit");

const IDLE_LABEL = "Create goal & generate syllabus";

form.addEventListener("submit", (event) => {
  event.preventDefault();
  setStatus("", "");
  vscode.postMessage({
    type: "submit",
    payload: {
      title: document.getElementById("title").value,
      description: document.getElementById("description").value,
      stack: document.getElementById("stack").value,
      level: document.getElementById("level").value,
      hoursPerWeek: document.getElementById("hours").value,
    },
  });
});

window.addEventListener("message", (event) => {
  const message = event.data;
  switch (message.type) {
    case "busy":
      submit.disabled = message.busy;
      submit.textContent = message.busy ? "Working…" : IDLE_LABEL;
      break;
    case "status":
      setStatus(message.message, "");
      break;
    case "error":
      setStatus(message.message, "error");
      submit.disabled = false;
      submit.textContent = IDLE_LABEL;
      break;
    case "done":
      setStatus("Done! Opening your learning workspace…", "ok");
      break;
  }
});

function setStatus(text, kind) {
  status.textContent = text;
  status.className = kind ? `status ${kind}` : "status";
}
