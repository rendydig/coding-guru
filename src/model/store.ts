import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import { Goal, Progress, Syllabus, TaskProgress } from "./types";

export const CG_DIR = ".codingguru";
export const GOAL_FILE = "goal.json";
export const SYLLABUS_FILE = "syllabus.json";
export const PROGRESS_FILE = "progress.json";
export const COACH_PROMPT_FILE = "coach-prompt.md";
export const OPENCODE_CONFIG_FILE = "opencode.json";
export const AGENTS_FILE = "AGENTS.md";

const LAST_ACTIVE_KEY = "codingguru.lastActiveWorkspace";

export function workspaceRoot(): string {
  const configured = vscode.workspace.getConfiguration("codingguru").get<string>("workspaceRoot");
  const root = configured && configured.trim() ? configured.trim() : path.join(os.homedir(), "CodingGuru");
  return path.resolve(root);
}

export function slugify(input: string): string {
  const slug = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return slug || "goal";
}

export function cgDir(workspacePath: string): string {
  return path.join(workspacePath, CG_DIR);
}

export function goalFile(workspacePath: string): string {
  return path.join(cgDir(workspacePath), GOAL_FILE);
}

export function syllabusFile(workspacePath: string): string {
  return path.join(cgDir(workspacePath), SYLLABUS_FILE);
}

export function progressFile(workspacePath: string): string {
  return path.join(cgDir(workspacePath), PROGRESS_FILE);
}

export function coachPromptFile(workspacePath: string): string {
  return path.join(cgDir(workspacePath), COACH_PROMPT_FILE);
}

export function opencodeConfigFile(workspacePath: string): string {
  return path.join(workspacePath, OPENCODE_CONFIG_FILE);
}

export function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

export function readJson<T>(file: string): T | undefined {
  try {
    if (!fs.existsSync(file)) {
      return undefined;
    }
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return undefined;
  }
}

export function writeJson(file: string, data: unknown): void {
  writeText(file, JSON.stringify(data, null, 2) + "\n");
}

export function writeText(file: string, content: string): void {
  ensureDir(path.dirname(file));
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, content, "utf8");
  fs.renameSync(tmp, file);
}

export function readGoal(workspacePath: string): Goal | undefined {
  const goal = readJson<Goal>(goalFile(workspacePath));
  if (!goal) {
    return undefined;
  }
  return { ...goal, workspacePath };
}

export function readSyllabus(workspacePath: string): Syllabus | undefined {
  return readJson<Syllabus>(syllabusFile(workspacePath));
}

export function readProgress(workspacePath: string): Progress {
  const existing = readJson<Progress>(progressFile(workspacePath));
  if (existing) {
    return existing;
  }
  const goal = readGoal(workspacePath);
  return { goalId: goal?.id ?? "", tasks: {}, updatedAt: new Date().toISOString() };
}

export function writeProgress(workspacePath: string, progress: Progress): void {
  progress.updatedAt = new Date().toISOString();
  writeJson(progressFile(workspacePath), progress);
}

export function listGoals(): Goal[] {
  const root = workspaceRoot();
  if (!fs.existsSync(root)) {
    return [];
  }
  const goals: Goal[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }
    const dir = path.join(root, entry.name);
    const goal = readGoal(dir);
    if (goal) {
      goals.push(goal);
    }
  }
  return goals.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export function defaultTaskProgress(): TaskProgress {
  return { status: "todo", attempts: 0 };
}

/**
 * Holds the active goal and broadcasts changes so views can refresh.
 */
export class Store implements vscode.Disposable {
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChange: vscode.Event<void> = this._onDidChange.event;
  private _active: Goal | undefined;

  constructor(private readonly context: vscode.ExtensionContext) {
    this._active = this.resolveActive();
  }

  get active(): Goal | undefined {
    return this._active;
  }

  setActive(goal: Goal | undefined): void {
    this._active = goal;
    void this.context.globalState.update(LAST_ACTIVE_KEY, goal?.workspacePath);
    this.refresh();
  }

  /** Prefer a goal opened as the current folder, then the last used one. */
  resolveActive(): Goal | undefined {
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      if (folder.uri.scheme !== "file") {
        continue;
      }
      const goal = readGoal(folder.uri.fsPath);
      if (goal) {
        return goal;
      }
    }
    const last = this.context.globalState.get<string>(LAST_ACTIVE_KEY);
    if (last) {
      const goal = readGoal(last);
      if (goal) {
        return goal;
      }
    }
    return undefined;
  }

  refresh(): void {
    this._active = this.resolveActive();
    this._onDidChange.fire();
  }

  dispose(): void {
    this._onDidChange.dispose();
  }
}
