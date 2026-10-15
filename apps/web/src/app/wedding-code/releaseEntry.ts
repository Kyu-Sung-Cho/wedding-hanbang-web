import { MEASUREMENT_VERSION } from "@/lib/weddingCode/likert/types";
import type { WeddingCodeEntrySearchParams } from "./entry";

const legacyAnswerKeys = ["a", "b", "ga", "gb"] as const;

/** 명시 구판과 답 코드는 원래 파서에 맡긴다. 새 문항의 답으로 바꾸지 않는다. */
export function isLegacyWeddingCodeQuery(search: WeddingCodeEntrySearchParams): boolean {
  if (legacyAnswerKeys.some(key => search[key] !== undefined)) return true;
  return search.v !== undefined && search.v !== MEASUREMENT_VERSION;
}

export function weddingCodeReleaseTarget(queryIsLegacy: boolean, hash: string, explicitLikert = false): "legacy" | "likert" | "36" {
  if (queryIsLegacy) return "legacy";
  if (!hash || hash === "#") return explicitLikert ? "likert" : "36";
  return new URLSearchParams(hash.replace(/^#/, "")).has("wc-likert") ? "likert" : "legacy";
}
