import * as fs from "fs";
import * as vscode from "vscode";
import { LintService } from "./lint/lintService";
import { appendChatEntry, bumpSessionIndex, readProgress, readSyllabus, readTranscript, Store, writeProgress } from "./model/store";
import { Goal, GoalInput, ReviewResult, Section, STATUS_LABEL, Syllabus, Task, TaskProgress, ToolActivity } from "./model/types";
import { goalContext, normalizeReview, progressPrompt, reviewPrompt, taskContext } from "./opencode/coach";
import { OpencodeService } from "./opencode/service";
import { GoalWizard } from "./panels/goalWizard";
import { writeDocuments } from "./syllabus/documents";
import { countTasks, generateSyllabus } from "./syllabus/generate";
import { generateTaskGuide, writeTaskGuide } from "./syllabus/guides";
import { createGoal, prepareWorkspace, writeSyllabus } from "./syllabus/scaffold";
import { nowIso } from "./util/ids";
import { CoachRequest, CoachViewProvider } from "./views/coachView";
import { DocNode, SyllabusTreeProvider, TaskNode } from "./views/syllabusTree";

const HINT_INSTRUCTION =
  "Give me a hint for the current task. Do not give me the full answer — nudge me toward the next concrete step and tell me what to look at.";
const EXPLAIN_INSTRUCTION =
  "Explain the current task: what it is really asking for, the concepts involved, and how I should approach it. Do not write the code for me.";

interface TaskTarget {
  section: Section;
  task: Task;
}

export class CodingGuruController implements vscode.Disposable {
  readonly coach: CoachViewProvider;
  readonly tree: SyllabusTreeProvider;

  private readonly service: OpencodeService;
  private readonly lint = new LintService();
  private readonly sessions = new Map<string, string>();
  /** Separate sessions for the guide author, so manuals never pollute the coach chat. */
  private readonly authorSessions = new Map<string, string>();
  private readonly output = vscode.window.createOutputChannel("CodingGuru");
  private currentTaskId?: string;
  private busy = false;
  /** Workspace whose transcript was last replayed into the Coach view. */
  private historyWorkspace?: string;

  constructor(
    private readonly store: Store,
    private readonly extensionUri: vscode.Uri
  ) {
    this.service = new OpencodeService((message) => this.log(message));
    this.coach = new CoachViewProvider(
      extensionUri,
      (request) => void this.handleRequest(request),
      () => this.sendHistory()
    );
    this.tree = new SyllabusTreeProvider(store, () => this.currentTaskId);
    store.onDidChange(() => this.updateContext());
    this.updateContext();
  }

  log(message: string): void {
    this.output.appendLine(`[${new Date().toISOString()}] ${message}`);
  }

  showLog(): void {
    this.output.show(true);
  }

  dispose(): void {
    this.service.dispose();
    this.lint.dispose();
    this.output.dispose();
  }

  // ---------------------------------------------------------------- commands

  openGoalWizard(): void {
    GoalWizard.show(this.extensionUri, (input, report) => this.createGoal(input, report));
  }

  async openWorkspace(goal?: Goal): Promise<void> {
    const target = goal ?? this.store.active;
    if (!target) {
      void vscode.window.showWarningMessage("CodingGuru: no learning goal selected.");
      return;
    }
    const folders = vscode.workspace.workspaceFolders ?? [];
    if (folders.some((folder) => folder.uri.fsPath === target.workspacePath)) {
      return;
    }
    // Open in a new window when the user is already working somewhere else, so
    // creating a goal never replaces their current project.
    const hasOtherProject = folders.some((folder) => folder.uri.scheme === "file");
    await vscode.commands.executeCommand("vscode.openFolder", vscode.Uri.file(target.workspacePath), {
      forceNewWindow: hasOtherProject,
    });
  }

  refresh(): void {
    this.store.refresh();
  }

  selectTask(node: TaskNode): void {
    this.currentTaskId = node.task.id;
    this.tree.refresh();
    this.updateContext();
    void this.coach.reveal();
  }

  startTask(node: TaskNode): void {
    this.currentTaskId = node.task.id;
    this.setStatus(node.goal, node.task.id, "in_progress");
    this.updateContext();
    void this.coach.reveal();
  }

  markTaskDone(node: TaskNode): void {
    this.setStatus(node.goal, node.task.id, "passed");
    this.currentTaskId = node.task.id;
    this.updateContext();
  }

  async openDocument(node: DocNode): Promise<void> {
    const goal = this.store.active;
    if (!goal) {
      this.coach.notice("Open a learning workspace first.", "error");
      return;
    }
    if (!fs.existsSync(node.file)) {
      try {
        await this.ensureDocument(goal, node, false);
      } catch (error) {
        this.coach.notice(error instanceof Error ? error.message : String(error), "error");
        return;
      }
    }
    if (!fs.existsSync(node.file)) {
      this.coach.notice("That build guide is missing. Refresh the syllabus and try again.", "error");
      return;
    }
    await this.showDocument(node.file);
  }

