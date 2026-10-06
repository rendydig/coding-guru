import { Goal, ReviewResult, Section, Syllabus, Task, TaskProgress } from "../model/types";

export const COACH_AGENT = "codingguru-coach";

export const AUTHOR_AGENT = "codingguru-author";

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
When asked to review a task, review ONLY that task. Other tasks and sections are
out of scope, even if their criteria appear in files you read.
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

/**
 * The guide author. Unlike the coach it *is* expected to show complete code,
 * because its output is a reference manual rather than a nudge. It stays
 * read-only: it only ever writes text back to us.
 */
export const AUTHOR_PERSONA = `You are CodingGuru's build-guide author.
You write the manual a learner follows to complete ONE syllabus task, start to finish.
Unlike a tutor, you ARE expected to show complete, runnable code and exact commands.

# What you produce
- A single Markdown document, ready to read. No preamble, no "here is your guide", no closing remarks.
- Never wrap the whole document in a code fence.
- Assume a beginner: never reference a file, tool, or concept you have not introduced.

# Required sections, in this order
## Before you start
Prerequisites and setup. Give copy-pasteable commands and name the exact files or folders to create.
## Step by step
4 to 8 numbered steps. Each step names the file or command it touches and the result the learner should see.
## Full example
Complete, runnable code for this task, with the file path above each block. This is a reference — say that the learner should still type it themselves.
## Watch out for
The mistakes people make on this task and how to avoid them.

# Rules
- Stay on this one task; do not solve the whole project.
- You NEVER write, edit, create, or delete files and NEVER run shell commands. You only write text.
- Match the learner's stack and level. Keep it focused and skimmable.`;

export interface OpencodeConfig {
  default_agent: string;
  model?: string;
  agent: Record<string, unknown>;
}

export function buildOpencodeConfig(options: { model?: string; allowBash: boolean }): OpencodeConfig {
  const permission = {
    edit: "deny",
    bash: options.allowBash ? "ask" : "deny",
    webfetch: "ask",
    websearch: "ask",
  };
  const config: OpencodeConfig = {
    default_agent: COACH_AGENT,
    agent: {
      [COACH_AGENT]: {
        description: "CodingGuru read-only learning coach. Never edits files.",
        mode: "primary",
        prompt: COACH_PERSONA,
        permission,
      },
      [AUTHOR_AGENT]: {
        description: "CodingGuru read-only build-guide author. Never edits files.",
        mode: "primary",
        prompt: AUTHOR_PERSONA,
        permission,
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
  const lines = [
    `## Current syllabus item`,
    `Section: ${section.title}`,
    `Task: ${task.title}`,
    `Description: ${task.description}`,
  ];
  if (task.deliverable) {
    lines.push(`What the learner should build: ${task.deliverable}`);
  }
  if (task.concepts?.length) {
    lines.push(`Concepts: ${task.concepts.join(", ")}`);
  }
  lines.push(``, `Acceptance criteria:`, criteria + verification);
  return lines.join("\n");
}

export function syllabusPrompt(goal: Goal, options?: { compact?: boolean }): string {
  const compact = options?.compact ?? false;
  const rules = compact
    ? [
        "- 3 to 6 sections; 2 to 4 tasks per section.",
        "- Keep every field short so the JSON stays small.",
      ]
    : [
        "- 4 to 8 sections; 2 to 5 tasks per section.",
        "- Each task must be independently completable and checkable.",
        "- Acceptance criteria must be observable (e.g. 'server responds 200 on GET /health').",
        "- Include verification steps (commands or manual checks) where useful.",
        "- Assume the learner starts with a fresh, empty project directory.",
        "- For every section, write an `overview` describing what the learner will have built by the end.",
        "- For every task, describe the concrete artifact in `deliverable` (what they will build), a one-sentence `why`, 2 to 5 `concepts`, and a 3 to 6 item `steps` outline.",
        "- Keep `deliverable`, `why`, and each list item to a single short sentence so the JSON stays compact.",
      ];
  const schema = compact
    ? {
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
              },
            ],
          },
        ],
      }
    : {
        title: "string",
        sections: [
          {
            title: "string",
            description: "string",
            overview: "string",
            tasks: [
              {
                title: "string",
                description: "string",
                deliverable: "string",
                why: "string",
                concepts: ["string"],
                steps: ["string"],
                acceptanceCriteria: ["string"],
                resources: ["string"],
                verification: ["string"],
              },
            ],
          },
        ],
      };
  return [
    goalContext(goal),
    "",
    "## Job",
    "Design a practical, project-based syllabus that takes this learner from where they are",
    "to achieving the goal. Order sections so each one builds on the last, and make every task",
    "concrete and verifiable — something the learner can actually build or demonstrate.",
    "",
    "Rules:",
    ...rules,
    "",
    "Reply with ONLY a JSON object in exactly this shape (no prose, no code fences):",
    JSON.stringify(schema, null, 2),
  ].join("\n");
}

export function guidePrompt(goal: Goal, syllabus: Syllabus, section: Section, task: Task): string {
  return [
    goalContext(goal, syllabus),
    "",
    taskContext(section, task),
    "",
    "## Job",
    `Write the build manual for the task "${task.title}" so a beginner can complete it from`,
    "your document alone. Cover what to set up, the steps to build it, a complete worked",
    "example they can compare against, and the mistakes to avoid.",
    "",
    "Reply with the Markdown document only — no JSON, and no code fence around the whole reply.",
  ].join("\n");
}

export function reviewPrompt(options: {
  goal: Goal;
  section: Section;
  task: Task;
  progress?: TaskProgress;
  lintSummary?: string;
}): string {
  const { goal, section, task, progress, lintSummary } = options;
  const lines = [
    goalContext(goal),
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
    "Read the learner's code in this project and review their work on the ONE task above.",
    "Review only this task. Ignore every other task and section, and ignore any acceptance",
    "criteria for other tasks that you find in files such as README.md or docs/.",
    "Do NOT return needs_work because other tasks or sections are unfinished — this task",
    "passes or fails solely on its own acceptance criteria.",
    "Judge strictly against those criteria and cite the file/line you read as evidence.",
    "Only return needs_work if a criterion for this task is genuinely unmet. Do not be generous.",
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
