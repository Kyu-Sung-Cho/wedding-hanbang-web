export interface WeddingSettingsData {
  userId: string;
  coupleId: string | null;
  nickname: string;
  communityNickname: string;
  role: string | null;
  weddingDate: string;
  venue: string;
  /** Displayed in 만원. The API and database always use 원. */
  totalBudget: string;
}

export interface WeddingSettingsSnapshot {
  userId: string;
  coupleId: string | null;
  name: string | null;
  communityNickname: string | null;
  role: "bride" | "groom" | null;
  weddingDate: string | null;
  venue: string | null;
  /** Exact database value in 원. */
  totalBudget: number | null;
}

export interface WeddingSettingsPatchBody {
  expected_couple_id: string | null;
  changes: Record<string, string | number | null>;
  expected: Record<string, string | number | null>;
}

export interface WeddingSettingsProfile {
  id: string;
  name: string | null;
  role: "bride" | "groom" | null;
  couple_id: string | null;
  care_notifications_enabled: boolean;
  care_notifications_consented_at: string | null;
}

export interface ParsedWeddingSettingsResponse {
  data: WeddingSettingsData;
  snapshot: WeddingSettingsSnapshot;
  profile: WeddingSettingsProfile;
  careAvailability: unknown;
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_BUDGET_WON = 1_000_000_000;
const MAX_EXISTING_BUDGET_WON = 1_000_000_000_000;

function hasControlCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 0x1f || codePoint === 0x7f;
  });
}

