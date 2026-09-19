import type { WeddingStyleValue } from "@hanbang/shared";
import type { TASTE_AVOID_OPTIONS, TASTE_DOMAIN_OPTIONS, TASTE_NEGOTIABILITY_OPTIONS, WEDDING_TASTE_V1_VERSION, WEDDING_TASTE_VERSION } from "./constants";

export type TasteDomain = typeof TASTE_DOMAIN_OPTIONS[number]["value"];
export type TasteAvoid = typeof TASTE_AVOID_OPTIONS[number]["value"];
export type TasteNegotiability = typeof TASTE_NEGOTIABILITY_OPTIONS[number]["value"];
export type TasteUnansweredStatus = "undecided" | "no_preference" | "not_applicable" | "skipped";
export type TasteSelection<T extends string = string> =
  | { status: "answered"; values: T[] }
  | { status: TasteUnansweredStatus };
interface WeddingTasteSelections {
  priorityDomains: TasteSelection<TasteDomain>;
  mood: TasteSelection<WeddingStyleValue>;
  details: Partial<Record<TasteDomain, TasteSelection>>;
  avoids: TasteSelection<TasteAvoid>;
  negotiability: Partial<Record<TasteDomain, TasteNegotiability>>;
}
export interface WeddingTasteDraftV1 extends WeddingTasteSelections {
  version: typeof WEDDING_TASTE_V1_VERSION;
}
export interface WeddingTasteDraftV2 extends WeddingTasteSelections {
  version: typeof WEDDING_TASTE_VERSION;
}
export type WeddingTasteDraft = WeddingTasteDraftV1 | WeddingTasteDraftV2;
export interface WeddingTasteSummaryRow {
  key: string;
  label: string;
  value: string;
  state: TasteSelection["status"];
}
