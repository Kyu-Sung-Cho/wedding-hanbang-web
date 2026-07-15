// Shared HTML sanitizer for browser and server runtimes.
// Keep this dependency-free so API GET routes do not load jsdom in Vercel.

const ALLOWED_TAGS = new Set([
  "p",
  "br",
  "strong",
  "b",
  "em",
  "i",
  "u",
  "s",
  "blockquote",
  "ul",
  "ol",
  "li",
  "h2",
  "h3",
  "h4",
  "span",
  "div",
]);

const VOID_TAGS = new Set(["br"]);

function stripDangerousBlocks(input: string): string {
  return input
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<\s*(script|style|iframe|object|embed|form|input)\b[\s\S]*?<\s*\/\s*\1\s*>/gi, "")
    .replace(/<\s*(script|style|iframe|object|embed|form|input)\b[^>]*\/?>/gi, "");
}

export function sanitizeHtml(dirty: string): string {
  const withoutBlocks = stripDangerousBlocks(dirty ?? "");

  return withoutBlocks.replace(/<\/?([a-zA-Z][a-zA-Z0-9:-]*)\b([^>]*)>/g, (full, rawTag) => {
    const tagName = String(rawTag).toLowerCase();
    if (!ALLOWED_TAGS.has(tagName)) return "";

    const isClosing = /^<\s*\//.test(full);
    if (isClosing) return VOID_TAGS.has(tagName) ? "" : `</${tagName}>`;

    return `<${tagName}>`;
  });
}

export function sanitizeText(dirty: string): string {
  return stripDangerousBlocks(dirty ?? "")
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function validateTextInput(value: string, maxLength: number): string {
  return value.trim().slice(0, maxLength);
}
