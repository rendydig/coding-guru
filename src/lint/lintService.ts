import { exec } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";

export interface LintRun {
  summary: string;
  problemCount: number;
}

interface LintProblem {
  uri: vscode.Uri;
  diagnostic: vscode.Diagnostic;
}

interface ParsedLint {
  problems: LintProblem[];
  summary: string;
  problemCount: number;
}

function runCommand(command: string, cwd: string, timeout: number): Promise<string> {
  return new Promise((resolve) => {
    exec(command, { cwd, timeout, maxBuffer: 10 * 1024 * 1024, windowsHide: true }, (_error, stdout, stderr) => {
      resolve(`${stdout}${stderr}`);
    });
  });
}

function localBin(workspacePath: string, name: string): string | undefined {
  const suffix = process.platform === "win32" ? ".cmd" : "";
  const bin = path.join(workspacePath, "node_modules", ".bin", `${name}${suffix}`);
  return fs.existsSync(bin) ? bin : undefined;
}

function quote(value: string): string {
  return /\s/.test(value) ? `"${value}"` : value;
}

function makeDiagnostic(
  uri: vscode.Uri,
  line: number,
  column: number,
  message: string,
  severity: vscode.DiagnosticSeverity,
  code?: string
): LintProblem {
  const startLine = Math.max(0, line - 1);
  const startChar = Math.max(0, column - 1);
  const diagnostic = new vscode.Diagnostic(
    new vscode.Range(startLine, startChar, startLine, startChar + 1),
    message,
    severity
  );
  diagnostic.source = "codingguru";
  diagnostic.code = code;
  return { uri, diagnostic };
}

function parseEslint(output: string, workspacePath: string): ParsedLint {
  const start = output.indexOf("[");
  const end = output.lastIndexOf("]");
  if (start === -1 || end === -1) {
    return { problems: [], summary: "ESLint did not return JSON output.", problemCount: 0 };
  }
  interface EslintMessage {
    ruleId?: string | null;
    severity?: number;
    message?: string;
    line?: number;
    column?: number;
  }
  interface EslintFile {
    filePath?: string;
    messages?: EslintMessage[];
  }
  let files: EslintFile[];
  try {
    files = JSON.parse(output.slice(start, end + 1)) as EslintFile[];
  } catch {
    return { problems: [], summary: "Could not parse ESLint output.", problemCount: 0 };
  }

  const problems: LintProblem[] = [];
  let errors = 0;
  let warnings = 0;
  for (const file of files) {
    if (!file.filePath || !file.messages?.length) {
      continue;
    }
    const uri = vscode.Uri.file(path.resolve(workspacePath, file.filePath));
    for (const message of file.messages) {
      const isError = message.severity === 2;
      if (isError) {
        errors++;
      } else {
        warnings++;
      }
      problems.push(
        makeDiagnostic(
          uri,
          message.line ?? 1,
          message.column ?? 1,
          message.message ?? "Lint problem",
          isError ? vscode.DiagnosticSeverity.Error : vscode.DiagnosticSeverity.Warning,
          message.ruleId ?? undefined
        )
      );
    }
  }

  return { problems, summary: `ESLint: ${errors} error(s), ${warnings} warning(s).`, problemCount: errors + warnings };
}

function parseTsc(output: string, workspacePath: string): ParsedLint {
  const problems: LintProblem[] = [];
  const pattern = /^(.+?)\((\d+),(\d+)\):\s+error\s+(TS\d+):\s+(.+)$/gm;
  for (const match of output.matchAll(pattern)) {
    const [, file, line, column, code, message] = match;
    const uri = vscode.Uri.file(path.resolve(workspacePath, file));
    problems.push(
      makeDiagnostic(uri, Number(line), Number(column), message, vscode.DiagnosticSeverity.Error, code)
    );
  }
  if (problems.length > 0) {
    return { problems, summary: `TypeScript: ${problems.length} type error(s).`, problemCount: problems.length };
  }
  if (/error TS\d+/.test(output)) {
    return { problems: [], summary: "TypeScript reported an error that could not be parsed.", problemCount: 1 };
  }
  return { problems: [], summary: "TypeScript: no type errors.", problemCount: 0 };
}

/** Runs the workspace's own linters and surfaces results in the Problems panel. */
export class LintService implements vscode.Disposable {
  private readonly collection = vscode.languages.createDiagnosticCollection("codingguru");

  async run(workspacePath: string): Promise<LintRun> {
    const problems: LintProblem[] = [];
    const summaries: string[] = [];

    const eslint = localBin(workspacePath, "eslint");
    if (eslint) {
      const output = await runCommand(`${quote(eslint)} . --format json`, workspacePath, 120_000);
      const parsed = parseEslint(output, workspacePath);
      problems.push(...parsed.problems);
      summaries.push(parsed.summary);
    }

    const tsc = localBin(workspacePath, "tsc");
    if (tsc && fs.existsSync(path.join(workspacePath, "tsconfig.json"))) {
      const output = await runCommand(`${quote(tsc)} --noEmit`, workspacePath, 180_000);
      const parsed = parseTsc(output, workspacePath);
      problems.push(...parsed.problems);
      summaries.push(parsed.summary);
    }

    this.publish(problems);

    if (summaries.length === 0) {
      return {
        summary: "No linter found in this workspace (looked for a local ESLint and TypeScript install).",
        problemCount: 0,
      };
    }
    return { summary: summaries.join(" "), problemCount: problems.length };
  }

  private publish(problems: LintProblem[]): void {
    const byFile = new Map<string, { uri: vscode.Uri; items: vscode.Diagnostic[] }>();
    for (const problem of problems) {
      const key = problem.uri.toString();
      const entry = byFile.get(key) ?? { uri: problem.uri, items: [] };
      entry.items.push(problem.diagnostic);
      byFile.set(key, entry);
    }
    this.collection.clear();
    for (const entry of byFile.values()) {
      this.collection.set(entry.uri, entry.items);
    }
  }

  dispose(): void {
    this.collection.dispose();
  }
}
