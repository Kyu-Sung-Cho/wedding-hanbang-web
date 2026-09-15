/** 공개 안내 ID만 이동시킨다. 안내 본문은 현재 서버 정본에서 확인한다. */
export function readPreparationSource(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 170) return null;
  return /^(?:c\.[a-z][a-z0-9-]{0,63}(?:\.[a-z][a-z0-9_]{0,79})?|g\.[a-z][a-z0-9-]{0,63}(?:\.section-[1-9]\d{0,2})?)$/.test(value) ? value : null;
}

/** 네이티브 아모라 채팅으로 가는 경로. 웹뷰 링크와 네이티브 버튼이 같은 모양을 쓴다. */
export function preparationChatRoute(source: unknown): string | null {
  const valid = readPreparationSource(source);
  return valid ? `/chat?${new URLSearchParams({ amoraSource: valid })}` : null;
}

/**
 * 체크리스트 분야(와 항목)에서 아모라에게 묻는 경로. 웹 `buildAmoraPreparationHref`의
 * `c.<분야>` / `c.<분야>.<항목>` 과 같은 ID를 만든다. 질문 문장은 여기서 짓지 않는다 —
 * 채팅이 서버 정본(`/api/amora/preparation-source`)에서 받아 입력창에만 채운다.
 */
export function checklistPreparationRoute(categoryKey: string, itemId?: string): string | null {
  return preparationChatRoute(itemId === undefined ? `c.${categoryKey}` : `c.${categoryKey}.${itemId}`);
}

export function preparationNavigation(url: string): { route: string } | { invalid: true } | null {
  const parsed = new URL(url);
  if (!parsed.searchParams.has("amoraSource")) return null;
  const values = parsed.searchParams.getAll("amoraSource");
  const route = values.length === 1 ? preparationChatRoute(values[0]) : null;
  if (!route || !["/chat", "/wedding/chat"].includes(parsed.pathname)
    || [...parsed.searchParams.keys()].some(key => key !== "amoraSource")) return { invalid: true };
  return { route };
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
