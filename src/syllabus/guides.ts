import * as path from "path";
import { docsDir, writeText } from "../model/store";
import { Goal, Section, Syllabus, Task } from "../model/types";
import { AUTHOR_AGENT, guidePrompt } from "../opencode/coach";
import { OpencodeService } from "../opencode/service";
import { taskFileName, taskGuideMarkdown } from "./documents";

/** Strips a single code fence wrapping the whole reply, which models sometimes add. */
function stripOuterFence(text: string): string {
  const trimmed = text.trim();
  const match = /^```[a-zA-Z0-9]*\s*\n([\s\S]*?)\n```$/.exec(trimmed);
  return match ? match[1].trim() : trimmed;
}

/**
 * Authors a task's build guide with the dedicated read-only author agent. Unlike
 * the coach, the author is expected to show complete code.
 */
export async function generateTaskGuide(
  service: OpencodeService,
  goal: Goal,
  syllabus: Syllabus,
  section: Section,
  task: Task,
  sessionId: string
): Promise<string> {
  const raw = await service.promptText(
    goal.workspacePath,
    sessionId,
    guidePrompt(goal, syllabus, section, task),
    AUTHOR_AGENT
  );
  const body = stripOuterFence(raw);
  if (!body) {
    throw new Error("The guide author returned an empty document.");
  }
  return body;
}

/** Writes the composed guide to `docs/`, overwriting any cached copy. */
export function writeTaskGuide(
  goal: Goal,
  section: Section,
  task: Task,
  sectionIndex: number,
  taskIndex: number,
  body: string
): string {
  const file = path.join(docsDir(goal.workspacePath), taskFileName(task, sectionIndex, taskIndex));
  writeText(file, taskGuideMarkdown(goal, section, task, sectionIndex, taskIndex, body));
  return file;
}
