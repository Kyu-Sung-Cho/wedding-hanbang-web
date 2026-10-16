// wc64 문항 은행. 문구는 data/wc64-bank.json 에만 있다(문구를 고칠 때는 그 파일만 바꾼다).
import raw from "./data/wc64-bank.json";
import type {
  Wc64Bank, Wc64Dim, Wc64DimId, Wc64Item, Wc64Plan, Wc64Section, Wc64Skipped, Wc64TypeCard,
} from "./types";

export const WC64_BANK: Wc64Bank = raw as unknown as Wc64Bank;
/** 묶음(구역) 순서. KNOW 가 맨 앞이다. */
export const WC64_ORDER: readonly string[] = WC64_BANK.order;
export const WC64_DIMS: readonly Wc64Dim[] = WC64_BANK.dims;

const SECTION_BY_ID = new Map<string, Wc64Section>(WC64_BANK.sections.map(s => [s.id, s]));
const ITEM_BY_ID = new Map<string, Wc64Item>();
const SECTION_OF_ITEM = new Map<string, string>();
for (const s of WC64_BANK.sections) for (const it of s.items) { ITEM_BY_ID.set(it.id, it); SECTION_OF_ITEM.set(it.id, s.id) }

/** 64문항 전체(묶음 순서대로) */
export const WC64_ITEMS: readonly Wc64Item[] = WC64_ORDER.flatMap(sid => SECTION_BY_ID.get(sid)?.items ?? []);

export function wc64SectionById(id: string): Wc64Section | undefined {
  return SECTION_BY_ID.get(id);
}

export function wc64ItemById(id: string): Wc64Item | undefined {
  return ITEM_BY_ID.get(id);
}

/** 문항이 들어 있는 묶음 id */
export function wc64SectionIdOfItem(itemId: string): string | undefined {
  return SECTION_OF_ITEM.get(itemId);
}

export function wc64DimById(id: Wc64DimId): Wc64Dim | undefined {
  return WC64_BANK.dims.find(d => d.id === id);
}

/**
 * 식을 안 올리기로 해서(plan "none") 빠지는 문항인가.
 * 원본과 같이: skip_tag "예식" 문항이 빠지되, 다른 자리 안내(noceremony_alt)가 있는 묶음에서
 * "그 자리로 답할게요"를 고른 경우(skipped[sid] === false)에는 남긴다.
 */
export function isWc64CeremonyOff(itemId: string, plan: Wc64Plan | null, skipped: Wc64Skipped = {}): boolean {
  const it = ITEM_BY_ID.get(itemId);
  const sid = SECTION_OF_ITEM.get(itemId);
  if (!it || !sid) return false;
  if (plan !== "none" || it.skip_tag !== "예식") return false;
  const sec = SECTION_BY_ID.get(sid);
  return !(sec && sec.noceremony_alt && skipped[sid] === false);
}

/**
 * 화면에 낼 문항(묶음 순서대로). 식을 안 올리면 "예식" 문항을 빼고,
 * 묶음 전체를 넘긴 곳(skipped[sid] === true)의 문항도 뺀다.
 */
export function visibleWc64Items(plan: Wc64Plan | null, skipped: Wc64Skipped = {}): Wc64Item[] {
  return WC64_ITEMS.filter(it => {
    const sid = SECTION_OF_ITEM.get(it.id) as string;
    return skipped[sid] !== true && !isWc64CeremonyOff(it.id, plan, skipped);
  });
}

/** 네 글자 코드의 유형 설명. 정하지 못한 자리('·')가 있거나 없는 코드면 null. */
export function wc64TypeCard(code: string): Wc64TypeCard | null {
  if (!/^[DO][WL][CU][MR]$/.test(code)) return null;
  return Object.prototype.hasOwnProperty.call(WC64_BANK.types, code) ? WC64_BANK.types[code] : null;
}
