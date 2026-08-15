import type {
  TodayOneCareAction,
  TodayOneCareKind,
  TodayOneCareResponse,
} from "@hanbang/shared";

export type TodayOneEnvelope =
  | { available: false }
  | {
      available: true;
      result: unknown;
      error?: string;
      code?: string;
    };

export interface TodayOnePreference {
  enabled: boolean;
  optedInAt: string | null;
  pausedUntil: string | null;
  dailyLimit: 1;
}

export type TodayOnePreferenceEnvelope =
  | { available: false }
  | { available: true; preference: TodayOnePreference };

export declare function parseTodayOneEnvelope(
  value: unknown,
): TodayOneEnvelope | null;

export declare function parseTodayOnePreferenceEnvelope(
  value: unknown,
): TodayOnePreferenceEnvelope | null;

export declare function canRenderTodayOneFallback(
  expectedOwnerUserId: unknown,
  verifiedOwnerUserId: unknown,
  expectedCoupleId: unknown,
  verifiedCoupleId: unknown,
): boolean;

export declare function getTodayOneNativeRoute(
  href: unknown,
): "/schedule" | "/budget" | "/dashboard" | null;

export type TodayOneNativeKindPresentation =
  | { readonly recordLabel: "일정"; readonly icon: "schedule" }
  | { readonly recordLabel: "예산"; readonly icon: "budget" }
  | { readonly recordLabel: "결정"; readonly icon: "decision" };

export declare function getTodayOneNativeKindPresentation(
  kind: TodayOneCareKind,
): TodayOneNativeKindPresentation;
export declare function getTodayOneNativeKindPresentation(
  kind: unknown,
): TodayOneNativeKindPresentation | null;

export declare function isTodayOneCareCardCurrent(
  card: unknown,
  nowMs?: number,
): boolean;

export declare function buildTodayOneActionBody(
  card: Pick<TodayOneCareResponse["card"] extends infer T ? NonNullable<T> : never,
    "id" | "revision" | "sourceRevision">,
  action: TodayOneCareAction,
): {
  cardId: string;
  expectedRevision: number;
  expectedSourceRevision: number;
  action: TodayOneCareAction;
} | null;
