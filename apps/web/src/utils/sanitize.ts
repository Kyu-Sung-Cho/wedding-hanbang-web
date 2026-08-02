import sanitizeHtmlLibrary from "sanitize-html";

// Shared HTML sanitizer for browser and server runtimes. sanitize-html uses
// the same parser-backed implementation in both environments, so stored HTML
// can be sanitized again at a render boundary without changing URL semantics.
const ALLOWED_TAGS = [
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
] as const;

const URL_BASE = new URL("https://sanitizer.invalid/");
const CONTROL_CHAR_RE = /[\u0000-\u001f\u007f]/;
const SAFE_TARGET_RE = /^_(?:blank|self)$/i;

type SanitizerOptions = Exclude<Parameters<typeof sanitizeHtmlLibrary>[1], undefined>;

function isSafeUrl(value: string, tagName: "a" | "img"): boolean {
  if (!value || value !== value.trim() || CONTROL_CHAR_RE.test(value)) return false;

  if (tagName === "a" && value.startsWith("#")) return true;

  if (value.startsWith("/") && !value.startsWith("//")) {
    try {
      // The WHATWG parser treats backslashes as slashes for special URLs.
      // Requiring the resolved origin to stay fixed rejects `/\\evil.test`.
      return new URL(value, URL_BASE).origin === URL_BASE.origin;
    } catch {
      return false;
    }
  }

  const allowedProtocols = tagName === "a"
    ? new Set(["http:", "https:", "mailto:", "tel:"])
    : new Set(["http:", "https:"]);

  try {
    const parsed = new URL(value);
    if (!allowedProtocols.has(parsed.protocol)) return false;
    if ((parsed.protocol === "http:" || parsed.protocol === "https:")
        && (!/^https?:\/\//i.test(value) || parsed.username || parsed.password)) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

const HTML_SANITIZER_OPTIONS: SanitizerOptions = {
  allowedTags: [...ALLOWED_TAGS],
  allowedAttributes: {
    "*": ["alt", "title"],
    a: ["href", "title", "target", "rel"],
    img: ["src", "alt", "title"],
  },
  allowedSchemes: ["http", "https", "mailto", "tel"],
  allowedSchemesByTag: {
    a: ["http", "https", "mailto", "tel"],
    img: ["http", "https"],
  },
  allowedSchemesAppliedToAttributes: ["href", "src"],
  allowProtocolRelative: false,
  disallowedTagsMode: "discard",
  enforceHtmlBoundary: false,
  nestingLimit: 64,
  // Explicitly discard every raw-text/RCDATA boundary that has historically
  // participated in mutation-XSS, plus the active containers the old policy
  // removed together with their contents.
  nonTextTags: [
    "script",
    "style",
    "textarea",
    "title",
    "xmp",
    "iframe",
    "noembed",
    "noframes",
    "noscript",
    "plaintext",
    "form",
    "object",
    "embed",
    "option",
  ],
  parseStyleAttributes: false,
  transformTags: {
    a(tagName, attributes) {
      const safeAttributes: Record<string, string> = {
        rel: "noopener noreferrer nofollow ugc",
      };
      if (attributes.href && isSafeUrl(attributes.href, "a")) {
        safeAttributes.href = attributes.href;
      }
      if (attributes.title !== undefined) safeAttributes.title = attributes.title;
      if (attributes.alt !== undefined) safeAttributes.alt = attributes.alt;
      if (attributes.target && SAFE_TARGET_RE.test(attributes.target)) {
        safeAttributes.target = attributes.target;
      }
      return { tagName, attribs: safeAttributes };
    },
    img(tagName, attributes) {
      const safeAttributes: Record<string, string> = {};
      if (attributes.src && isSafeUrl(attributes.src, "img")) {
        safeAttributes.src = attributes.src;
      }
      if (attributes.alt !== undefined) safeAttributes.alt = attributes.alt;
      if (attributes.title !== undefined) safeAttributes.title = attributes.title;
      return { tagName, attribs: safeAttributes };
    },
  },
};

function stripDangerousBlocks(input: string): string {
  return input
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<\s*(script|style|iframe|object|embed|form|input)\b[\s\S]*?<\s*\/\s*\1\s*>/gi, "")
    .replace(/<\s*(script|style|iframe|object|embed|form|input)\b[^>]*\/?>/gi, "");
}

export function sanitizeHtml(dirty: string): string {
  return sanitizeHtmlLibrary(typeof dirty === "string" ? dirty : "", HTML_SANITIZER_OPTIONS);
}

export function sanitizeHtmlWithInputLimit(dirty: unknown, maxLength: number): string {
  const input = typeof dirty === "string" ? dirty : "";
  return sanitizeHtml(input.slice(0, Math.max(0, maxLength)));
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
