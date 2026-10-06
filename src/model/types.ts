export type TaskStatus = "todo" | "in_progress" | "needs_work" | "passed";

export type Level = "beginner" | "intermediate" | "advanced";

export interface Task {
  id: string;
  title: string;
  description: string;
  acceptanceCriteria: string[];
  resources?: string[];
  verification?: string[];
  /** What the learner will actually build for this task. */
  deliverable?: string;
  /** Why this task matters on the way to the goal. */
  why?: string;
  /** Key concepts the task exercises. */
  concepts?: string[];
  /** A short, ordered outline of how to build it. */
  steps?: string[];
}

export interface Section {
  id: string;
  title: string;
  description: string;
  /** What the learner will have built by the end of the section. */
  overview?: string;
  tasks: Task[];
}

export interface Syllabus {
  goalId: string;
  title: string;
  sections: Section[];
  generatedAt: string;
}

export interface Goal {
  id: string;
  slug: string;
  title: string;
  description: string;
  stack: string[];
  level: Level;
  hoursPerWeek?: number;
  createdAt: string;
  workspacePath: string;
}

export interface GoalInput {
  title: string;
  description: string;
  stack: string[];
  level: Level;
  hoursPerWeek?: number;
}

export interface ReviewFinding {
  severity: "info" | "warning" | "error";
  message: string;
  file?: string;
  line?: number;
}

export interface TaskProgress {
  status: TaskStatus;
  score?: number;
  attempts: number;
  summary?: string;
  findings?: ReviewFinding[];
  nextSteps?: string[];
  reviewedAt?: string;
}

export interface Progress {
  goalId: string;
  tasks: Record<string, TaskProgress>;
  updatedAt: string;
}

export interface ReviewResult {
  verdict: "passed" | "needs_work";
  score: number;
  summary: string;
  findings: ReviewFinding[];
  nextSteps: string[];
}

export const STATUS_LABEL: Record<TaskStatus, string> = {
  todo: "To do",
  in_progress: "In progress",
  needs_work: "Needs work",
  passed: "Passed",
};