export function createLatestSettingsLoadGate() {
  let latestGeneration = 0;

  return {
    begin() {
      const generation = ++latestGeneration;
      let cancelled = false;

      return {
        isCurrent: () => !cancelled && generation === latestGeneration,
        cancel: () => {
          cancelled = true;
        },
      };
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRealIsoDate(value: string): boolean {
  if (!ISO_DATE_RE.test(value) || value.startsWith("0000-")) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function normalizeEditableRequiredText(
  value: string,
  existingValue: string | null,
  label: string,
  maxLength: number,
): string | null {
  const normalized = value.trim();
  if (!normalized && existingValue === null) return null;
  if (
    !normalized ||
    Array.from(normalized).length > maxLength ||
    hasControlCharacter(normalized)
  ) {
    throw new Error(`${label} 형식이 올바르지 않아요.`);
  }
  return normalized;
}

function parseBudgetManwon(value: string): number | null {
  const normalized = value.trim();
  if (normalized === "") return null;
  if (!/^\d+(?:\.\d{1,4})?$/.test(normalized)) {
    throw new Error("예산은 숫자로 정확히 입력해주세요.");
  }

  const manwon = Number(normalized);
  const won = manwon * 10_000;
  if (!Number.isSafeInteger(won)) {
    throw new Error("예산은 원 단위 정수로 저장할 수 있는 값이어야 해요.");
  }
  if (won < 0 || won > MAX_BUDGET_WON) {
    throw new Error("예산은 10억 원 이하로 입력해주세요.");
  }
  return won;
}

function addChange(
  changes: WeddingSettingsPatchBody["changes"],
  expected: WeddingSettingsPatchBody["expected"],
  key: string,
  nextValue: string | number | null,
  oldValue: string | number | null,
) {
  if (nextValue === oldValue) return;
  changes[key] = nextValue;
  expected[key] = oldValue;
}

export function buildWeddingSettingsPatch(
  data: WeddingSettingsData,
  snapshot: WeddingSettingsSnapshot,
): WeddingSettingsPatchBody | null {
  if (data.userId !== snapshot.userId || data.coupleId !== snapshot.coupleId) {
    throw new Error("커플 연결 상태가 바뀌었어요. 설정을 다시 불러와주세요.");
  }

  const changes: WeddingSettingsPatchBody["changes"] = {};
  const expected: WeddingSettingsPatchBody["expected"] = {};

  if (data.nickname !== (snapshot.name ?? "")) {
    const name = normalizeEditableRequiredText(data.nickname, snapshot.name, "이름", 80);
    addChange(changes, expected, "name", name, snapshot.name);
  }
  if (data.communityNickname !== (snapshot.communityNickname ?? "")) {
    const communityNickname = normalizeEditableRequiredText(
      data.communityNickname,
      snapshot.communityNickname,
      "커뮤니티 별명",
      20,
    );
    addChange(
      changes,
      expected,
      "community_nickname",
      communityNickname,
      snapshot.communityNickname,
    );
  }
  if (data.weddingDate !== (snapshot.weddingDate ?? "")) {
    const weddingDate = data.weddingDate.trim() === "" ? null : data.weddingDate.trim();
    if (weddingDate !== null && !isRealIsoDate(weddingDate)) {
      throw new Error("결혼 날짜를 YYYY-MM-DD 형식의 실제 날짜로 입력해주세요.");
    }
    addChange(changes, expected, "wedding_date", weddingDate, snapshot.weddingDate);
  }
  if (data.venue !== (snapshot.venue ?? "")) {
    const trimmedVenue = data.venue.trim();
    const venue = trimmedVenue === "" ? null : trimmedVenue;
    if (
      venue !== null &&
      (Array.from(venue).length > 120 || hasControlCharacter(venue))
    ) {
      throw new Error("결혼식장 이름은 120자 이내로 입력해주세요.");
    }
    addChange(changes, expected, "venue", venue, snapshot.venue);
  }
  const existingBudgetDisplay =
    snapshot.totalBudget === null ? "" : String(snapshot.totalBudget / 10_000);
  if (data.totalBudget !== existingBudgetDisplay) {
    const totalBudget = parseBudgetManwon(data.totalBudget);
    addChange(changes, expected, "total_budget", totalBudget, snapshot.totalBudget);
  }

  if (Object.keys(changes).length === 0) return null;
  return {
    expected_couple_id: snapshot.coupleId,
    changes,
    expected,
  };
}

export function parseWeddingSettingsResponse(
  input: unknown,
): ParsedWeddingSettingsResponse {
  if (!isRecord(input) || !isRecord(input.settings)) {
    throw new Error("저장된 설정을 확인하지 못했어요.");
  }

  const settings = input.settings;
  const userId = typeof settings.user_id === "string" ? settings.user_id : null;
  const coupleId =
    settings.couple_id === null || typeof settings.couple_id === "string"
      ? settings.couple_id
      : undefined;
  const name = settings.name === null || typeof settings.name === "string"
    ? settings.name
    : undefined;
  const communityNickname =
    settings.community_nickname === null || typeof settings.community_nickname === "string"
      ? settings.community_nickname
      : undefined;
  const role = settings.role === "bride" || settings.role === "groom" || settings.role === null
    ? settings.role
    : undefined;
  const weddingDate =
    settings.wedding_date === null ||
    (typeof settings.wedding_date === "string" && isRealIsoDate(settings.wedding_date))
      ? settings.wedding_date
      : undefined;
  const venue = settings.venue === null || typeof settings.venue === "string"
    ? settings.venue
    : undefined;
  const totalBudget =
    settings.total_budget === null ||
    (typeof settings.total_budget === "number" &&
      Number.isSafeInteger(settings.total_budget) &&
      settings.total_budget >= 0 &&
      settings.total_budget <= MAX_EXISTING_BUDGET_WON)
      ? settings.total_budget
      : undefined;

  if (
    !userId ||
    coupleId === undefined ||
    name === undefined ||
    communityNickname === undefined ||
    role === undefined ||
    weddingDate === undefined ||
    venue === undefined ||
    totalBudget === undefined ||
    typeof settings.care_notifications_enabled !== "boolean" ||
    !(
      settings.care_notifications_consented_at === null ||
      typeof settings.care_notifications_consented_at === "string"
    )
  ) {
    throw new Error("저장된 설정 형식이 올바르지 않아요.");
  }

  const snapshot: WeddingSettingsSnapshot = {
    userId,
    coupleId,
    name,
    communityNickname,
    role,
    weddingDate,
    venue,
    totalBudget,
  };
  const profile: WeddingSettingsProfile = {
    id: userId,
    name,
    role,
    couple_id: coupleId,
    care_notifications_enabled: settings.care_notifications_enabled,
    care_notifications_consented_at: settings.care_notifications_consented_at,
  };

  return {
    data: {
      userId,
      coupleId,
      nickname: name ?? "",
      communityNickname: communityNickname ?? "",
      role,
      weddingDate: weddingDate ?? "",
      venue: venue ?? "",
      totalBudget: totalBudget === null ? "" : String(totalBudget / 10_000),
    },
    snapshot,
    profile,
    careAvailability: input.careAvailability,
  };
}
