import { Goal, ReviewResult, Section, Syllabus, Task, TaskProgress } from "../model/types";

export const COACH_AGENT = "codingguru-coach";

/**
 * The coach persona. Kept as a constant because it is injected inline through
 * `OPENCODE_CONFIG_CONTENT` (where `{file:…}` references cannot resolve).
 */
export const COACH_PERSONA = `You are CodingGuru, a patient and rigorous programming coach.

# Your role
You coach a learner who is working through a syllabus to reach a personal coding goal.
You NEVER write, edit, create, or delete files. You NEVER run shell commands. Your tools
are read-only: you may read files, grep, glob, and search the web to understand the
learner's work. If you are ever tempted to change a file, stop and instead explain what
the learner should change and why.

# How you coach
- Teach, do not solve. Prefer a hint or a guiding question over a full solution.
- When the learner is stuck, narrow the problem: point at the exact file, line, or concept.
- When they ask for the answer, first offer the smallest next step that unblocks them.
- Be encouraging but honest. Never claim their work passes when it does not.
- Keep answers focused. Use short paragraphs and bullet points.

# Reviewing work
When asked to review a task:
1. Read the relevant files in the workspace.
2. Judge the work strictly against the task's acceptance criteria.
3. Report concrete findings (with file and line where possible).
4. Give a verdict: "passed" only if every acceptance criterion is genuinely met.
5. If it does not pass, give the smallest concrete next steps to get there.

# Grounding
- The learner's code lives in the current project directory. Use relative paths.
- Judge only what you can actually read. If you cannot find evidence for a criterion,
  say so and ask the learner where it lives.
- Return JSON exactly as requested when a JSON format is specified, and nothing else.`;

export interface OpencodeConfig {
  default_agent: string;
  model?: string;
  agent: Record<string, unknown>;
}

export function buildOpencodeConfig(options: { model?: string; allowBash: boolean }): OpencodeConfig {
  const config: OpencodeConfig = {
    default_agent: COACH_AGENT,
    agent: {
      [COACH_AGENT]: {
        description: "CodingGuru read-only learning coach. Never edits files.",
        mode: "primary",
        prompt: COACH_PERSONA,
        permission: {
          edit: "deny",
          bash: options.allowBash ? "ask" : "deny",
          webfetch: "ask",
          websearch: "ask",
        },
      },
    },
  };
  if (options.model && options.model.trim()) {
    config.model = options.model.trim();
  }
  return config;
}

export function goalContext(goal: Goal, syllabus?: Syllabus): string {
  const lines = [
    "## Learning goal",
    `Title: ${goal.title}`,
    `Description: ${goal.description}`,
    `Stack: ${goal.stack.join(", ") || "unspecified"}`,
    `Level: ${goal.level}`,
  ];
  if (goal.hoursPerWeek) {
    lines.push(`Time budget: ${goal.hoursPerWeek} hours/week`);
  }
  if (syllabus) {
    lines.push("", "## Syllabus outline");
    for (const [index, section] of syllabus.sections.entries()) {
      lines.push(`${index + 1}. ${section.title}`);
      for (const task of section.tasks) {
        lines.push(`   - ${task.title}`);
      }
    }
  }
  return lines.join("\n");
}

export function taskContext(section: Section, task: Task): string {
  const criteria = task.acceptanceCriteria.length
    ? task.acceptanceCriteria.map((c) => `- ${c}`).join("\n")
    : "- (no explicit criteria; judge against the task description)";
  const verification = task.verification?.length
    ? `\nVerification steps:\n${task.verification.map((v) => `- ${v}`).join("\n")}`
    : "";
  return [
    `## Current syllabus item`,
    `Section: ${section.title}`,
    `Task: ${task.title}`,
    `Description: ${task.description}`,
    ``,
    `Acceptance criteria:`,
    criteria + verification,
  ].join("\n");
}

