import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClientFromRequest } from "@/lib/supabase/server";
import {
  isCommunityNicknameUniqueViolation,
  validateCommunityNickname,
} from "@/lib/community/nickname";
import { checkRateLimit, rateLimitKey } from "@/utils/rateLimit";
import {
  cleanOptionalIsoDate,
  isBodyTooLarge,
  isRecord,
  isUuid,
} from "@/utils/requestValidation";
import { MAX_WEDDING_BUDGET_WON } from "@/lib/weddingBudget";

const MAX_BODY_BYTES = 8 * 1024;
const MAX_BUDGET_WON = MAX_WEDDING_BUDGET_WON;
const MAX_EXISTING_BUDGET_WON = 1_000_000_000_000;
const PATCH_FIELDS = [
  "name",
  "community_nickname",
  "wedding_date",
  "venue",
  "total_budget",
] as const;
const PRIVATE_NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
};

type PatchField = (typeof PATCH_FIELDS)[number];
type PatchValue = string | number | null;
type AtomicPatchParams = {
  p_user_id: string;
  p_expected_couple_id: string | null;
  p_expected_couple_id_provided: true;
  p_name: string | null;
  p_name_provided: boolean;
  p_expected_name: string | null;
  p_community_nickname: string | null;
  p_community_nickname_provided: boolean;
  p_expected_community_nickname: string | null;
  p_wedding_date: string | null;
  p_wedding_date_provided: boolean;
  p_expected_wedding_date: string | null;
  p_venue: string | null;
  p_venue_provided: boolean;
  p_expected_venue: string | null;
  p_total_budget: number | null;
  p_total_budget_provided: boolean;
  p_expected_total_budget: number | null;
};

export const dynamic = "force-dynamic";
export const revalidate = 0;

function privateResponse(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: PRIVATE_NO_STORE_HEADERS,
  });
}

function careAvailabilityFor(user: { email_confirmed_at?: string | null }) {
  return {
    outboundEnabled: process.env.AMORA_CARE_OUTBOUND_ENABLED === "true",
    emailVerified:
      typeof user.email_confirmed_at === "string" &&
      user.email_confirmed_at.trim().length > 0,
  };
}

function hasOwn(record: object, key: string) {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function hasOnlyKeys(record: Record<string, unknown>, allowed: readonly string[]) {
  const allowedSet = new Set(allowed);
  return Object.keys(record).every((key) => allowedSet.has(key));
}

function hasControlCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 0x1f || codePoint === 0x7f;
  });
}

function normalizeSettingsResult(value: unknown, userId: string) {
  if (!isRecord(value) || value.user_id !== userId) return null;

  const coupleId = value.couple_id;
  const name = value.name;
  const communityNickname = value.community_nickname;
  const role = value.role;
  const weddingDate = value.wedding_date;
  const venue = value.venue;
  const totalBudget = value.total_budget;
  const consentAt = value.care_notifications_consented_at;

  if (
    !(
      coupleId === null ||
      (typeof coupleId === "string" && isUuid(coupleId))
    ) ||
    !(name === null || typeof name === "string") ||
    !(communityNickname === null || typeof communityNickname === "string") ||
    !(role === null || role === "bride" || role === "groom") ||
    !(
      weddingDate === null ||
      (typeof weddingDate === "string" && parseWeddingIsoDate(weddingDate) === weddingDate)
    ) ||
    !(venue === null || typeof venue === "string") ||
    !(
      totalBudget === null ||
      (typeof totalBudget === "number" &&
        Number.isSafeInteger(totalBudget) &&
        totalBudget >= 0 &&
        totalBudget <= MAX_EXISTING_BUDGET_WON)
    ) ||
    typeof value.care_notifications_enabled !== "boolean" ||
    !(consentAt === null || typeof consentAt === "string")
  ) {
    return null;
  }

  return {
    user_id: userId,
    couple_id: coupleId,
    name,
    community_nickname: communityNickname,
    role,
    wedding_date: weddingDate,
    venue,
    total_budget: totalBudget,
    care_notifications_enabled: value.care_notifications_enabled,
    care_notifications_consented_at: consentAt,
  };
}

