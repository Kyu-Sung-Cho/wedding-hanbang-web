// wc64 문항 은행. 문구는 data/wc64-bank.json 에만 있다(문구를 고칠 때는 그 파일만 바꾼다).
import raw from "./data/wc64-bank.json";
import type {
  Wc64Bank, Wc64Dim, Wc64DimId, Wc64Item, Wc64Name, Wc64Plan, Wc64Section, Wc64Skipped, Wc64TypeCard,
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
 * 식 없이 하기로 해서(plan "none") 빠지는 문항인가: skip_tag "예식" 문항은 모두 빠진다.
 * 원본은 다른 자리 안내(noceremony_alt)가 있는 묶음에서 "그 자리로 답할게요"(skipped[sid] === false)를 고르면 남겼는데,
 * 2026-10-16 파운더 결정 DEC-1로 그 갈래를 없앴다. 그래서 묶음 넘기기 상태는 받지 않는다(2026-10-17 심사 CQ-5로 셋째 인자를 지웠다).
 */
export function isWc64CeremonyOff(itemId: string, plan: Wc64Plan | null): boolean {
  const it = ITEM_BY_ID.get(itemId);
  if (!it || !SECTION_OF_ITEM.has(itemId)) return false;
  return plan === "none" && it.skip_tag === "예식";
}

/**
 * 이 문항을 화면에 묻는가: 식 없이 해서 빠진 "예식" 문항이 아니고, 묶음 전체를 넘긴 곳(skipped[sid] === true)도 아니다.
 * 묻는 문항 규칙은 이 함수 하나다(2026-10-17 심사 CQ-4). 질문 흐름·진행 수·`visibleWc64Items` 가 모두 이것을 쓴다.
 * 옛 기록의 skipped[sid] === false(없앤 '다른 자리로 답하기')는 넘기지 않은 묶음과 같다. 모르는 id 는 false.
 */
export function isWc64ItemAsked(itemId: string, plan: Wc64Plan | null, skipped: Wc64Skipped = {}): boolean {
  const sid = SECTION_OF_ITEM.get(itemId);
  if (sid === undefined) return false;
  return skipped[sid] !== true && !isWc64CeremonyOff(itemId, plan);
}

/**
 * 식 계획 때문에 빠지지 않는 이 묶음의 문장 수(묶음 넘기기는 보지 않는다). 0이면 그 묶음 안내 카드도 내지 않는다.
 * 모르는 묶음 id 는 0.
 */
export function wc64SectionAskedCount(sectionId: string, plan: Wc64Plan | null): number {
  const sec = SECTION_BY_ID.get(sectionId);
  return sec ? sec.items.filter(it => !isWc64CeremonyOff(it.id, plan)).length : 0;
}

/** 화면에 낼 문항(묶음 순서대로) = `isWc64ItemAsked` 가 true 인 문항. */
export function visibleWc64Items(plan: Wc64Plan | null, skipped: Wc64Skipped = {}): Wc64Item[] {
  return WC64_ITEMS.filter(it => isWc64ItemAsked(it.id, plan, skipped));
}

/** 네 글자 코드의 유형 설명. 정하지 못한 자리('·')가 있거나 없는 코드면 null. */
export function wc64TypeCard(code: string): Wc64TypeCard | null {
  if (!/^[DO][WL][CU][MR]$/.test(code)) return null;
  return Object.prototype.hasOwnProperty.call(WC64_BANK.types, code) ? WC64_BANK.types[code] : null;
}

/**
 * 식 없이 한 결과(두 글자)의 이름. code 는 리포트의 code 그대로("D··M" 꼴, 비운 SPEND·CIRCLE 자리는 가운뎃점 U+00B7).
 * PACE·BOND 중 하나라도 정하지 못했거나('·') 그 밖의 모양이면 null.
 */
export function wc64NoCeremonyName(code: string): Wc64Name | null {
  if (!/^[DO]··[MR]$/.test(code)) return null;
  return Object.prototype.hasOwnProperty.call(WC64_BANK.no_ceremony_names, code) ? WC64_BANK.no_ceremony_names[code] : null;
}
