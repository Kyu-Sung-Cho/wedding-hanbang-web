import { NextResponse } from "next/server";

import {
  AMORA_PERSONALIZATION_FIELD_NAMES,
  isAmoraPersonalizationChanges,
  parseAmoraPersonalizationProfile,
  type AmoraPersonalizationPreferences,
  type AmoraPersonalizationProfile,
} from "@/lib/amora/personalization";
import { createClientFromRequest } from "@/lib/supabase/server";
import { checkRateLimit, rateLimitKey } from "@/utils/rateLimit";
import {
  isBodyTooLarge,
  isRecord,
  readBoundedUtf8Text,
} from "@/utils/requestValidation";
import { isTrustedMutationRequest } from "@/utils/trustedMutation";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const MAX_BODY_BYTES = 4 * 1024;
const MAX_READS_PER_MINUTE = 120;
const MAX_WRITES_PER_MINUTE = 30;
const MAX_STORED_REVISION = 9_007_199_254_740_991;
const PRIVATE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  Vary: "Origin, Sec-Fetch-Site, Authorization",
};
const ROW_SELECT = [
  "decision_start",
  "answer_detail",
  "support_order",
  "work_mode",
  "family_order",
  "tone_style",
  "confirmed_at",
  "revision",
  "updated_at",
].join(", ");
const PUT_KEYS = ["expectedRevision", "preferences"] as const;
const DELETE_KEYS = ["expectedRevision"] as const;
const EXPECTED_OWNER_FIELD = "expectedOwnerUserId";
const EXPECTED_OWNER_HEADER = "X-Amora-Expected-Owner";
const LEGACY_PERSONALIZATION_FIELD_NAMES = [
  "decisionStart",
  "answerDetail",
  "supportOrder",
  "workMode",
  "familyOrder",
] as const satisfies readonly (keyof AmoraPersonalizationPreferences)[];

type PersonalizationRow = {
  decision_start: string;
  answer_detail: string;
  support_order: string;
  work_mode: string;
  family_order: string;
  tone_style: string;
  confirmed_at: string;
  revision: number;
  updated_at: string;
};
type LegacyPersonalizationPreferences = Pick<
  AmoraPersonalizationPreferences,
  (typeof LEGACY_PERSONALIZATION_FIELD_NAMES)[number]
>;
type LegacyPersonalizationRow = Omit<PersonalizationRow, "tone_style">;

type RequestClient = Awaited<ReturnType<typeof createClientFromRequest>>;
type AuthContext = {
  userId: string;
  supabase: RequestClient;
};
type RpcError = {
  code?: unknown;
  message?: unknown;
  details?: unknown;
  hint?: unknown;
};

function response(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: PRIVATE_HEADERS });
}

function withPrivateHeaders(result: NextResponse): NextResponse {
  for (const [name, value] of Object.entries(PRIVATE_HEADERS)) {
    result.headers.set(name, value);
  }
  return result;
}

function hasOwn(record: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
): boolean {
  const allowedSet = new Set(allowed);
  return Object.keys(value).every((key) => allowedSet.has(key));
}

/** 화면의 계정과 요청 쿠키의 계정이 갈리면 다른 계정의 값도 읽어 돌려주지 않는다. */
function checkExpectedOwner(value: unknown, supplied: boolean, userId: string): NextResponse | null {
  if (!supplied) return null;
  if (typeof value !== "string" || !value.length || value.length > 128) {
    return response({ error: "설정을 확인할 계정 정보가 올바르지 않습니다." }, 400);
  }
  if (value !== userId) {
    return response({ code: "PERSONALIZATION_OWNER_MISMATCH",
      error: "로그인 계정이 바뀌었어요. 새로고침한 뒤 현재 계정을 확인해 주세요." }, 409);
  }
  return null;
}

function parseExpectedRevision(
  value: unknown,
  max: number,
): number | null | undefined {
  if (value === null) return null;
  if (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 1 &&
    value <= max
  ) {
    return value;
  }
  return undefined;
}

