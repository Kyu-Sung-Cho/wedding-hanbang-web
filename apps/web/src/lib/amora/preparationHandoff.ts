export const AMORA_PREPARATION_SOURCE_PARAM = "amoraSource";

export type AmoraPreparationSource =
  | { kind: "checklist"; categoryKey: string; itemId?: string }
  | { kind: "manners"; partSlug: string; sectionId?: string };

export type AmoraPreparationDraft = {
  text: string;
  sourceLabel: string;
  sourceHref: string;
  referenceText: string;
};

const KEY = /^[a-z][a-z0-9-]{0,63}$/;
const ITEM = /^[a-z][a-z0-9_]{0,79}$/;
const SECTION = /^section-[1-9]\d{0,2}$/;

/** URL에는 공개 식별자만 싣는다. 존재 여부는 소비 직전 정본 목록과 다시 대조한다. */
export function buildAmoraPreparationHref(source: AmoraPreparationSource): string | null {
  let value: string;
  if (source.kind === "checklist") {
    if (!KEY.test(source.categoryKey) || (source.itemId !== undefined && !ITEM.test(source.itemId))) return null;
    value = ["c", source.categoryKey, ...(source.itemId === undefined ? [] : [source.itemId])].join(".");
  } else if (source.kind === "manners") {
    if (!KEY.test(source.partSlug) || (source.sectionId !== undefined && !SECTION.test(source.sectionId))) return null;
    value = ["g", source.partSlug, ...(source.sectionId === undefined ? [] : [source.sectionId])].join(".");
  } else return null;
  return `/chat?${new URLSearchParams({ [AMORA_PREPARATION_SOURCE_PARAM]: value })}`;
}

export function parseAmoraPreparationSource(value: string): AmoraPreparationSource | null {
  if (value.length > 170) return null;
  const parts = value.split(".");
  if (parts.length !== 2 && parts.length !== 3) return null;
  const [kind, key, detail] = parts;
  if (!KEY.test(key)) return null;
  if (kind === "c" && (detail === undefined || ITEM.test(detail))) {
    return { kind: "checklist", categoryKey: key, ...(detail === undefined ? {} : { itemId: detail }) };
  }
  if (kind === "g" && (detail === undefined || SECTION.test(detail))) {
    return { kind: "manners", partSlug: key, ...(detail === undefined ? {} : { sectionId: detail }) };
  }
  return null;
}

/** 안내 본문은 일반 채팅 번들에서 빼고, 이 연결을 실제로 열 때만 정본을 읽는다. */
export async function resolveAmoraPreparationSource(value: string): Promise<AmoraPreparationDraft | null> {
  const source = parseAmoraPreparationSource(value);
  if (!source) return null;
  const { resolvePreparationCatalogSource } = await import("./preparationHandoffCatalog");
  return resolvePreparationCatalogSource(source);
}
