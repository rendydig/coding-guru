import * as vscode from "vscode";
import { CodingGuruController } from "./controller";
import { Goal } from "./model/types";
import { DocNode, GoalNode, TaskNode } from "./views/syllabusTree";

export function registerCommands(context: vscode.ExtensionContext, controller: CodingGuruController): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("codingguru.createGoal", () => controller.openGoalWizard()),

    vscode.commands.registerCommand("codingguru.openGoal", (node?: GoalNode | { goal?: Goal }) =>
      controller.openWorkspace(node?.goal)
    ),

    vscode.commands.registerCommand("codingguru.refreshSyllabus", () => controller.refresh()),

    vscode.commands.registerCommand("codingguru.selectTask", (node: TaskNode) => controller.selectTask(node)),

    vscode.commands.registerCommand("codingguru.startTask", (node: TaskNode) => controller.startTask(node)),

    vscode.commands.registerCommand("codingguru.reviewTask", (node?: TaskNode) => controller.reviewTask(node)),

    vscode.commands.registerCommand("codingguru.markTaskDone", (node: TaskNode) => controller.markTaskDone(node)),

    vscode.commands.registerCommand("codingguru.openDocument", (node: DocNode) => controller.openDocument(node)),

    vscode.commands.registerCommand("codingguru.regenerateDocument", (node: DocNode) =>
      controller.regenerateDocument(node)
    ),

    vscode.commands.registerCommand("codingguru.openCoach", () =>
      vscode.commands.executeCommand("codingguru.coach.focus")
    ),

    vscode.commands.registerCommand("codingguru.runLint", () => controller.runLint()),

    vscode.commands.registerCommand("codingguru.askProgress", () =>
      controller.handleRequest({ type: "action", action: "progress" })
    ),

    vscode.commands.registerCommand("codingguru.setOpencodePath", () =>
      vscode.commands.executeCommand("workbench.action.openSettings", "codingguru.opencodePath")
    ),

    vscode.commands.registerCommand("codingguru.showLog", () => controller.showLog())
  );
}
