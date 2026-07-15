export interface CommunityPlainTextOptions {
  preserveParagraphs?: boolean;
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  apos: "'",
  gt: ">",
  lt: "<",
  nbsp: " ",
  quot: '"',
};

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (match, raw: string) => {
      const codePoint = Number.parseInt(raw, 16);
      try {
        return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match;
      } catch {
        return match;
      }
    })
    .replace(/&#([0-9]+);/g, (match, raw: string) => {
      const codePoint = Number.parseInt(raw, 10);
      try {
        return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match;
      } catch {
        return match;
      }
    })
    .replace(/&([a-z]+);/gi, (match, name: string) => NAMED_ENTITIES[name.toLowerCase()] ?? match);
}

/**
 * Converts sanitized community HTML to readable text without joining adjacent
 * block elements (for example `</p><p>`). This is display-only, not an HTML
 * sanitizer or security boundary.
 */
export function communityHtmlToPlainText(
  input: string,
  options: CommunityPlainTextOptions = {},
): string {
  const withBoundaries = input
    .replace(/<\s*br\s*\/?\s*>/gi, "\n")
    .replace(/<\s*\/\s*(?:p|div|li|ol|ul|blockquote|h[1-6]|section|article)\s*>/gi, "\n")
    .replace(/<\s*(?:p|div|li|ol|ul|blockquote|h[1-6]|section|article)(?:\s[^>]*)?>/gi, "\n")
    .replace(/<[^>]*>/g, " ");

  const lines = decodeHtmlEntities(withBoundaries)
    .split(/\n+/)
    .map((line) => line.replace(/[\t\f\v ]+/g, " ").trim())
    .filter(Boolean);

  return lines.join(options.preserveParagraphs ? "\n\n" : " ");
}