function parseExpectedText(value: unknown): string | null | undefined {
  if (value === null || typeof value === "string") return value;
  return undefined;
}

function parseWeddingIsoDate(value: unknown): string | null | undefined {
  const parsed = cleanOptionalIsoDate(value);
  if (parsed === null) return null;
  if (parsed === undefined || parsed.startsWith("0000-")) return undefined;
  return parsed;
}

function parseExpectedDate(value: unknown): string | null | undefined {
  if (value === null) return null;
  const parsed = parseWeddingIsoDate(value);
  return parsed === value ? parsed : undefined;
}

function parseExpectedBudget(value: unknown): number | null | undefined {
  if (value === null) return null;
  return typeof value === "number" && Number.isSafeInteger(value)
    ? value
    : undefined;
}

function parsePatchBody(
  body: unknown,
  userId: string,
): { ok: true; params: AtomicPatchParams } | { ok: false; error: string } {
  if (
    !isRecord(body) ||
    !hasOnlyKeys(body, ["expected_couple_id", "changes", "expected"]) ||
    !hasOwn(body, "expected_couple_id") ||
    !isRecord(body.changes) ||
    !isRecord(body.expected)
  ) {
    return { ok: false, error: "설정 변경 요청 형식이 올바르지 않습니다." };
  }

  const expectedCoupleId = body.expected_couple_id;
  if (!(expectedCoupleId === null || isUuid(expectedCoupleId))) {
    return { ok: false, error: "커플 연결 기준값이 올바르지 않습니다." };
  }

  const changeKeys = Object.keys(body.changes);
  const expectedKeys = Object.keys(body.expected);
  if (
    changeKeys.length === 0 ||
    !hasOnlyKeys(body.changes, PATCH_FIELDS) ||
    !hasOnlyKeys(body.expected, PATCH_FIELDS) ||
    changeKeys.length !== expectedKeys.length ||
    !changeKeys.every((key) => hasOwn(body.expected as Record<string, unknown>, key))
  ) {
    return { ok: false, error: "변경 항목과 이전 값이 일치하지 않습니다." };
  }

  const changes = body.changes as Partial<Record<PatchField, unknown>>;
  const expected = body.expected as Partial<Record<PatchField, unknown>>;
  let name: string | null = null;
  let expectedName: string | null = null;
  let communityNickname: string | null = null;
  let expectedCommunityNickname: string | null = null;
  let weddingDate: string | null = null;
  let expectedWeddingDate: string | null = null;
  let venue: string | null = null;
  let expectedVenue: string | null = null;
  let totalBudget: number | null = null;
  let expectedTotalBudget: number | null = null;

  const nameProvided = hasOwn(changes, "name");
  if (nameProvided) {
    if (typeof changes.name !== "string") {
      return { ok: false, error: "이름 형식이 올바르지 않습니다." };
    }
    name = changes.name.trim();
    expectedName = parseExpectedText(expected.name) ?? null;
    if (
      name.length === 0 ||
      Array.from(name).length > 80 ||
      hasControlCharacter(name) ||
      parseExpectedText(expected.name) === undefined
    ) {
      return { ok: false, error: "이름 형식이 올바르지 않습니다." };
    }
  }

  const communityNicknameProvided = hasOwn(changes, "community_nickname");
  if (communityNicknameProvided) {
    const validation = validateCommunityNickname(changes.community_nickname);
    const parsedExpected = parseExpectedText(expected.community_nickname);
    if (!validation.ok) return { ok: false, error: validation.message };
    if (parsedExpected === undefined) {
      return { ok: false, error: "이전 커뮤니티 별명 형식이 올바르지 않습니다." };
    }
    communityNickname = validation.nickname;
    expectedCommunityNickname = parsedExpected;
  }

  const weddingDateProvided = hasOwn(changes, "wedding_date");
  if (weddingDateProvided) {
    const parsedDate = changes.wedding_date === null
      ? null
      : parseWeddingIsoDate(changes.wedding_date);
    const parsedExpected = parseExpectedDate(expected.wedding_date);
    if (
      parsedDate === undefined ||
      (changes.wedding_date !== null && parsedDate !== changes.wedding_date) ||
      parsedExpected === undefined
    ) {
      return { ok: false, error: "결혼 날짜는 YYYY-MM-DD 형식의 실제 날짜여야 합니다." };
    }
    weddingDate = parsedDate;
    expectedWeddingDate = parsedExpected;
  }

  const venueProvided = hasOwn(changes, "venue");
  if (venueProvided) {
    if (!(changes.venue === null || typeof changes.venue === "string")) {
      return { ok: false, error: "예식장 형식이 올바르지 않습니다." };
    }
    const parsedExpected = parseExpectedText(expected.venue);
    if (parsedExpected === undefined) {
      return { ok: false, error: "이전 예식장 형식이 올바르지 않습니다." };
    }
    const trimmed = typeof changes.venue === "string" ? changes.venue.trim() : "";
    venue = trimmed.length === 0 ? null : trimmed;
    expectedVenue = parsedExpected;
    if (
      venue !== null &&
      (Array.from(venue).length > 120 || hasControlCharacter(venue))
    ) {
      return { ok: false, error: "예식장은 120자 이내로 입력해주세요." };
    }
  }

  const totalBudgetProvided = hasOwn(changes, "total_budget");
  if (totalBudgetProvided) {
    const candidate = changes.total_budget;
    const parsedExpected = parseExpectedBudget(expected.total_budget);
    if (
      !(candidate === null ||
        (typeof candidate === "number" &&
          Number.isSafeInteger(candidate) &&
          candidate >= 0 &&
          candidate <= MAX_BUDGET_WON)) ||
      parsedExpected === undefined
    ) {
      return { ok: false, error: "예산은 0원 이상 10억 원 이하의 정수여야 합니다." };
    }
    totalBudget = candidate;
    expectedTotalBudget = parsedExpected;
  }

  const normalizedChanges: PatchValue[] = [
    ...(nameProvided ? [name] : []),
    ...(communityNicknameProvided ? [communityNickname] : []),
    ...(weddingDateProvided ? [weddingDate] : []),
    ...(venueProvided ? [venue] : []),
    ...(totalBudgetProvided ? [totalBudget] : []),
  ];
  const normalizedExpected: PatchValue[] = [
    ...(nameProvided ? [expectedName] : []),
    ...(communityNicknameProvided ? [expectedCommunityNickname] : []),
    ...(weddingDateProvided ? [expectedWeddingDate] : []),
    ...(venueProvided ? [expectedVenue] : []),
    ...(totalBudgetProvided ? [expectedTotalBudget] : []),
  ];
  if (normalizedChanges.some((value, index) => value === normalizedExpected[index])) {
    return { ok: false, error: "변경되지 않은 항목은 요청에서 제외해야 합니다." };
  }

  return {
    ok: true,
    params: {
      p_user_id: userId,
      p_expected_couple_id: expectedCoupleId,
      p_expected_couple_id_provided: true,
      p_name: name,
      p_name_provided: nameProvided,
      p_expected_name: expectedName,
      p_community_nickname: communityNickname,
      p_community_nickname_provided: communityNicknameProvided,
      p_expected_community_nickname: expectedCommunityNickname,
      p_wedding_date: weddingDate,
      p_wedding_date_provided: weddingDateProvided,
      p_expected_wedding_date: expectedWeddingDate,
      p_venue: venue,
      p_venue_provided: venueProvided,
      p_expected_venue: expectedVenue,
      p_total_budget: totalBudget,
      p_total_budget_provided: totalBudgetProvided,
      p_expected_total_budget: expectedTotalBudget,
    },
  };
}

