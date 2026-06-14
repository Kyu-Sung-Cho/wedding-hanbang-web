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
  "a",
  "img",
  "figure",
  "figcaption",
  "h2",
  "h3",
  "h4",
  "span",
  "div",
]);

const VOID_TAGS = new Set(["br", "img"]);
const ALLOWED_ATTR = new Set(["href", "src", "alt", "title", "target", "rel"]);
const SAFE_URL_RE = /^(?:(?:https?|mailto|tel):|\/(?!\/)|#)/i;

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function stripDangerousBlocks(input: string): string {
  return input
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<\s*(script|style|iframe|object|embed|form|input)\b[\s\S]*?<\s*\/\s*\1\s*>/gi, "")
    .replace(/<\s*(script|style|iframe|object|embed|form|input)\b[^>]*\/?>/gi, "");
}

function sanitizeAttributes(tagName: string, rawAttrs: string): string {
  const attrs: string[] = [];
  const attrRe = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;
  let match: RegExpExecArray | null;

  while ((match = attrRe.exec(rawAttrs))) {
    const name = match[1].toLowerCase();
    if (!ALLOWED_ATTR.has(name)) continue;

    const value = match[3] ?? match[4] ?? match[5] ?? "";
    if ((name === "href" || name === "src") && !SAFE_URL_RE.test(value)) continue;
    if (tagName !== "a" && (name === "href" || name === "target" || name === "rel")) continue;
    if (tagName !== "img" && name === "src") continue;

    attrs.push(`${name}="${escapeAttr(value)}"`);
  }

  if (tagName === "a") {
    const relIndex = attrs.findIndex((attr) => attr.startsWith("rel="));
    if (relIndex >= 0) attrs.splice(relIndex, 1);
    attrs.push('rel="noopener noreferrer"');
  }

  return attrs.length ? ` ${attrs.join(" ")}` : "";
}

export function sanitizeHtml(dirty: string): string {
  const withoutBlocks = stripDangerousBlocks(dirty ?? "");

  return withoutBlocks.replace(/<\/?([a-zA-Z][a-zA-Z0-9:-]*)\b([^>]*)>/g, (full, rawTag, rawAttrs) => {
    const tagName = String(rawTag).toLowerCase();
    if (!ALLOWED_TAGS.has(tagName)) return "";

    const isClosing = /^<\s*\//.test(full);
    if (isClosing) return VOID_TAGS.has(tagName) ? "" : `</${tagName}>`;

    const attrs = sanitizeAttributes(tagName, String(rawAttrs ?? ""));
    return VOID_TAGS.has(tagName) ? `<${tagName}${attrs}>` : `<${tagName}${attrs}>`;
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
