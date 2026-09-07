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

/**
 * 결혼 예정일·식장·총 예산은 `wedding_journeys` 에 직접 쓸 수 없다.
 *
 * `20260731123000_couple_plan_change_write_boundary.sql` 이 그 테이블에 트리거를 걸어,
 * 계획 변경 세션 맥락 없이 들어온 UPDATE 를 `COUPLE_PLAN_CHANGE_APPROVAL_REQUIRED`(42501)
 * 로 거절한다. 그런데 설정 저장이 쓰는 `patch_wedding_settings_atomic` 은 그 경계가
 * 생기기 전에 만들어졌고 이후 갱신되지 않았다 — 여전히 `UPDATE public.wedding_journeys`
 * 를 직접 한다. 그래서 이 세 필드는 파트너 유무와 관계없이 **항상** 저장에 실패했다.
 *
 * 웹 설정은 이 셋만 `/api/journey`(→ `submit_couple_plan_change`)로 따로 보내서 살아
 * 있었고, 모바일만 여섯 필드를 옛 경로로 한꺼번에 보내고 있었다. 그래서 앱에서는
 * 온보딩을 지난 뒤 결혼식 날짜와 식장을 바꿀 방법이 아예 없었다.
 *
 * 빌더는 그대로 두고 보내기 직전에 가른다 — 빌더가 만드는 값 자체는 옳고, 틀린 것은
 * 목적지뿐이다.
 */
const PLAN_CHANGE_KEYS = ["wedding_date", "venue", "total_budget"] as const;

/** 최신 버전은 편집을 시작했던 사용자·커플의 응답일 때만 사용할 수 있다. */
export function buildWeddingPlanChangeBody(
  snapshot: WeddingSettingsSnapshot,
  changes: Record<string, string | number | null>,
  current: unknown,
): Record<string, string | number | null> {
  if (
    !snapshot.coupleId || !isRecord(current) || !isRecord(current.profile) ||
    current.profile.id !== snapshot.userId || current.profile.couple_id !== snapshot.coupleId ||
    !isRecord(current.journey) || current.journey.couple_id !== snapshot.coupleId
  ) {
    throw new Error("커플 연결 상태가 바뀌었어요. 설정을 다시 불러와주세요.");
  }
  const journey = current.journey;
  const revision = journey.state_revision;
  if (typeof revision !== "number" || !Number.isSafeInteger(revision) || revision < 0 || revision >= Number.MAX_SAFE_INTEGER) {
    throw new Error("결혼 정보를 불러오지 못했어요. 설정을 다시 불러와주세요.");
  }
  const baseline: Record<string, string | number | null> = {
    wedding_date: snapshot.weddingDate,
    venue: snapshot.venue,
    total_budget: snapshot.totalBudget,
  };
  const fields = Object.keys(changes);
  if (fields.length === 0 || fields.some((field) =>
    !Object.prototype.hasOwnProperty.call(baseline, field) || baseline[field] === undefined ||
    !Object.prototype.hasOwnProperty.call(journey, field) || journey[field] !== baseline[field]
  )) {
    throw new Error("그 사이 결혼 정보가 바뀌었어요. 설정을 다시 불러온 뒤 변경해 주세요.");
  }
  return { ...changes, expected_couple_id: snapshot.coupleId, expected_revision: revision };
}

/** 서버가 적용을 확인한 계획 필드만 갱신한다. 실패한 프로필 필드의 기준은 남긴다. */
export function advanceWeddingPlanBaseline(
  snapshot: WeddingSettingsSnapshot,
  changes: Record<string, string | number | null>,
): WeddingSettingsSnapshot {
  const next = { ...snapshot };
  if ("wedding_date" in changes) {
    if (changes.wedding_date !== null && typeof changes.wedding_date !== "string") throw new Error("잘못된 결혼 날짜 변경입니다.");
    next.weddingDate = changes.wedding_date;
  }
  if ("venue" in changes) {
    if (changes.venue !== null && typeof changes.venue !== "string") throw new Error("잘못된 결혼식장 변경입니다.");
    next.venue = changes.venue;
  }
  if ("total_budget" in changes) {
    if (changes.total_budget !== null && typeof changes.total_budget !== "number") throw new Error("잘못된 예산 변경입니다.");
    next.totalBudget = changes.total_budget;
  }
  return next;
}

/** 서버 응답을 기다리는 동안 추가로 편집한 필드는 저장된 값으로 덮어쓰지 않는다. */
export function mergeWeddingSettingsDraftAfterSave(
  current: WeddingSettingsData | null,
  submitted: WeddingSettingsData,
  saved: WeddingSettingsData,
): WeddingSettingsData | null {
  if (!current || current.userId !== submitted.userId || current.coupleId !== submitted.coupleId ||
    saved.userId !== submitted.userId || saved.coupleId !== submitted.coupleId) return current;
  return {
    ...saved,
    nickname: current.nickname === submitted.nickname ? saved.nickname : current.nickname,
    communityNickname: current.communityNickname === submitted.communityNickname ? saved.communityNickname : current.communityNickname,
    weddingDate: current.weddingDate === submitted.weddingDate ? saved.weddingDate : current.weddingDate,
    venue: current.venue === submitted.venue ? saved.venue : current.venue,
    totalBudget: current.totalBudget === submitted.totalBudget ? saved.totalBudget : current.totalBudget,
  };
}

export function isWeddingSettingsDraftUnchanged(current: WeddingSettingsData | null, submitted: WeddingSettingsData): boolean {
  return current !== null && current.userId === submitted.userId && current.coupleId === submitted.coupleId &&
    current.nickname === submitted.nickname && current.communityNickname === submitted.communityNickname &&
    current.weddingDate === submitted.weddingDate && current.venue === submitted.venue && current.totalBudget === submitted.totalBudget;
}

export interface SplitWeddingSettingsPatch {
  /** `/api/settings/wedding-profile` 로 보낼 나머지. 바뀐 게 없으면 null. */
  profilePatch: WeddingSettingsPatchBody | null;
  /** `/api/journey` 로 보낼 계획 변경. 바뀐 게 없으면 null. */
  planChanges: Record<string, string | number | null> | null;
}

export function splitWeddingSettingsPatch(
  patch: WeddingSettingsPatchBody,
): SplitWeddingSettingsPatch {
  const profileChanges: WeddingSettingsPatchBody["changes"] = {};
  const profileExpected: WeddingSettingsPatchBody["expected"] = {};
  const planChanges: Record<string, string | number | null> = {};

  for (const [key, value] of Object.entries(patch.changes)) {
    if ((PLAN_CHANGE_KEYS as readonly string[]).includes(key)) {
      planChanges[key] = value;
      continue;
    }
    profileChanges[key] = value;
    if (key in patch.expected) profileExpected[key] = patch.expected[key];
  }

  return {
    profilePatch: Object.keys(profileChanges).length > 0
      ? {
          expected_couple_id: patch.expected_couple_id,
          changes: profileChanges,
          expected: profileExpected,
        }
      : null,
    planChanges: Object.keys(planChanges).length > 0 ? planChanges : null,
  };
}