function isFullPreferences(
  value: unknown,
): value is AmoraPersonalizationPreferences {
  if (
    !isRecord(value) ||
    Object.keys(value).length !== AMORA_PERSONALIZATION_FIELD_NAMES.length ||
    !AMORA_PERSONALIZATION_FIELD_NAMES.every((field) => hasOwn(value, field))
  ) {
    return false;
  }
  return isAmoraPersonalizationChanges(value);
}

function isLegacyFullPreferences(
  value: unknown,
): value is LegacyPersonalizationPreferences {
  if (
    !isRecord(value) ||
    Object.keys(value).length !== LEGACY_PERSONALIZATION_FIELD_NAMES.length ||
    !LEGACY_PERSONALIZATION_FIELD_NAMES.every((field) => hasOwn(value, field))
  ) {
    return false;
  }
  return isAmoraPersonalizationChanges(value);
}

function rowToProfile(row: PersonalizationRow): AmoraPersonalizationProfile | null {
  return parseAmoraPersonalizationProfile({
    preferences: {
      decisionStart: row.decision_start,
      answerDetail: row.answer_detail,
      supportOrder: row.support_order,
      workMode: row.work_mode,
      familyOrder: row.family_order,
      toneStyle: row.tone_style,
    },
    revision: row.revision,
    confirmedAt: row.confirmed_at,
    updatedAt: row.updated_at,
  });
}

function normalizeRpcRow(value: unknown): PersonalizationRow | null {
  const candidate =
    Array.isArray(value) && value.length === 1 ? value[0] : value;
  if (!isRecord(candidate)) return null;

  const row: PersonalizationRow = {
    decision_start:
      typeof candidate.decision_start === "string"
        ? candidate.decision_start
        : "",
    answer_detail:
      typeof candidate.answer_detail === "string"
        ? candidate.answer_detail
        : "",
    support_order:
      typeof candidate.support_order === "string"
        ? candidate.support_order
        : "",
    work_mode:
      typeof candidate.work_mode === "string" ? candidate.work_mode : "",
    family_order:
      typeof candidate.family_order === "string" ? candidate.family_order : "",
    tone_style:
      typeof candidate.tone_style === "string" ? candidate.tone_style : "",
    confirmed_at:
      typeof candidate.confirmed_at === "string" ? candidate.confirmed_at : "",
    revision:
      typeof candidate.revision === "number" ? candidate.revision : Number.NaN,
    updated_at:
      typeof candidate.updated_at === "string" ? candidate.updated_at : "",
  };

  return rowToProfile(row) ? row : null;
}

function normalizeLegacyRpcRow(value: unknown): LegacyPersonalizationRow | null {
  const candidate =
    Array.isArray(value) && value.length === 1 ? value[0] : value;
  if (!isRecord(candidate)) return null;

  const row: LegacyPersonalizationRow = {
    decision_start:
      typeof candidate.decision_start === "string"
        ? candidate.decision_start
        : "",
    answer_detail:
      typeof candidate.answer_detail === "string"
        ? candidate.answer_detail
        : "",
    support_order:
      typeof candidate.support_order === "string"
        ? candidate.support_order
        : "",
    work_mode:
      typeof candidate.work_mode === "string" ? candidate.work_mode : "",
    family_order:
      typeof candidate.family_order === "string" ? candidate.family_order : "",
    confirmed_at:
      typeof candidate.confirmed_at === "string" ? candidate.confirmed_at : "",
    revision:
      typeof candidate.revision === "number" ? candidate.revision : Number.NaN,
    updated_at:
      typeof candidate.updated_at === "string" ? candidate.updated_at : "",
  };
  const preferences = {
    decisionStart: row.decision_start,
    answerDetail: row.answer_detail,
    supportOrder: row.support_order,
    workMode: row.work_mode,
    familyOrder: row.family_order,
  };

  return isLegacyFullPreferences(preferences) &&
    Number.isSafeInteger(row.revision) &&
    row.revision >= 1 &&
    row.revision <= MAX_STORED_REVISION &&
    row.confirmed_at.length > 0 &&
    row.updated_at.length > 0
    ? row
    : null;
}

