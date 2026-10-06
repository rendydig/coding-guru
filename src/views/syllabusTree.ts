import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { docsDir, readProgress, readSyllabus, Store } from "../model/store";
import { Goal, Progress, Section, STATUS_LABEL, Syllabus, Task, TaskProgress, TaskStatus } from "../model/types";
import { sectionFileName, taskFileName } from "../syllabus/documents";

export interface GoalNode {
  kind: "goal";
  goal: Goal;
  syllabus: Syllabus;
  progress: Progress;
}

export interface SectionNode {
  kind: "section";
  goal: Goal;
  syllabus: Syllabus;
  section: Section;
  index: number;
  progress: Progress;
}

export interface TaskNode {
  kind: "task";
  goal: Goal;
  syllabus: Syllabus;
  section: Section;
  sectionIndex: number;
  taskIndex: number;
  task: Task;
  progress: TaskProgress;
  isCurrent: boolean;
}

export interface DocNode {
  kind: "doc";
  label: string;
  file: string;
  scope: "section" | "task";
  sectionIndex: number;
  taskIndex?: number;
}

export interface InfoNode {
  kind: "info";
  label: string;
}

export type GuruNode = GoalNode | SectionNode | TaskNode | DocNode | InfoNode;

const STATUS_ICON: Record<TaskStatus, string> = {
  todo: "circle-outline",
  in_progress: "play-circle",
  needs_work: "warning",
  passed: "pass-filled",
};

const STATUS_COLOR: Record<TaskStatus, string> = {
  todo: "descriptionForeground",
  in_progress: "charts.blue",
  needs_work: "charts.yellow",
  passed: "charts.green",
};

function sectionDocPath(goal: Goal, section: Section, sectionIndex: number): string {
  return path.join(docsDir(goal.workspacePath), sectionFileName(section, sectionIndex));
}

function taskDocPath(goal: Goal, task: Task, sectionIndex: number, taskIndex: number): string {
  return path.join(docsDir(goal.workspacePath), taskFileName(task, sectionIndex, taskIndex));
}

function statusOf(progress: Progress, taskId: string): TaskProgress {
  return progress.tasks[taskId] ?? { status: "todo", attempts: 0 };
}

function sectionStats(section: Section, progress: Progress): { done: number; total: number } {
  const done = section.tasks.filter((task) => statusOf(progress, task.id).status === "passed").length;
  return { done, total: section.tasks.length };
}

function taskTooltip(section: Section, task: Task, progress: TaskProgress): vscode.MarkdownString {
  const md = new vscode.MarkdownString();
  md.appendMarkdown(`**${task.title}**\n\n`);
  md.appendMarkdown(`${task.description}\n\n`);
  if (task.acceptanceCriteria.length) {
    md.appendMarkdown(`**Done when**\n\n`);
    for (const criterion of task.acceptanceCriteria) {
      md.appendMarkdown(`- ${criterion}\n`);
    }
    md.appendMarkdown(`\n`);
  }
  if (task.verification?.length) {
    md.appendMarkdown(`**Verify**\n\n`);
    for (const step of task.verification) {
      md.appendMarkdown(`- \`${step}\`\n`);
    }
    md.appendMarkdown(`\n`);
  }
  md.appendMarkdown(`Section: ${section.title}  \n`);
  md.appendMarkdown(`Status: **${STATUS_LABEL[progress.status]}**`);
  if (progress.score !== undefined) {
    md.appendMarkdown(` · score ${progress.score}/100`);
  }
  if (progress.attempts > 0) {
    md.appendMarkdown(` · ${progress.attempts} review(s)`);
  }
  return md;
}

