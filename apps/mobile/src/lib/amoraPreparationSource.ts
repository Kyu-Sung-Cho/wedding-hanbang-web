/** 공개 안내 ID만 이동시킨다. 안내 본문은 현재 서버 정본에서 확인한다. */
export function readPreparationSource(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 170) return null;
  return /^(?:c\.[a-z][a-z0-9-]{0,63}(?:\.[a-z][a-z0-9_]{0,79})?|g\.[a-z][a-z0-9-]{0,63}(?:\.section-[1-9]\d{0,2})?)$/.test(value) ? value : null;
}

export function preparationNavigation(url: string): { route: string } | { invalid: true } | null {
  const parsed = new URL(url);
  if (!parsed.searchParams.has("amoraSource")) return null;
  const values = parsed.searchParams.getAll("amoraSource");
  const source = values.length === 1 ? readPreparationSource(values[0]) : null;
  if (!source || !["/chat", "/wedding/chat"].includes(parsed.pathname)
    || [...parsed.searchParams.keys()].some(key => key !== "amoraSource")) return { invalid: true };
  return { route: `/chat?${new URLSearchParams({ amoraSource: source })}` };
}

export interface PreparationDraft {
  source: string;
  text: string;
  sourceLabel: string;
  sourceHref: string;
}

export function parsePreparationDraft(value: unknown, expectedSource: string): PreparationDraft | null {
  if (!value || typeof value !== "object" || Array.isArray(value) || !readPreparationSource(expectedSource)) return null;
  const row = value as Record<string, unknown>;
  if (Object.keys(row).length !== 4 || !["source", "text", "sourceLabel", "sourceHref"].every(key => Object.hasOwn(row, key))) return null;
  if (row.source !== expectedSource || typeof row.text !== "string" || !row.text.trim() || row.text.length > 4000
    || typeof row.sourceLabel !== "string" || !row.sourceLabel.trim() || row.sourceLabel.length > 1000
    || [...row.text + row.sourceLabel].some(character => {
      const point = character.charCodeAt(0);
      return (point < 32 && ![9, 10, 13].includes(point)) || point === 127;
    })) return null;
  const [kind, key, detail] = expectedSource.split(".");
  const href = kind === "c" ? `/checklist?category=${key}` : `/manners/${key}${detail ? `#${detail}` : ""}`;
  if (row.sourceHref !== href) return null;
  return { source: expectedSource, text: row.text, sourceLabel: row.sourceLabel, sourceHref: href };
}

export interface PreparationContext {
  ownerId: string | null;
  coupleId: string | null;
  generation: number;
  lane: string | null;
  ready: boolean;
  busy: boolean;
  input: string;
}

export function preparationContextMatches(before: PreparationContext, current: PreparationContext): boolean {
  return before.ready && !before.busy && !!before.ownerId && !!before.coupleId && before.ownerId === current.ownerId
    && before.coupleId === current.coupleId && before.generation === current.generation
    && before.lane === "shared_ai" && current.lane === "shared_ai" && current.ready && !current.busy;
}

/** 이미 쓰는 질문·다른 레인은 보존하고, 응답 후에도 같은 세대인지 확인한다. */
export async function loadPreparationForContext(
  source: string, before: PreparationContext, current: () => PreparationContext,
  load: (source: string) => Promise<unknown>,
): Promise<PreparationDraft | null> {
  if (!readPreparationSource(source) || !preparationContextMatches(before, current()) || before.input.trim()) return null;
  const value = await load(source);
  if (!preparationContextMatches(before, current()) || current().input.trim()) return null;
  return parsePreparationDraft(value, source);
}