function rpcErrorText(error: RpcError): string {
  return [
    typeof error.code === "string" ? error.code : "",
    typeof error.message === "string" ? error.message : "",
    typeof error.details === "string" ? error.details : "",
    typeof error.hint === "string" ? error.hint : "",
  ].join(" ");
}

function isRevisionConflict(error: RpcError): boolean {
  return (
    error.code === "40001" ||
    /AMORA_PERSONALIZATION_REVISION_CONFLICT/i.test(rpcErrorText(error))
  );
}

function isInvalidRpcInput(error: RpcError): boolean {
  return (
    error.code === "22023" ||
    /AMORA_PERSONALIZATION_INVALID_/i.test(rpcErrorText(error))
  );
}

async function readBody(
  request: Request,
): Promise<Record<string, unknown> | NextResponse> {
  if (isBodyTooLarge(request, MAX_BODY_BYTES)) {
    return response({ error: "요청 본문이 너무 큽니다." }, 413);
  }
  const bodyResult = await readBoundedUtf8Text(request, MAX_BODY_BYTES);
  if (!bodyResult.ok) {
    return response(
      {
        error:
          bodyResult.reason === "too_large"
            ? "요청 본문이 너무 큽니다."
            : "요청을 읽을 수 없습니다.",
      },
      bodyResult.reason === "too_large" ? 413 : 400,
    );
  }
  try {
    const parsed = JSON.parse(bodyResult.text) as unknown;
    if (isRecord(parsed)) return parsed;
  } catch {
    // Fall through to the bounded generic error.
  }
  return response({ error: "요청 형식이 올바르지 않습니다." }, 400);
}

async function authenticate(request: Request): Promise<
  | { ok: true; context: AuthContext }
  | { ok: false; response: NextResponse }
> {
  const supabase = await createClientFromRequest(request);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return {
      ok: false,
      response: response({ error: "인증이 필요합니다." }, 401),
    };
  }
  return {
    ok: true,
    context: { userId: user.id, supabase },
  };
}

async function readOwnProfile(
  supabase: RequestClient,
  userId: string,
): Promise<
  | { ok: true; profile: AmoraPersonalizationProfile | null }
  | { ok: false; response: NextResponse }
> {
  const { data, error } = await supabase
    .from("amora_personalization_preferences")
    .select(ROW_SELECT)
    .eq("owner_user_id", userId)
    .maybeSingle();
  if (error) {
    console.error("[amora-personalization] user read failed", {
      code: error.code,
    });
    return {
      ok: false,
      response: response({ error: "도움 방식을 불러오지 못했어요." }, 503),
    };
  }
  if (!data) return { ok: true, profile: null };

  const row = normalizeRpcRow(data);
  const profile = row ? rowToProfile(row) : null;
  if (!profile) {
    return {
      ok: false,
      response: response(
        { error: "저장된 도움 방식 형식이 올바르지 않습니다." },
        503,
      ),
    };
  }
  return { ok: true, profile };
}

function checkRate(
  scope: string,
  request: Request,
  userId: string,
  maxRequests: number,
): NextResponse | null {
  const limited = checkRateLimit(rateLimitKey(scope, request, userId), {
    maxRequests,
    windowMs: 60 * 1000,
  });
  return limited ? withPrivateHeaders(limited) : null;
}

function checkMutationRequest(
  request: Request,
  userId: string,
): NextResponse | null {
  if (!isTrustedMutationRequest(request)) {
    return response({ error: "잘못된 요청 출처입니다." }, 403);
  }
  return checkRate(
    "amora-personalization:write",
    request,
    userId,
    MAX_WRITES_PER_MINUTE,
  );
}