  async regenerateDocument(node: DocNode): Promise<void> {
    const goal = this.store.active;
    if (!goal) {
      this.coach.notice("Open a learning workspace first.", "error");
      return;
    }
    try {
      await this.ensureDocument(goal, node, true);
    } catch (error) {
      this.coach.notice(error instanceof Error ? error.message : String(error), "error");
      return;
    }
    await this.showDocument(node.file);
  }

  async runLint(): Promise<void> {
    const goal = this.store.active;
    if (!goal) {
      this.coach.notice("Open a learning workspace first.", "error");
      return;
    }
    this.coach.notice("Running linters…");
    const result = await this.lint.run(goal.workspacePath);
    this.coach.notice(result.summary);
  }

  async reviewTask(node?: TaskNode): Promise<void> {
    const goal = this.store.active;
    if (!goal) {
      this.coach.notice("Open a learning workspace first.", "error");
      return;
    }
    const syllabus = readSyllabus(goal.workspacePath);
    if (!syllabus) {
      this.coach.notice("No syllabus found in this workspace.", "error");
      return;
    }
    const target: TaskTarget | undefined = node
      ? { section: node.section, task: node.task }
      : this.currentTask(goal, syllabus);
    if (!target) {
      void vscode.window.showInformationMessage("CodingGuru: select a task to review.");
      return;
    }
    if (this.busy) {
      this.coach.notice("The coach is already working on something.");
      return;
    }

    this.currentTaskId = target.task.id;
    this.updateContext();
    void this.coach.reveal();
    this.busy = true;
    this.coach.busy(true);
    this.coach.notice(`Reviewing “${target.task.title}”…`);

    try {
      const lintSummary = await this.maybeLint(goal);
      const progress = readProgress(goal.workspacePath);
      const prompt = reviewPrompt({
        goal,
        section: target.section,
        task: target.task,
        progress: progress.tasks[target.task.id],
        lintSummary,
      });
      const raw = await this.withSession(goal, (sessionId) =>
        this.service.promptJson<unknown>(goal.workspacePath, sessionId, prompt, "the review")
      );
      const review = normalizeReview(raw);
      if (!review) {
        throw new Error("The coach returned a review that could not be read.");
      }
      this.applyReview(goal, target.task.id, review);
      this.coach.review(review);
      appendChatEntry(goal.workspacePath, { role: "review", at: nowIso(), review });
    } catch (error) {
      this.coach.notice(error instanceof Error ? error.message : String(error), "error");
    } finally {
      this.busy = false;
      this.coach.busy(false);
      this.updateContext();
    }
  }

  async ask(text: string): Promise<void> {
    const goal = this.store.active;
    if (!goal) {
      this.coach.notice("Create a learning goal first.", "error");
      return;
    }
    await this.chat(this.withContext(goal, text), text);
  }

  async handleRequest(request: CoachRequest): Promise<void> {
    if (request.type === "ask") {
      if (request.text) {
        await this.ask(request.text);
      }
      return;
    }
    switch (request.action) {
      case "review":
        await this.reviewTask();
        break;
      case "hint":
        await this.action(HINT_INSTRUCTION, "Hint");
        break;
      case "explain":
        await this.action(EXPLAIN_INSTRUCTION, "Explain this task");
        break;
      case "progress":
        await this.askProgress();
        break;
      case "lint":
        await this.runLint();
        break;
    }
  }

  // ----------------------------------------------------------------- internal

  private async action(instruction: string, display: string): Promise<void> {
    const goal = this.store.active;
    if (!goal) {
      this.coach.notice("Create a learning goal first.", "error");
      return;
    }
    await this.chat(this.withContext(goal, instruction), display);
  }

  private async askProgress(): Promise<void> {
    const goal = this.store.active;
    if (!goal) {
      this.coach.notice("Create a learning goal first.", "error");
      return;
    }
    const syllabus = readSyllabus(goal.workspacePath);
    if (!syllabus) {
      this.coach.notice("No syllabus found in this workspace.", "error");
      return;
    }
    const progress = readProgress(goal.workspacePath);
    const tasks = syllabus.sections.flatMap((section) => section.tasks);
    const done = tasks.filter((task) => progress.tasks[task.id]?.status === "passed").length;
    await this.chat(progressPrompt(goal, syllabus, done, tasks.length), "How am I doing?");
  }