async function authenticatedUser(request: Request) {
  const supabase = await createClientFromRequest(request);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

export async function GET(request: Request) {
  try {
    const user = await authenticatedUser(request);
    if (!user) return privateResponse({ error: "인증이 필요합니다." }, 401);

    const limited = checkRateLimit(
      rateLimitKey("wedding-settings:read", request, user.id),
      { maxRequests: 60, windowMs: 60 * 1000 },
    );
    if (limited) {
      limited.headers.set("Cache-Control", PRIVATE_NO_STORE_HEADERS["Cache-Control"]);
      return limited;
    }

    const { data, error } = await createAdminClient().rpc(
      "get_wedding_settings_snapshot",
      { p_user_id: user.id },
    );
    if (error) {
      console.error("Wedding settings snapshot failed:", error);
      return privateResponse({ error: "설정을 불러오지 못했습니다." }, 500);
    }

    const settings = normalizeSettingsResult(data, user.id);
    if (!settings) {
      console.error("Wedding settings snapshot returned an invalid record.");
      return privateResponse({ error: "설정을 불러오지 못했습니다." }, 500);
    }
    return privateResponse({ settings, careAvailability: careAvailabilityFor(user) });
  } catch (error) {
    console.error("Wedding settings read API error:", error);
    return privateResponse({ error: "서버 오류" }, 500);
  }
}

export async function PATCH(request: Request) {
  try {
    if (isBodyTooLarge(request, MAX_BODY_BYTES)) {
      return privateResponse({ error: "요청 데이터가 너무 큽니다." }, 413);
    }

    const user = await authenticatedUser(request);
    if (!user) return privateResponse({ error: "인증이 필요합니다." }, 401);

    const limited = checkRateLimit(
      rateLimitKey("wedding-settings:update", request, user.id),
      { maxRequests: 20, windowMs: 60 * 1000 },
    );
    if (limited) {
      limited.headers.set("Cache-Control", PRIVATE_NO_STORE_HEADERS["Cache-Control"]);
      return limited;
    }

    const rawBody = await request.text();
    if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) {
      return privateResponse({ error: "요청 데이터가 너무 큽니다." }, 413);
    }

    let body: unknown;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return privateResponse({ error: "잘못된 JSON 요청입니다." }, 400);
    }
    const parsed = parsePatchBody(body, user.id);
    if (!parsed.ok) return privateResponse({ error: parsed.error }, 400);

    const { data, error } = await createAdminClient().rpc(
      "patch_wedding_settings_atomic",
      parsed.params,
    );
    if (error) {
      const errorText = isRecord(error)
        ? `${String(error.message ?? "")} ${String(error.details ?? "")}`
        : String(error);

      if (isCommunityNicknameUniqueViolation(error)) {
        return privateResponse({ error: "이미 사용 중인 닉네임입니다." }, 409);
      }
      if (/WEDDING_SETTINGS_(?:CONFLICT|COUPLE_CHANGED)/i.test(errorText)) {
        return privateResponse({
          error: "다른 기기에서 설정이 바뀌었어요. 다시 불러온 뒤 변경해주세요.",
          code: "SETTINGS_CHANGED",
        }, 409);
      }
      if (/WEDDING_SETTINGS_(?:JOURNEY_REQUIRED|JOURNEY_NOT_FOUND)/i.test(errorText)) {
        return privateResponse({
          error: "커플 연결 정보가 바뀌었어요. 설정을 다시 불러와주세요.",
          code: "SETTINGS_CHANGED",
        }, 409);
      }
      if (/WEDDING_SETTINGS_PROFILE_NOT_FOUND/i.test(errorText)) {
        return privateResponse({ error: "프로필을 찾을 수 없습니다." }, 404);
      }
      if (/WEDDING_SETTINGS_INVALID/i.test(errorText)) {
        return privateResponse({ error: "설정 변경 요청이 올바르지 않습니다." }, 400);
      }

      console.error("Atomic wedding settings patch failed:", error);
      return privateResponse({ error: "설정을 저장하지 못했습니다." }, 500);
    }

    const settings = normalizeSettingsResult(data, user.id);
    if (!settings) {
      console.error("Atomic wedding settings patch returned an invalid record.");
      return privateResponse({ error: "저장된 설정을 확인하지 못했습니다." }, 500);
    }
    return privateResponse({ settings, careAvailability: careAvailabilityFor(user) });
  } catch (error) {
    console.error("Wedding settings patch API error:", error);
    return privateResponse({ error: "서버 오류" }, 500);
  }
}
