import * as vscode from "vscode";
import { registerCommands } from "./commands";
import { CodingGuruController } from "./controller";
import { Store } from "./model/store";
import { COACH_VIEW_TYPE } from "./views/coachView";

export function activate(context: vscode.ExtensionContext): void {
  const store = new Store(context);
  const controller = new CodingGuruController(store, context.extensionUri);

  context.subscriptions.push(
    store,
    controller,
    vscode.window.registerWebviewViewProvider(COACH_VIEW_TYPE, controller.coach, {
      webviewOptions: { retainContextWhenHidden: true },
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
