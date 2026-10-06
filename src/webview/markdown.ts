import DOMPurify from "dompurify";
import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import cpp from "highlight.js/lib/languages/cpp";
import csharp from "highlight.js/lib/languages/csharp";
import css from "highlight.js/lib/languages/css";
import diff from "highlight.js/lib/languages/diff";
import go from "highlight.js/lib/languages/go";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import markdown from "highlight.js/lib/languages/markdown";
import plaintext from "highlight.js/lib/languages/plaintext";
import python from "highlight.js/lib/languages/python";
import rust from "highlight.js/lib/languages/rust";
import sql from "highlight.js/lib/languages/sql";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";
import MarkdownIt from "markdown-it";

const LANGUAGES = {
  bash,
  cpp,
  csharp,
  css,
  diff,
  go,
  java,
  javascript,
  json,
  markdown,
  plaintext,
  python,
  rust,
  sql,
  typescript,
  xml,
  yaml,
};

for (const [name, definition] of Object.entries(LANGUAGES)) {
  hljs.registerLanguage(name, definition);
}

/** Aliases models emit that highlight.js does not map on its own. */
const ALIASES: Record<string, string> = {
  node: "javascript",
  nodejs: "javascript",
  shell: "bash",
  console: "bash",
  terminal: "bash",
  postgres: "sql",
  postgresql: "sql",
  mysql: "sql",
  vue: "xml",
  svelte: "xml",
  text: "plaintext",
  txt: "plaintext",
};

const LANGUAGE_NAMES = Object.keys(LANGUAGES);

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => ESCAPES[char]);
}

function resolveLanguage(raw: string): string | undefined {
  const name = raw.trim().toLowerCase();
  if (!name) {
    return undefined;
  }
  const mapped = ALIASES[name] ?? name;
  return hljs.getLanguage(mapped) ? mapped : undefined;
}

function highlightCode(code: string, language: string | undefined): string {
  if (language) {
    try {
      return hljs.highlight(code, { language, ignoreIllegals: true }).value;
    } catch {
      return escapeHtml(code);
    }
  }
  try {
    return hljs.highlightAuto(code, LANGUAGE_NAMES).value;
  } catch {
    return escapeHtml(code);
  }
}

function codeBlockHtml(language: string | undefined, highlighted: string, lineCount: number): string {
  const label = language ?? "text";
  // The gutter is generated from the raw line count rather than by splitting the
  // highlighted HTML, which would break spans that cross lines (multi-line
  // comments, template literals).
  const gutter =
    lineCount > 1
      ? `<div class="gutter" aria-hidden="true">${Array.from(
          { length: lineCount },
          (_unused, index) => index + 1
        ).join("<br>")}</div>`
      : "";
  return (
    `<div class="code-block" data-lang="${escapeHtml(label)}">` +
    `<div class="code-head"><span class="code-lang">${escapeHtml(label)}</span>` +
    `<button class="code-copy" type="button">Copy</button></div>` +
    `<div class="code-body">${gutter}<pre class="hljs"><code>${highlighted}</code></pre></div>` +
    `</div>`
  );
}

const md = new MarkdownIt({
  // Raw HTML from the model is escaped, never executed.
  html: false,
  linkify: true,
  breaks: false,
});

md.renderer.rules.fence = (tokens, idx) => {
  const token = tokens[idx];
  const rawInfo = token.info ? token.info.trim() : "";
  const requested = rawInfo.split(/\s+/)[0] ?? "";
  const language = resolveLanguage(requested);
  const code = token.content.replace(/\n$/, "");
  const lineCount = code.split("\n").length;
  return codeBlockHtml(language ?? (requested ? requested.toLowerCase() : undefined), highlightCode(code, language), lineCount);
};

/**
 * Renders Markdown to sanitized HTML.
 *
 * `class` is added explicitly so DOMPurify cannot strip the `hljs-*` token
 * classes; without them code blocks render unstyled.
 */
export function renderMarkdown(text: string): string {
  const html = md.render(text);
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    ADD_ATTR: ["class", "target", "rel"],
  });
}