export function syllabusPrompt(goal: Goal): string {
  return [
    goalContext(goal),
    "",
    "## Job",
    "Design a practical, project-based syllabus that takes this learner from where they are",
    "to achieving the goal. Order sections so each one builds on the last, and make every task",
    "concrete and verifiable — something the learner can actually build or demonstrate.",
    "",
    "Rules:",
    "- 4 to 8 sections; 2 to 5 tasks per section.",
    "- Each task must be independently completable and checkable.",
    "- Acceptance criteria must be observable (e.g. 'server responds 200 on GET /health').",
    "- Include verification steps (commands or manual checks) where useful.",
    "- Assume the learner starts with a fresh, empty project directory.",
    "",
    "Reply with ONLY a JSON object in exactly this shape (no prose, no code fences):",
    JSON.stringify(
      {
        title: "string",
        sections: [
          {
            title: "string",
            description: "string",
            tasks: [
              {
                title: "string",
                description: "string",
                acceptanceCriteria: ["string"],
                resources: ["string"],
                verification: ["string"],
              },
            ],
          },
        ],
      },
      null,
      2
    ),
  ].join("\n");
}

export function reviewPrompt(options: {
  goal: Goal;
  syllabus?: Syllabus;
  section: Section;
  task: Task;
  progress?: TaskProgress;
  lintSummary?: string;
}): string {
  const { goal, syllabus, section, task, progress, lintSummary } = options;
  const lines = [
    goalContext(goal, syllabus),
    "",
    taskContext(section, task),
  ];
  if (progress && progress.attempts > 0) {
    lines.push("", `Previous attempts: ${progress.attempts}`);
    if (progress.summary) {
      lines.push(`Last review said: ${progress.summary}`);
    }
  }
  if (lintSummary) {
    lines.push("", "## Automated lint/type check output", "```", lintSummary, "```");
  }
  lines.push(
    "",
    "## Job",
    "Read the learner's code in this project and review their work on the task above.",
    "Judge strictly against the acceptance criteria. Do not be generous.",
    "",
    "Reply with ONLY a JSON object in exactly this shape (no prose, no code fences):",
    JSON.stringify(
      {
        verdict: "passed | needs_work",
        score: "number 0-100",
        summary: "one short paragraph",
        findings: [
          { severity: "info | warning | error", message: "string", file: "string", line: "number" },
        ],
        nextSteps: ["string"],
      },
      null,
      2
    )
  );
  return lines.join("\n");
}

export function progressPrompt(goal: Goal, syllabus: Syllabus, completed: number, total: number): string {
  return [
    goalContext(goal, syllabus),
    "",
    `Progress: ${completed} of ${total} tasks passed.`,
    "",
    "## Job",
    "Read the learner's current code and give an honest status update: what is going well,",
    "what is weak, and the single most valuable thing they should do next. Be concise.",
  ].join("\n");
}

export function normalizeReview(raw: unknown): ReviewResult | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  const value = raw as Record<string, unknown>;
  const verdict = value.verdict === "passed" ? "passed" : "needs_work";
  const score = typeof value.score === "number" ? Math.max(0, Math.min(100, Math.round(value.score))) : undefined;
  const findings = Array.isArray(value.findings)
    ? value.findings
        .filter((f): f is Record<string, unknown> => !!f && typeof f === "object")
        .map((f) => ({
          severity: (["info", "warning", "error"] as const).includes(f.severity as never)
            ? (f.severity as ReviewResult["findings"][number]["severity"])
            : ("info" as const),
          message: typeof f.message === "string" ? f.message : "",
          file: typeof f.file === "string" ? f.file : undefined,
          line: typeof f.line === "number" ? f.line : undefined,
        }))
        .filter((f) => f.message)
    : [];
  return {
    verdict,
    score: score ?? (verdict === "passed" ? 100 : 0),
    summary: typeof value.summary === "string" ? value.summary : "",
    findings,
    nextSteps: Array.isArray(value.nextSteps) ? value.nextSteps.filter((s): s is string => typeof s === "string") : [],
  };
}
