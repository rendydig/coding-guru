import * as crypto from "crypto";
import * as vscode from "vscode";

export function getNonce(): string {
  return crypto.randomBytes(24).toString("base64").replace(/[^a-zA-Z0-9]/g, "").slice(0, 32);
}

export function assetUri(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  ...segments: string[]
): vscode.Uri {
  return webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, ...segments));
}

export function htmlShell(options: {
  webview: vscode.Webview;
  extensionUri: vscode.Uri;
  title: string;
  body: string;
  script?: string;
  style?: string;
}): string {
  const nonce = getNonce();
  const csp = [
    "default-src 'none'",
    `style-src ${options.webview.cspSource} 'unsafe-inline'`,
    `script-src 'nonce-${nonce}'`,
    `img-src ${options.webview.cspSource} https: data:`,
    `font-src ${options.webview.cspSource}`,
  ].join("; ");

  const styleTag = options.style
    ? `<link rel="stylesheet" href="${assetUri(options.webview, options.extensionUri, options.style)}">`
    : "";
  const scriptTag = options.script
    ? `<script nonce="${nonce}" src="${assetUri(options.webview, options.extensionUri, options.script)}"></script>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${options.title}</title>
  ${styleTag}
</head>
<body>
${options.body}
${scriptTag}
</body>
</html>`;
}
