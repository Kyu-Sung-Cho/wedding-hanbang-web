import DOMPurify from "isomorphic-dompurify";

// HTML 콘텐츠 정화 (XSS 방지)
export function sanitizeHtml(dirty: string): string {
  return DOMPurify.sanitize(dirty, {
    ALLOWED_TAGS: [
      "p", "br", "b", "i", "em", "strong", "u", "s", "del",
      "h1", "h2", "h3", "h4", "h5", "h6",
      "ul", "ol", "li", "blockquote", "pre", "code",
      "a", "img", "hr", "span", "div",
      "table", "thead", "tbody", "tr", "th", "td",
    ],
    ALLOWED_ATTR: [
      "href", "src", "alt", "title", "class", "target", "rel",
      "width", "height",
    ],
    ALLOW_DATA_ATTR: false,
    ADD_ATTR: ["target"],
    FORBID_TAGS: ["script", "style", "iframe", "object", "embed", "form", "input"],
    FORBID_ATTR: ["onerror", "onload", "onclick", "onmouseover", "onfocus", "onblur"],
  });
}

// 일반 텍스트 정화 (태그 완전 제거)
export function sanitizeText(dirty: string): string {
  return DOMPurify.sanitize(dirty, { ALLOWED_TAGS: [] });
}

// 입력값 길이 + 기본 정화
export function validateTextInput(
  value: string,
  maxLength: number,
): string {
  return value.trim().slice(0, maxLength);
}