async function conflictResponse(context: AuthContext) {
  const latest = await readOwnProfile(context.supabase, context.userId);
  return response(
    {
      error: "다른 화면에서 도움 방식이 바뀌었어요. 새 값을 확인해 주세요.",
      code: "PERSONALIZATION_REVISION_CONFLICT",
      current: latest.ok ? latest.profile : null,
    },
    409,
  );
}

export async function GET(request: Request) {
  try {
    const auth = await authenticate(request);
    if (!auth.ok) return auth.response;

    const ownerError = checkExpectedOwner(request.headers.get(EXPECTED_OWNER_HEADER), request.headers.has(EXPECTED_OWNER_HEADER), auth.context.userId);
    if (ownerError) return ownerError;

    const limited = checkRate(
      "amora-personalization:read",
      request,
      auth.context.userId,
      MAX_READS_PER_MINUTE,
    );
    if (limited) return limited;

    const result = await readOwnProfile(
      auth.context.supabase,
      auth.context.userId,
    );
    return result.ok ? response({ profile: result.profile }) : result.response;
  } catch (error) {
    console.error("[amora-personalization] GET failed", error);
    return response({ error: "서버 오류" }, 500);
  }
}

export async function PUT(request: Request) {
  try {
    const auth = await authenticate(request);
    if (!auth.ok) return auth.response;
    const mutationError = checkMutationRequest(request, auth.context.userId);
    if (mutationError) return mutationError;

    const body = await readBody(request);
    if (body instanceof NextResponse) return body;
    if (
      !hasOnlyKeys(body, [...PUT_KEYS, EXPECTED_OWNER_FIELD]) ||
      !PUT_KEYS.every((key) => hasOwn(body, key))
    ) {
      return response({ error: "허용되지 않은 설정 항목이 있습니다." }, 400);
    }
    const ownerError = checkExpectedOwner(body[EXPECTED_OWNER_FIELD], hasOwn(body, EXPECTED_OWNER_FIELD), auth.context.userId);
    if (ownerError) return ownerError;

    const expectedRevision = parseExpectedRevision(
      body.expectedRevision,
      MAX_STORED_REVISION,
    );
    if (expectedRevision === undefined) {
      return response({ error: "도움 방식 설정값이 올바르지 않습니다." }, 400);
    }

    let legacyWrite = false;
    let writeResult;
    if (isLegacyFullPreferences(body.preferences)) {
      legacyWrite = true;
      const preferences = body.preferences;
      writeResult = await auth.context.supabase.rpc(
        "set_own_amora_personalization_preferences",
        {
          p_expected_revision: expectedRevision,
          p_decision_start: preferences.decisionStart,
          p_answer_detail: preferences.answerDetail,
          p_support_order: preferences.supportOrder,
          p_work_mode: preferences.workMode,
          p_family_order: preferences.familyOrder,
        },
      );
    } else if (isFullPreferences(body.preferences)) {
      const preferences = body.preferences;
      writeResult = await auth.context.supabase.rpc(
        "set_own_amora_personalization_preferences_v2",
        {
          p_expected_revision: expectedRevision,
          p_decision_start: preferences.decisionStart,
          p_answer_detail: preferences.answerDetail,
          p_support_order: preferences.supportOrder,
          p_work_mode: preferences.workMode,
          p_family_order: preferences.familyOrder,
          p_tone_style: preferences.toneStyle,
        },
      );
    } else {
      return response({ error: "도움 방식 설정값이 올바르지 않습니다." }, 400);
    }
    const { data, error } = writeResult;

    if (error) {
      if (isRevisionConflict(error)) return conflictResponse(auth.context);
      if (isInvalidRpcInput(error)) {
        return response({ error: "도움 방식 설정값이 올바르지 않습니다." }, 400);
      }
      if (/AMORA_PERSONALIZATION_AUTH_REQUIRED/i.test(rpcErrorText(error))) {
        return response({ error: "인증이 필요합니다." }, 401);
      }
      if (/AMORA_PERSONALIZATION_PROFILE_REQUIRED/i.test(rpcErrorText(error))) {
        return response(
          {
            error: "프로필을 먼저 완료해 주세요.",
            code: "PERSONALIZATION_PROFILE_REQUIRED",
          },
          409,
        );
      }
      console.error("[amora-personalization] set RPC failed", {
        code: error.code,
      });
      return response({ error: "도움 방식을 저장하지 못했어요." }, 503);
    }

    if (legacyWrite) {
      const legacyRow = normalizeLegacyRpcRow(data);
      if (!legacyRow) {
        return response({ error: "저장 결과를 확인하지 못했어요." }, 503);
      }
      const stored = await readOwnProfile(
        auth.context.supabase,
        auth.context.userId,
      );
      if (!stored.ok) return stored.response;
      if (
        !stored.profile ||
        stored.profile.revision < legacyRow.revision
      ) {
        return response({ error: "저장 결과를 확인하지 못했어요." }, 503);
      }
      return response({ profile: stored.profile });
    }

    const row = normalizeRpcRow(data);
    const profile = row ? rowToProfile(row) : null;
    if (!profile) {
      return response({ error: "저장 결과를 확인하지 못했어요." }, 503);
    }
    return response({ profile });
  } catch (error) {
    console.error("[amora-personalization] PUT failed", error);
    return response({ error: "서버 오류" }, 500);
  }
}

