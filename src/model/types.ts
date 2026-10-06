export type TaskStatus = "todo" | "in_progress" | "needs_work" | "passed";

export type Level = "beginner" | "intermediate" | "advanced";

export interface Task {
  id: string;
  title: string;
  description: string;
  acceptanceCriteria: string[];
  resources?: string[];
  verification?: string[];
}

export interface Section {
  id: string;
  title: string;
  description: string;
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
