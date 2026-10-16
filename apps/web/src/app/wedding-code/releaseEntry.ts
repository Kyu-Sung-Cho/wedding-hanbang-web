import { MEASUREMENT_VERSION } from "@/lib/weddingCode/likert/types";
import { WC64_QUERY_VALUE } from "@/lib/weddingCode/wc64/types";
import type { WeddingCodeEntrySearchParams } from "./entry";

const legacyAnswerKeys = ["a", "b", "ga", "gb"] as const;

/** 36문항을 명시하는 주소 값. 초대(`?ct=`)는 프록시 규칙상 `v` 없이 오므로 이 값과 따로 본다. */
export const WEDDING_CODE36_QUERY_VALUE = "36" as const;

export type WeddingCodeReleaseTarget = "legacy" | "likert" | "36" | "wc64";
export type WeddingCodeExplicitTarget = Exclude<WeddingCodeReleaseTarget, "legacy">;

/**
 * 맨 주소(`/wedding-code`, 해시 없음)가 여는 판. 한 줄로 되돌리는 스위치다.
 * `"36"` 으로 바꾸면 맨 주소가 다시 36문항을 열고, 64문항은 `?v=64` 로만 남는다. 시험도 이 상수를 본다.
 */
export const WEDDING_CODE_BARE_TARGET: "wc64" | "36" = "wc64";

/** 명시 구판과 답 코드는 원래 파서에 맡긴다. 새 문항의 답으로 바꾸지 않는다. */
export function isLegacyWeddingCodeQuery(search: WeddingCodeEntrySearchParams): boolean {
  if (legacyAnswerKeys.some(key => search[key] !== undefined)) return true;
  const v = search.v;
  return v !== undefined && v !== MEASUREMENT_VERSION && v !== WEDDING_CODE36_QUERY_VALUE && v !== WC64_QUERY_VALUE;
}

/**
 * 주소가 직접 고른 새 판. 고르지 않았으면 null 이고, 그때는 맨 주소 기본값을 쓴다.
 * `v` 가 있으면 `v` 가 정한다. `v` 없이 온 `ct`(36문항 초대, 형식은 프록시가 이미 걸렀다)는 36문항이다.
 */
export function weddingCodeExplicitTarget(search: WeddingCodeEntrySearchParams): WeddingCodeExplicitTarget | null {
  const v = search.v;
  if (v === MEASUREMENT_VERSION) return "likert";
  if (v === WEDDING_CODE36_QUERY_VALUE) return "36";
  if (v === WC64_QUERY_VALUE) return "wc64";
  if (v === undefined && search.ct !== undefined) return "36";
  return null;
}

export function weddingCodeReleaseTarget(
  queryIsLegacy: boolean,
  hash: string,
  explicit: WeddingCodeExplicitTarget | null = null,
): WeddingCodeReleaseTarget {
  if (queryIsLegacy) return "legacy";
  if (!hash || hash === "#") return explicit ?? WEDDING_CODE_BARE_TARGET;
  return new URLSearchParams(hash.replace(/^#/, "")).has("wc-likert") ? "likert" : "legacy";
}
