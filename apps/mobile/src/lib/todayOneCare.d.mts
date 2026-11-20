import type {
  TodayOneCareAction,
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

export declare function getTodayOneNativeRoute(
  href: unknown,
): "/schedule" | "/budget" | "/(tabs)/lounge" | "/halls/letter" | "/(tabs)/schedule" | null;

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
