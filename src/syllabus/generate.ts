import { Goal, Section, Syllabus, Task } from "../model/types";
import { syllabusPrompt } from "../opencode/coach";
import { OpencodeService } from "../opencode/service";
import { newId, nowIso } from "../util/ids";

interface RawTask {
  title?: unknown;
  description?: unknown;
  acceptanceCriteria?: unknown;
  resources?: unknown;
  verification?: unknown;
  deliverable?: unknown;
  why?: unknown;
  concepts?: unknown;
  steps?: unknown;
}

interface RawSection {
  title?: unknown;
  description?: unknown;
  overview?: unknown;
  tasks?: unknown;
}

interface RawSyllabus {
  title?: unknown;
  sections?: unknown;
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function optionalStringArray(value: unknown): string[] | undefined {
  const items = toStringArray(value);
  return items.length ? items : undefined;
}

export async function generateSyllabus(
  service: OpencodeService,
  goal: Goal,
  sessionId: string
): Promise<Syllabus> {
  const raw = await service.promptJson<RawSyllabus>(
    goal.workspacePath,
    sessionId,
    syllabusPrompt(goal),
    "the syllabus"
  );

  const rawSections = Array.isArray(raw.sections) ? (raw.sections as RawSection[]) : [];
  const sections: Section[] = rawSections
    .filter((section) => section && typeof section.title === "string")
    .map((section) => {
      const rawTasks = Array.isArray(section.tasks) ? (section.tasks as RawTask[]) : [];
      const tasks: Task[] = rawTasks
        .filter((task) => task && typeof task.title === "string")
        .map((task) => ({
          id: newId("task"),
          title: String(task.title),
          description: typeof task.description === "string" ? task.description : "",
          acceptanceCriteria: toStringArray(task.acceptanceCriteria),
          resources: toStringArray(task.resources),
          verification: toStringArray(task.verification),
          deliverable: optionalString(task.deliverable),
          why: optionalString(task.why),
          concepts: optionalStringArray(task.concepts),
          steps: optionalStringArray(task.steps),
        }));
      return {
        id: newId("sec"),
        title: String(section.title),
        description: typeof section.description === "string" ? section.description : "",
        overview: optionalString(section.overview),
        tasks,
      };
    })
    .filter((section) => section.tasks.length > 0);

  if (sections.length === 0) {
    throw new Error("The coach returned an empty syllabus. Try again or make the goal more specific.");
  }

  return {
    goalId: goal.id,
    title: typeof raw.title === "string" && raw.title.trim() ? raw.title : goal.title,
    sections,
    generatedAt: nowIso(),
  };
}

export function countTasks(syllabus: Syllabus): number {
  return syllabus.sections.reduce((total, section) => total + section.tasks.length, 0);
}
