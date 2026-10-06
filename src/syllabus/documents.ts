import * as path from "path";
import { docsDir, slugify, writeText } from "../model/store";
import { Goal, Section, Syllabus, Task } from "../model/types";

const INDEX_FILE = "README.md";

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** File name of a section's overview document, relative to `docs/`. */
export function sectionFileName(section: Section, index: number): string {
  return `${pad(index + 1)}-${slugify(section.title)}.md`;
}

/** File name of a task's document, relative to `docs/`. */
export function taskFileName(task: Task, sectionIndex: number, taskIndex: number): string {
  return `${pad(sectionIndex + 1)}-${pad(taskIndex + 1)}-${slugify(task.title)}.md`;
}

function docsIndex(goal: Goal, syllabus: Syllabus): string {
  const lines = [
    `# ${goal.title} — build guide`,
    "",
    goal.description,
    "",
    `**Stack:** ${goal.stack.join(", ") || "unspecified"}  `,
    `**Level:** ${goal.level}`,
    "",
    "Work through the sections in order. Every task has its own guide describing what you will build.",
    "",
  ];
  syllabus.sections.forEach((section, sectionIndex) => {
    lines.push(`## ${sectionIndex + 1}. ${section.title}`, "");
    const overview = section.overview || section.description;
    if (overview) {
      lines.push(overview, "");
    }
    lines.push(`[Open section guide](${sectionFileName(section, sectionIndex)})`, "");
    section.tasks.forEach((task, taskIndex) => {
      lines.push(`- [ ] [${task.title}](${taskFileName(task, sectionIndex, taskIndex)})`);
    });
    lines.push("");
  });
  lines.push("---", "", "Back to the [workspace overview](../README.md).", "");
  return lines.join("\n");
}

function sectionDoc(goal: Goal, syllabus: Syllabus, section: Section, sectionIndex: number): string {
  const lines = [
    `# ${sectionIndex + 1}. ${section.title}`,
    "",
    `[${goal.title}](../README.md) › [Build guide](README.md)`,
    "",
  ];
  const overview = section.overview || section.description;
  if (overview) {
    lines.push("## What you'll build", "", overview, "");
  }
  lines.push("## Tasks in this section", "");
  section.tasks.forEach((task, taskIndex) => {
    lines.push(`- [ ] [${task.title}](${taskFileName(task, sectionIndex, taskIndex)})`);
    if (task.description) {
      lines.push(`  - ${task.description}`);
    }
  });
  lines.push("");

  const previous = sectionIndex > 0 ? syllabus.sections[sectionIndex - 1] : undefined;
  const next = syllabus.sections[sectionIndex + 1];
  const nav: string[] = [];
  if (previous) {
    nav.push(`[← ${sectionIndex}. ${previous.title}](${sectionFileName(previous, sectionIndex - 1)})`);
  }
  if (next) {
    nav.push(`[${sectionIndex + 2}. ${next.title} →](${sectionFileName(next, sectionIndex + 1)})`);
  }
  if (nav.length) {
    lines.push(nav.join(" · "), "");
  }
  return lines.join("\n");
}

function taskDoc(goal: Goal, section: Section, task: Task, sectionIndex: number, taskIndex: number): string {
  const lines = [
    `# ${sectionIndex + 1}.${taskIndex + 1} ${task.title}`,
    "",
    `[${goal.title}](../README.md) › [${section.title}](${sectionFileName(section, sectionIndex)})`,
    "",
  ];
  if (task.description) {
    lines.push(`> ${task.description}`, "");
  }

  lines.push("## What you'll build", "", task.deliverable || task.description || task.title, "");
  if (task.why) {
    lines.push("## Why it matters", "", task.why, "");
  }
  if (task.concepts?.length) {
    lines.push("## Concepts", "", ...task.concepts.map((concept) => `- ${concept}`), "");
  }
  if (task.steps?.length) {
    lines.push("## Suggested steps", "", ...task.steps.map((step, index) => `${index + 1}. ${step}`), "");
  }
  if (task.acceptanceCriteria.length) {
    lines.push("## Acceptance criteria", "", ...task.acceptanceCriteria.map((item) => `- [ ] ${item}`), "");
  }
  if (task.verification?.length) {
    lines.push("## How to verify", "", ...task.verification.map((step) => `- \`${step}\``), "");
  }
  if (task.resources?.length) {
    lines.push("## Resources", "", ...task.resources.map((resource) => `- ${resource}`), "");
  }

  const previous = taskIndex > 0 ? section.tasks[taskIndex - 1] : undefined;
  const next = taskIndex < section.tasks.length - 1 ? section.tasks[taskIndex + 1] : undefined;
  const nav: string[] = [];
  if (previous) {
    nav.push(`[← ${previous.title}](${taskFileName(previous, sectionIndex, taskIndex - 1)})`);
  }
  if (next) {
    nav.push(`[${next.title} →](${taskFileName(next, sectionIndex, taskIndex + 1)})`);
  }
  if (nav.length) {
    lines.push(nav.join(" · "), "");
  }
  return lines.join("\n");
}

/**
 * Writes the `docs/` build guides: one index, one overview per section, and one
 * document per task. Deterministic — the content comes from the syllabus, so no
 * extra model call is needed. Returns the absolute paths written.
 */
export function writeDocuments(goal: Goal, syllabus: Syllabus): string[] {
  const dir = docsDir(goal.workspacePath);
  const written: string[] = [];
  const write = (name: string, content: string): void => {
    const file = path.join(dir, name);
    writeText(file, content);
    written.push(file);
  };

  write(INDEX_FILE, docsIndex(goal, syllabus));
  syllabus.sections.forEach((section, sectionIndex) => {
    write(sectionFileName(section, sectionIndex), sectionDoc(goal, syllabus, section, sectionIndex));
    section.tasks.forEach((task, taskIndex) => {
      write(taskFileName(task, sectionIndex, taskIndex), taskDoc(goal, section, task, sectionIndex, taskIndex));
    });
  });
  return written;
}
