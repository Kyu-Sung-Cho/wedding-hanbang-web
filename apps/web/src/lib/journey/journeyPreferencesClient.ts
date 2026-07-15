import type {
  BudgetTendency,
  GuestCount,
  PriorityItem,
  WeddingStyle,
} from "@/types/onboarding.types";

export interface JourneyPreferences {
  weddingStyle?: WeddingStyle | null;
  priorities?: PriorityItem[];
  budgetTendency?: BudgetTendency | null;
  guestCount?: GuestCount | null;
}

export interface JourneyPreferencesResult {
  progress: Record<string, unknown>;
  preferences: JourneyPreferences;
}

const WEDDING_STYLES = new Set(["minimal", "classic", "fancy", "natural"]);
const PRIORITIES = new Set(["sdm", "venue", "rings", "honeymoon", "ceremony", "housing"]);
const BUDGET_TENDENCIES = new Set(["saving", "balanced", "premium"]);
const GUEST_COUNTS = new Set(["under50", "50to100", "100to200", "200to300", "over300"]);
const FIELDS = new Set(["weddingStyle", "priorities", "budgetTendency", "guestCount"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNullableEnum(value: unknown, values: Set<string>): boolean {
  return value === null || (typeof value === "string" && values.has(value));
}

export function isJourneyPreferences(value: unknown): value is JourneyPreferences {
  if (!isRecord(value) || Object.keys(value).some((key) => !FIELDS.has(key))) return false;
  if (value.weddingStyle !== undefined && !isNullableEnum(value.weddingStyle, WEDDING_STYLES)) return false;
  if (value.budgetTendency !== undefined && !isNullableEnum(value.budgetTendency, BUDGET_TENDENCIES)) return false;
  if (value.guestCount !== undefined && !isNullableEnum(value.guestCount, GUEST_COUNTS)) return false;
  if (value.priorities !== undefined) {
    if (
      !Array.isArray(value.priorities) ||
      value.priorities.length > PRIORITIES.size ||
      value.priorities.some((item) => typeof item !== "string" || !PRIORITIES.has(item)) ||
      new Set(value.priorities).size !== value.priorities.length
    ) {
      return false;
    }
  }
  return true;
}

export async function patchJourneyPreferences(
  patch: JourneyPreferences,
  fetcher: typeof fetch = fetch,
): Promise<JourneyPreferencesResult> {
  const response = await fetcher("/api/journey/preferences", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  const body = await response.json().catch(() => null) as unknown;

  if (!response.ok) {
    const message = isRecord(body) && typeof body.error === "string"
      ? body.error
      : "웨딩 스타일을 저장하지 못했습니다.";
    throw new Error(message);
  }

  if (
    !isRecord(body) ||
    !isRecord(body.progress) ||
    !isJourneyPreferences(body.preferences) ||
    !isJourneyPreferences(body.progress.__preferences) ||
    JSON.stringify(body.preferences) !== JSON.stringify(body.progress.__preferences) ||
    Object.entries(patch).some(([key, value]) =>
      JSON.stringify((body.preferences as Record<string, unknown>)[key]) !== JSON.stringify(value)
    )
  ) {
    throw new Error("저장된 웨딩 스타일을 확인하지 못했습니다. 새로고침 후 다시 시도해 주세요.");
  }

  return body as unknown as JourneyPreferencesResult;
}
