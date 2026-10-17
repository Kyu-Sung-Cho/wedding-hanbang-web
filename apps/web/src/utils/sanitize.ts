import sanitize from "sanitize-html";

// 서버 저장과 브라우저 표시가 같은 파서·허용목록을 쓴다. 서버에 DOM/jsdom은 필요 없다.
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
];

const SAFE_URL_RE = /^(?:(?:https?|mailto|tel):|\/(?![/\\])|#)/i;

const HTML_OPTIONS: sanitize.IOptions = {
  allowedTags: ALLOWED_TAGS,
  allowedAttributes: {
    "*": ["title"],
    a: ["href", "target", "rel"],
    img: ["src", "alt"],
  },
  allowedSchemes: ["http", "https", "mailto", "tel"],
  allowedSchemesByTag: { img: ["http", "https"] },
  allowProtocolRelative: false,
  // 과도하게 중첩한 글이 React 변환의 호출 스택을 고갈시키지 않게 한다.
  nestingLimit: 32,
  // 다른 namespace의 내용을 HTML로 다시 해석하지 않는다.
  nonTextTags: [
    "script", "style", "textarea", "option", "iframe", "object", "embed",
    "form", "input", "svg", "math", "template",
  ],
  parseStyleAttributes: false,
  transformTags: {
    "*": (tagName, attributes) => {
      const attribs = { ...attributes };
      // 파서가 엔티티를 해독한 뒤 URL 정책을 적용한다. 태그/속성 해석은 정규식으로 하지 않는다.
      for (const name of ["href", "src"]) {
        if (attribs[name] !== undefined && !SAFE_URL_RE.test(attribs[name])) {
          delete attribs[name];
        }
      }
      if (tagName === "a") attribs.rel = "noopener noreferrer";
      return { tagName, attribs };
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
  return sanitize(dirty ?? "", HTML_OPTIONS);
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