export async function DELETE(request: Request) {
  try {
    const auth = await authenticate(request);
    if (!auth.ok) return auth.response;
    const mutationError = checkMutationRequest(request, auth.context.userId);
    if (mutationError) return mutationError;

    const body = await readBody(request);
    if (body instanceof NextResponse) return body;
    if (
      !hasOnlyKeys(body, [...DELETE_KEYS, EXPECTED_OWNER_FIELD]) ||
      !DELETE_KEYS.every((key) => hasOwn(body, key))
    ) {
      return response({ error: "허용되지 않은 삭제 항목이 있습니다." }, 400);
    }
    const ownerError = checkExpectedOwner(body[EXPECTED_OWNER_FIELD], hasOwn(body, EXPECTED_OWNER_FIELD), auth.context.userId);
    if (ownerError) return ownerError;
    const expectedRevision = parseExpectedRevision(
      body.expectedRevision,
      MAX_STORED_REVISION,
    );
    if (expectedRevision === undefined) {
      return response({ error: "삭제할 설정의 버전을 확인해 주세요." }, 400);
    }

    const { data, error } = await auth.context.supabase.rpc(
      "clear_own_amora_personalization_preferences",
      { p_expected_revision: expectedRevision },
    );
    if (error) {
      if (isRevisionConflict(error)) return conflictResponse(auth.context);
      if (isInvalidRpcInput(error)) {
        return response({ error: "삭제할 설정의 버전을 확인해 주세요." }, 400);
      }
      if (/AMORA_PERSONALIZATION_AUTH_REQUIRED/i.test(rpcErrorText(error))) {
        return response({ error: "인증이 필요합니다." }, 401);
      }
      console.error("[amora-personalization] clear RPC failed", {
        code: error.code,
      });
      return response({ error: "도움 방식을 초기화하지 못했어요." }, 503);
    }
    if (data !== true) {
      return response({ error: "초기화 결과를 확인하지 못했어요." }, 503);
    }

    return response({ deleted: true, profile: null });
  } catch (error) {
    console.error("[amora-personalization] DELETE failed", error);
    return response({ error: "서버 오류" }, 500);
  }
}

export const __private__ = {
  isFullPreferences,
  isLegacyFullPreferences,
  normalizeLegacyRpcRow,
  normalizeRpcRow,
  parseExpectedRevision,
  rowToProfile,
};
