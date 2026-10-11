export type AmoraReferenceToken =
  | { type: "link"; text: string; href: string; length: number }
  | { type: "text"; text: string; length: number };
export function getSafeAmoraReferenceHref(raw: unknown): string | null;
export function readAmoraReferenceAt(text: string, index: number): AmoraReferenceToken | null;