export class SyllabusTreeProvider implements vscode.TreeDataProvider<GuruNode> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<GuruNode | undefined>();
  readonly onDidChangeTreeData: vscode.Event<GuruNode | undefined> = this._onDidChangeTreeData.event;

  constructor(
    private readonly store: Store,
    private readonly getCurrentTaskId: () => string | undefined
  ) {
    store.onDidChange(() => this.refresh());
  }

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(node: GuruNode): vscode.TreeItem {
    switch (node.kind) {
      case "info":
        return new vscode.TreeItem(node.label);
      case "goal": {
        const item = new vscode.TreeItem(node.goal.title, vscode.TreeItemCollapsibleState.Expanded);
        const passed = node.syllabus.sections.reduce(
          (total, section) => total + sectionStats(section, node.progress).done,
          0
        );
        const all = node.syllabus.sections.reduce((total, section) => total + section.tasks.length, 0);
        item.description = `${passed}/${all} tasks`;
        item.iconPath = new vscode.ThemeIcon("book");
        item.contextValue = "codingguru.goal";
        item.tooltip = new vscode.MarkdownString(
          `**${node.goal.title}**\n\n${node.goal.description}\n\n` +
            `Stack: ${node.goal.stack.join(", ") || "unspecified"}  \nLevel: ${node.goal.level}`
        );
        return item;
      }
      case "section": {
        const stats = sectionStats(node.section, node.progress);
        const containsCurrent = node.section.tasks.some((task) => task.id === this.getCurrentTaskId());
        const item = new vscode.TreeItem(
          `${node.index + 1}. ${node.section.title}`,
          containsCurrent ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed
        );
        item.description = `${stats.done}/${stats.total}`;
        item.iconPath = new vscode.ThemeIcon(
          stats.total > 0 && stats.done === stats.total ? "check" : "list-ordered"
        );
        item.contextValue = "codingguru.section";
        if (node.section.description) {
          item.tooltip = new vscode.MarkdownString(node.section.description);
        }
        return item;
      }
      case "task": {
        const item = new vscode.TreeItem(
          node.task.title,
          vscode.TreeItemCollapsibleState.Collapsed
        );
        item.description = node.isCurrent
          ? `▶ ${STATUS_LABEL[node.progress.status]}`
          : STATUS_LABEL[node.progress.status];
        item.iconPath = new vscode.ThemeIcon(
          STATUS_ICON[node.progress.status],
          new vscode.ThemeColor(STATUS_COLOR[node.progress.status])
        );
        item.contextValue = "codingguru.task";
        item.tooltip = taskTooltip(node.section, node.task, node.progress);
        item.command = {
          command: "codingguru.selectTask",
          title: "Focus task",
          arguments: [node],
        };
        return item;
      }
      case "doc": {
        const generated = fs.existsSync(node.file);
        const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.None);
        item.iconPath = new vscode.ThemeIcon(generated ? "book" : "sparkle");
        item.contextValue = node.scope === "task" ? "codingguru.doc.task" : "codingguru.doc.section";
        item.tooltip = generated ? node.file : "Generated on first open — click to write this guide.";
        item.command = {
          command: "codingguru.openDocument",
          title: "Open document",
          arguments: [node],
        };
        return item;
      }
    }
  }

  getChildren(node?: GuruNode): GuruNode[] {
    if (!node) {
      const goal = this.store.active;
      if (!goal) {
        return [];
      }
      const syllabus = readSyllabus(goal.workspacePath);
      if (!syllabus) {
        return [{ kind: "info", label: "Syllabus is still being generated…" }];
      }
      return [{ kind: "goal", goal, syllabus, progress: readProgress(goal.workspacePath) }];
    }

    if (node.kind === "goal") {
      return node.syllabus.sections.map((section, index) => ({
        kind: "section" as const,
        goal: node.goal,
        syllabus: node.syllabus,
        section,
        index,
        progress: node.progress,
      }));
    }

    if (node.kind === "section") {
      const guide: DocNode = {
        kind: "doc",
        label: "Section guide",
        file: sectionDocPath(node.goal, node.section, node.index),
        scope: "section",
        sectionIndex: node.index,
      };
      const tasks: TaskNode[] = node.section.tasks.map((task, taskIndex) => ({
        kind: "task" as const,
        goal: node.goal,
        syllabus: node.syllabus,
        section: node.section,
        sectionIndex: node.index,
        taskIndex,
        task,
        progress: statusOf(node.progress, task.id),
        isCurrent: task.id === this.getCurrentTaskId(),
      }));
      return [guide, ...tasks];
    }

    if (node.kind === "task") {
      const file = taskDocPath(node.goal, node.task, node.sectionIndex, node.taskIndex);
      return [
        {
          kind: "doc" as const,
          label: fs.existsSync(file) ? "Build guide" : "Generate build guide",
          file,
          scope: "task" as const,
          sectionIndex: node.sectionIndex,
          taskIndex: node.taskIndex,
        },
      ];
    }

    return [];
  }
}
