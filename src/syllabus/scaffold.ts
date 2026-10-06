import * as fs from "fs";
import * as path from "path";
import { Goal, GoalInput, Progress, Syllabus } from "../model/types";
import {
  AGENTS_FILE,
  cgDir,
  coachPromptFile,
  ensureDir,
  goalFile,
  opencodeConfigFile,
  progressFile,
  slugify,
  syllabusFile,
  workspaceRoot,
  writeJson,
  writeText,
} from "../model/store";
import { buildOpencodeConfig, COACH_PERSONA } from "../opencode/coach";
import { newId, nowIso } from "../util/ids";
import { sectionFileName, taskFileName, writeDocuments } from "./documents";

export function uniqueWorkspacePath(title: string): { slug: string; workspacePath: string } {
  const root = workspaceRoot();
  ensureDir(root);
  const base = slugify(title);
  let slug = base;
  let candidate = path.join(root, slug);
  let counter = 2;
  while (fs.existsSync(candidate)) {
    slug = `${base}-${counter++}`;
    candidate = path.join(root, slug);
  }
  return { slug, workspacePath: candidate };
}

export function createGoal(input: GoalInput): Goal {
  const { slug, workspacePath } = uniqueWorkspacePath(input.title);
  return {
    id: newId("goal"),
    slug,
    title: input.title.trim(),
    description: input.description.trim(),
    stack: input.stack,
    level: input.level,
    hoursPerWeek: input.hoursPerWeek,
    createdAt: nowIso(),
    workspacePath,
  };
}

/** Creates the workspace directory and the files the coach needs to start. */
export function prepareWorkspace(goal: Goal, model: string, allowBash: boolean): void {
  ensureDir(cgDir(goal.workspacePath));
  writeJson(goalFile(goal.workspacePath), goal);

  const progress: Progress = { goalId: goal.id, tasks: {}, updatedAt: nowIso() };
  writeJson(progressFile(goal.workspacePath), progress);

  writeText(coachPromptFile(goal.workspacePath), COACH_PERSONA + "\n");
  writeJson(opencodeConfigFile(goal.workspacePath), buildOpencodeConfig({ model, allowBash }));
  writeText(path.join(goal.workspacePath, AGENTS_FILE), agentsMd(goal));
}

export function writeSyllabus(goal: Goal, syllabus: Syllabus): void {
  writeJson(syllabusFile(goal.workspacePath), syllabus);
  writeText(path.join(goal.workspacePath, "README.md"), readme(goal, syllabus));
  writeDocuments(goal, syllabus);
}

function agentsMd(goal: Goal): string {
  return `# CodingGuru learning workspace

This folder is a **learning workspace** for the goal: **${goal.title}**.

## Rules for AI agents in this folder

- This workspace exists for a human to learn by writing code themselves.
- Do **not** write or refactor the learner's code for them unless they explicitly ask for a change.
- Prefer explanations, hints, and guiding questions over patches.
- The CodingGuru coach agent (\`codingguru-coach\`) is read-only by design: it never edits files.

## Structure

- \`.codingguru/goal.json\` — the learning goal
- \`.codingguru/syllabus.json\` — sections and tasks
- \`.codingguru/progress.json\` — per-task status and review notes
- \`.codingguru/coach-prompt.md\` — the coach persona
- \`docs/\` — one build guide per section and per task
- \`opencode.json\` — the read-only coach agent definition
`;
}

function docsLink(fileName: string): string {
  return `docs/${fileName}`;
}

function readme(goal: Goal, syllabus: Syllabus): string {
  const lines = [
    `# ${goal.title}`,
    "",
    goal.description,
    "",
    `**Stack:** ${goal.stack.join(", ") || "unspecified"}  `,
    `**Level:** ${goal.level}${goal.hoursPerWeek ? `  \n**Time budget:** ${goal.hoursPerWeek} h/week` : ""}`,
    "",
    "## Syllabus",
    "",
  ];
  syllabus.sections.forEach((section, sectionIndex) => {
    lines.push(`### ${sectionIndex + 1}. ${section.title}`, "");
    if (section.description) {
      lines.push(section.description, "");
    }
    lines.push(`[Read the full section guide](${docsLink(sectionFileName(section, sectionIndex))})`, "");
    section.tasks.forEach((task, taskIndex) => {
      const guide = docsLink(taskFileName(task, sectionIndex, taskIndex));
      lines.push(`- [ ] **${task.title}** — ${task.description} · [guide](${guide})`);
      for (const criterion of task.acceptanceCriteria) {
        lines.push(`  - _done when:_ ${criterion}`);
      }
    });
    lines.push("");
  });
  lines.push(
    "---",
    "",
    "Each task links to a build guide under `docs/` that explains what you will",
    "build and why. Work through the tasks in order. When you think a task is",
    "finished, run **CodingGuru: Review Task with Coach** from the command palette",
    "(or the check icon in the Syllabus view) to get it reviewed.",
    ""
  );
  return lines.join("\n");
}
