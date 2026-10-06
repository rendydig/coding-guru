/**
 * Best-effort extraction of the first balanced JSON object from a model reply.
 * Models often wrap JSON in prose or ```json fences, so we scan for the first
 * `{` and walk braces while respecting strings and escapes.
 */
export function extractJson<T>(text: string): T | undefined {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const candidates = fenced ? [fenced[1], text] : [text];
  for (const candidate of candidates) {
    const parsed = parseFirstObject<T>(candidate);
    if (parsed !== undefined) {
      return parsed;
    }
  }
  return undefined;
}

function parseFirstObject<T>(text: string): T | undefined {
  const start = text.indexOf("{");
  if (start === -1) {
    return undefined;
  }
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === "{") {
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1)) as T;
        } catch {
          return undefined;
        }
      }
    }
  }
  return undefined;
}
