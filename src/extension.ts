import * as vscode from "vscode";
import { registerCommands } from "./commands";
import { CodingGuruController } from "./controller";
import { Store } from "./model/store";
import { COACH_VIEW_TYPE } from "./views/coachView";

const HAS_WORKSPACE_KEY = "codingguru.hasWorkspace";

/** Placeholder provider: the Get started view renders its welcome while empty. */
const emptyTree: vscode.TreeDataProvider<never> = {
  getChildren: () => [],
  getTreeItem: () => new vscode.TreeItem(""),
};

export function activate(context: vscode.ExtensionContext): void {
  const store = new Store(context);
  const controller = new CodingGuruController(store, context.extensionUri);

  const syncVisibility = () =>
    void vscode.commands.executeCommand("setContext", HAS_WORKSPACE_KEY, store.hasWorkspace);
  syncVisibility();

  context.subscriptions.push(
    store,
    controller,
    store.onDidChange(syncVisibility),
    vscode.window.registerWebviewViewProvider(COACH_VIEW_TYPE, controller.coach, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.window.createTreeView("codingguru.getStarted", {
      treeDataProvider: emptyTree,
    }),
    vscode.window.createTreeView("codingguru.syllabus", {
      treeDataProvider: controller.tree,
      showCollapseAll: true,
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => store.refresh()),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("codingguru")) {
        store.refresh();
      }
    })
  );

  registerCommands(context, controller);
  controller.log("CodingGuru activated.");
}

export function deactivate(): void {
  // Everything is torn down through context.subscriptions.
}