  private async chat(prompt: string, display: string): Promise<void> {
    const goal = this.store.active;
    if (!goal) {
      this.coach.notice("Create a learning goal first.", "error");
      return;
    }
    if (this.busy) {
      this.coach.notice("The coach is already working on something.");
      return;
    }
    this.busy = true;
    this.coach.busy(true);
    this.coach.user(display);
    this.coach.assistantStart();

    const reasoning: string[] = [];
    const tools = new Map<string, ToolActivity>();
    try {
      appendChatEntry(goal.workspacePath, { role: "user", text: display, at: nowIso() });
      let final = "";
      await this.withSession(goal, async (sessionId) => {
        final = await this.service.promptStreaming(goal.workspacePath, sessionId, prompt, {
          onText: (delta) => this.coach.delta(delta),
          onReasoning: (delta) => {
            reasoning.push(delta);
            this.coach.thinkingDelta(delta);
          },
          onTool: (tool) => {
            tools.set(tool.callID, tool);
            this.coach.tool(tool);
          },
        });
      });
      appendChatEntry(goal.workspacePath, {
        role: "assistant",
        text: final,
        at: nowIso(),
        reasoning: reasoning.join("") || undefined,
        tools: tools.size ? [...tools.values()] : undefined,
      });
    } catch (error) {
      this.coach.notice(error instanceof Error ? error.message : String(error), "error");
    } finally {
      this.coach.assistantEnd();
      this.busy = false;
      this.coach.busy(false);
    }
  }

  private async createGoal(input: GoalInput, report: (message: string) => void): Promise<void> {
    const config = vscode.workspace.getConfiguration("codingguru");
    const model = config.get<string>("model") ?? "";
    const allowBash = config.get<boolean>("coachAllowBash") ?? false;

    report("Creating your learning workspace…");
    const goal = createGoal(input);
    prepareWorkspace(goal, model, allowBash);
    this.store.setActive(goal);
    this.log(`Created goal "${goal.title}" at ${goal.workspacePath}`);

    report("Starting the coach…");
    await this.service.ensure(goal.workspacePath);
    const agents = await this.service.listAgents(goal.workspacePath).catch(() => [] as string[]);
    if (agents.length && !agents.includes("codingguru-coach")) {
      this.log(`Warning: coach agent not found. Available agents: ${agents.join(", ")}`);
    }

    report("Generating your syllabus (this can take a moment)…");
    const sessionId = await this.service.createSession(goal.workspacePath, `Syllabus: ${goal.title}`);
    this.sessions.set(goal.workspacePath, sessionId);
    const syllabus = await generateSyllabus(this.service, goal, sessionId);
    writeSyllabus(goal, syllabus);

    this.store.refresh();
    this.coach.notice(
      `Syllabus ready — ${syllabus.sections.length} sections, ${countTasks(syllabus)} tasks. Work through them in order.`
    );

    report("Opening your workspace…");
    await this.openWorkspace(goal);
  }

  private async maybeLint(goal: Goal): Promise<string | undefined> {
    if (!(vscode.workspace.getConfiguration("codingguru").get<boolean>("autoReview") ?? true)) {
      return undefined;
    }
    try {
      const result = await this.lint.run(goal.workspacePath);
      return result.summary;
    } catch {
      return undefined;
    }
  }

  private applyReview(goal: Goal, taskId: string, review: ReviewResult): void {
    const progress = readProgress(goal.workspacePath);
    const previous: TaskProgress = progress.tasks[taskId] ?? { status: "todo", attempts: 0 };
    progress.tasks[taskId] = {
      status: review.verdict === "passed" ? "passed" : "needs_work",
      score: review.score,
      attempts: previous.attempts + 1,
      summary: review.summary,
      findings: review.findings,
      nextSteps: review.nextSteps,
      reviewedAt: nowIso(),
    };
    writeProgress(goal.workspacePath, progress);
    this.store.refresh();
  }

  private setStatus(goal: Goal, taskId: string, status: TaskProgress["status"]): void {
    const progress = readProgress(goal.workspacePath);
    const previous = progress.tasks[taskId] ?? { status: "todo", attempts: 0 };
    progress.tasks[taskId] = { ...previous, status };
    writeProgress(goal.workspacePath, progress);
    this.store.refresh();
  }

  private currentTask(goal: Goal, syllabus?: Syllabus): TaskTarget | undefined {
    if (!syllabus) {
      return undefined;
    }
    for (const section of syllabus.sections) {
      for (const task of section.tasks) {
        if (task.id === this.currentTaskId) {
          return { section, task };
        }
      }
    }
    const progress = readProgress(goal.workspacePath);
    for (const section of syllabus.sections) {
      for (const task of section.tasks) {
        if ((progress.tasks[task.id]?.status ?? "todo") !== "passed") {
          return { section, task };
        }
      }
    }
    return undefined;
  }

