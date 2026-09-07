export type AmoraBodyBlock =
  | { type: "paragraph" | "quote" | "heading" | "code" | "list"; text: string; marker?: string }
  | { type: "table"; headers: string[]; rows: string[][] };
export type AmoraInline = { type: "text" | "strong" | "emphasis" | "code" | "link"; text: string; href?: string };
export function parseAmoraMessageBody(content: string): AmoraBodyBlock[];
export function parseAmoraInline(text: string): AmoraInline[];