  private withContext(goal: Goal, text: string): string {
    const syllabus = readSyllabus(goal.workspacePath);
    const target = this.currentTask(goal, syllabus);
    const parts = [goalContext(goal, syllabus)];
    if (target) {
      parts.push("", taskContext(target.section, target.task));
    }
    parts.push("", "## Learner message", text);
    return parts.join("\n");
  }

  /** Writes the document behind a tree node, if missing (or when forced). */
  private async ensureDocument(goal: Goal, node: DocNode, force: boolean): Promise<void> {
    const syllabus = readSyllabus(goal.workspacePath);
    if (!syllabus) {
      throw new Error("No syllabus found in this workspace.");
    }
    if (node.scope === "section") {
      // The index and section docs are deterministic and cheap to rewrite.
      if (force || !fs.existsSync(node.file)) {
        writeDocuments(goal, syllabus);
      }
      return;
    }
    const section = syllabus.sections[node.sectionIndex];
    const taskIndex = node.taskIndex ?? 0;
    const task = section?.tasks[taskIndex];
    if (!section || !task) {
      throw new Error("That task is no longer in the syllabus. Refresh the syllabus and try again.");
    }
    if (!force && fs.existsSync(node.file)) {
      return;
    }
    const file = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `CodingGuru: writing the build guide for “${task.title}”…`,
      },
      () =>
        this.withAuthorSession(goal, async (sessionId) => {
          const body = await generateTaskGuide(this.service, goal, syllabus, section, task, sessionId);
          return writeTaskGuide(goal, section, task, node.sectionIndex, taskIndex, body);
        })
    );
    this.log(`Wrote build guide ${file}`);
    this.tree.refresh();
  }

  private async showDocument(file: string): Promise<void> {
    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
    await vscode.window.showTextDocument(document, { preview: true });
  }

  private async ensureSession(goal: Goal): Promise<string> {
    const existing = this.sessions.get(goal.workspacePath);
    if (existing) {
      return existing;
    }
    const sessionId = await this.service.createSession(goal.workspacePath, goal.title);
    this.sessions.set(goal.workspacePath, sessionId);
    return sessionId;
  }

  private async withSession<T>(goal: Goal, fn: (sessionId: string) => Promise<T>): Promise<T> {
    const sessionId = await this.ensureSession(goal);
    try {
      return await fn(sessionId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // Only a lost session is worth recreating; other failures should surface.
      if (!/not\s*found|404/i.test(message)) {
        throw error;
      }
      this.log(`Session ${sessionId} is stale; starting a new one.`);
      this.sessions.delete(goal.workspacePath);
      bumpSessionIndex(goal.workspacePath);
      return fn(await this.ensureSession(goal));
    }
  }

  private async ensureAuthorSession(goal: Goal): Promise<string> {
    const existing = this.authorSessions.get(goal.workspacePath);
    if (existing) {
      return existing;
    }
    const sessionId = await this.service.createSession(goal.workspacePath, `Build guides: ${goal.title}`);
    this.authorSessions.set(goal.workspacePath, sessionId);
    return sessionId;
  }

  private async withAuthorSession<T>(goal: Goal, fn: (sessionId: string) => Promise<T>): Promise<T> {
    const sessionId = await this.ensureAuthorSession(goal);
    try {
      return await fn(sessionId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!/not\s*found|404/i.test(message)) {
        throw error;
      }
      this.log(`Author session ${sessionId} is stale; starting a new one.`);
      this.authorSessions.delete(goal.workspacePath);
      return fn(await this.ensureAuthorSession(goal));
    }
  }

  private updateContext(): void {
    const goal = this.store.active;
    if (!goal) {
      this.coach.setContext({ hasGoal: false });
      this.historyWorkspace = undefined;
      return;
    }
    const syllabus = readSyllabus(goal.workspacePath);
    const target = this.currentTask(goal, syllabus);
    const progress = readProgress(goal.workspacePath);
    this.coach.setContext({
      hasGoal: true,
      goalTitle: goal.title,
      sectionTitle: target?.section.title,
      taskTitle: target?.task.title,
      status: target ? STATUS_LABEL[progress.tasks[target.task.id]?.status ?? "todo"] : undefined,
      workspacePath: goal.workspacePath,
    });
    // Replay when the active goal changes, but never mid-turn — that would wipe
    // the reply being streamed.
    if (!this.busy && goal.workspacePath !== this.historyWorkspace) {
      this.sendHistory();
    }
  }

  /** Replays the persisted transcript when the Coach panel (re)loads. */
  private sendHistory(): void {
    const goal = this.store.active;
    if (!goal) {
      this.historyWorkspace = undefined;
      return;
    }
    this.historyWorkspace = goal.workspacePath;
    this.coach.history(readTranscript(goal.workspacePath).entries);
  }
}
