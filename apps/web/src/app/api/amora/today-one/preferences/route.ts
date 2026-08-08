import { NextResponse } from "next/server";

import { isAmoraTodayOneEnabled } from "@/lib/features/amoraCareFlags";
import { createClientFromRequest } from "@/lib/supabase/server";
import { checkRateLimit, rateLimitKey } from "@/utils/rateLimit";
import { isRecord, isUuid, readBoundedUtf8Text } from "@/utils/requestValidation";
import { isTrustedMutationRequest } from "@/utils/trustedMutation";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const PRIVATE_NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  Vary: "Origin, Sec-Fetch-Site, Authorization",
};
const MAX_BODY_BYTES = 512;
const MAX_READS_PER_MINUTE = 60;
const MAX_WRITES_PER_MINUTE = 20;
const PAUSE_MS = 24 * 60 * 60 * 1000;
const MODES = ["enable", "disable", "pause_24h"] as const;

type PreferenceMode = (typeof MODES)[number];
type RequestClient = Awaited<ReturnType<typeof createClientFromRequest>>;
type AuthContext = {
  supabase: RequestClient;
  userId: string;
};
export type TodayOnePreference = {
  enabled: boolean;
  optedInAt: string | null;
  pausedUntil: string | null;
  dailyLimit: 1;
};
type RpcError = {
  code?: unknown;
  message?: unknown;
  details?: unknown;
  hint?: unknown;
};

const DEFAULT_PREFERENCE: TodayOnePreference = {
  enabled: false,
  optedInAt: null,
  pausedUntil: null,
  dailyLimit: 1,
};

function response(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: PRIVATE_NO_STORE_HEADERS,
  });
}

function unavailableResponse() {
  return response({ available: false });
}

function withPrivateHeaders(result: NextResponse) {
  for (const [name, value] of Object.entries(PRIVATE_NO_STORE_HEADERS)) {
    result.headers.set(name, value);
  }
  return result;
}

function isIsoTimestamp(value: unknown): value is string {
  return typeof value === "string"
    && value.length <= 40
    && Number.isFinite(Date.parse(value));
}

function validPreference(value: TodayOnePreference) {
  return value.enabled === (value.optedInAt !== null)
    && (value.pausedUntil === null || value.enabled);
}

function parseStoredPreference(value: unknown): TodayOnePreference | null {
  if (
    !isRecord(value)
    || typeof value.enabled !== "boolean"
    || !(value.opted_in_at === null || isIsoTimestamp(value.opted_in_at))
    || !(value.paused_until === null || isIsoTimestamp(value.paused_until))
    || value.daily_limit !== 1
  ) {
    return null;
  }
  const parsed: TodayOnePreference = {
    enabled: value.enabled,
    optedInAt: value.opted_in_at,
    pausedUntil: value.paused_until,
    dailyLimit: 1,
  };
  return validPreference(parsed) ? parsed : null;
}

function parseRpcPreference(value: unknown): TodayOnePreference | null {
  const candidate = Array.isArray(value) && value.length === 1 ? value[0] : value;
  if (
    !isRecord(candidate)
    || typeof candidate.enabled !== "boolean"
    || !(candidate.optedInAt === null || isIsoTimestamp(candidate.optedInAt))
    || !(candidate.pausedUntil === null || isIsoTimestamp(candidate.pausedUntil))
    || candidate.dailyLimit !== 1
  ) {
    return null;
  }
  const parsed: TodayOnePreference = {
    enabled: candidate.enabled,
    optedInAt: candidate.optedInAt,
    pausedUntil: candidate.pausedUntil,
    dailyLimit: 1,
  };
  return validPreference(parsed) ? parsed : null;
}

async function authenticate(
  request: Request,
): Promise<{ ok: true; value: AuthContext } | { ok: false; response: NextResponse }> {
  const supabase = await createClientFromRequest(request);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !isUuid(user.id)) {
    return {
      ok: false,
      response: response({ error: "인증이 필요합니다.", code: "TODAY_ONE_AUTH_REQUIRED" }, 401),
    };
  }
  return { ok: true, value: { supabase, userId: user.id } };
}

async function validateRoster(
  context: AuthContext,
): Promise<NextResponse | null> {
  const { data: profile, error: profileError } = await context.supabase
    .from("profiles")
    .select("couple_id, role")
    .eq("id", context.userId)
    .single();
  if (profileError) {
    console.error("[today-one-preferences] profile read failed", {
      code: profileError.code,
    });
    return response({ error: "커플 정보를 확인하지 못했어요." }, 503);
  }
  if (!isUuid(profile?.couple_id)) {
    return response(
      { error: "커플 연결을 완료한 뒤 설정할 수 있어요.", code: "TODAY_ONE_COUPLE_REQUIRED" },
      409,
    );
  }
  const { data: couple, error: coupleError } = await context.supabase
    .from("couples")
    .select("bride_id, groom_id")
    .eq("id", profile.couple_id)
    .single();
  if (coupleError) {
    console.error("[today-one-preferences] couple read failed", {
      code: coupleError.code,
    });
    return response({ error: "커플 정보를 확인하지 못했어요." }, 503);
  }
  if (
    !(
      (profile.role === "bride" && couple?.bride_id === context.userId)
      || (profile.role === "groom" && couple?.groom_id === context.userId)
    )
  ) {
    return response(
      {
        error: "커플 연결 상태가 바뀌었어요. 새로고침한 뒤 다시 확인해 주세요.",
        code: "TODAY_ONE_ROSTER_CHANGED",
      },
      403,
    );
  }
  return null;
}

async function readPreference(
  context: AuthContext,
): Promise<TodayOnePreference | null | NextResponse> {
  const { data, error } = await context.supabase
    .from("amora_today_one_preferences")
    .select("enabled, opted_in_at, paused_until, daily_limit")
    .eq("user_id", context.userId)
    .maybeSingle();
  if (error) {
    console.error("[today-one-preferences] preference read failed", {
      code: error.code,
    });
    return response({ error: "오늘의 한 가지 설정을 불러오지 못했어요." }, 503);
  }
  if (!data) return null;
  return parseStoredPreference(data)
    ?? response({ error: "저장된 오늘의 한 가지 설정을 확인하지 못했어요." }, 503);
}

function checkRate(
  scope: string,
  request: Request,
  userId: string,
  maxRequests: number,
) {
  const limited = checkRateLimit(rateLimitKey(scope, request, userId), {
    maxRequests,
    windowMs: 60 * 1000,
  });
  return limited ? withPrivateHeaders(limited) : null;
}

async function readMode(request: Request): Promise<PreferenceMode | NextResponse> {
  const body = await readBoundedUtf8Text(request, MAX_BODY_BYTES);
  if (!body.ok) {
    return response(
      {
        error: body.reason === "too_large"
          ? "요청 데이터가 너무 큽니다."
          : "요청 데이터를 읽지 못했습니다.",
      },
      body.reason === "too_large" ? 413 : 400,
    );
  }
  try {
    const parsed = JSON.parse(body.text) as unknown;
    if (
      isRecord(parsed)
      && Object.keys(parsed).length === 1
      && MODES.includes(parsed.mode as PreferenceMode)
    ) {
      return parsed.mode as PreferenceMode;
    }
  } catch {
    // Fall through to the bounded generic error.
  }
  return response({ error: "설정 동작이 올바르지 않습니다." }, 400);
}

function rpcErrorText(error: RpcError) {
  return [error.code, error.message, error.details, error.hint]
    .filter((value): value is string => typeof value === "string")
    .join(" ");
}

export async function GET(request: Request) {
  try {
    const auth = await authenticate(request);
    if (!auth.ok) return auth.response;
    if (!isAmoraTodayOneEnabled()) return unavailableResponse();
    const limited = checkRate(
      "amora-today-one-preferences:read",
      request,
      auth.value.userId,
      MAX_READS_PER_MINUTE,
    );
    if (limited) return limited;
    const rosterError = await validateRoster(auth.value);
    if (rosterError) return rosterError;
    const preference = await readPreference(auth.value);
    if (preference instanceof NextResponse) return preference;
    return response({
      available: true,
      preference: preference ?? DEFAULT_PREFERENCE,
    });
  } catch (error) {
    console.error("[today-one-preferences] GET failed", error);
    return response({ error: "오늘의 한 가지 설정을 불러오지 못했어요." }, 500);
  }
}

export async function PUT(request: Request) {
  try {
    if (!isTrustedMutationRequest(request)) {
      return response({ error: "잘못된 요청 출처입니다." }, 403);
    }
    const mode = await readMode(request);
    if (mode instanceof NextResponse) return mode;
    const auth = await authenticate(request);
    if (!auth.ok) return auth.response;
    if (!isAmoraTodayOneEnabled()) return unavailableResponse();
    const limited = checkRate(
      "amora-today-one-preferences:write",
      request,
      auth.value.userId,
      MAX_WRITES_PER_MINUTE,
    );
    if (limited) return limited;
    const rosterError = await validateRoster(auth.value);
    if (rosterError) return rosterError;

    if (mode === "pause_24h") {
      const current = await readPreference(auth.value);
      if (current instanceof NextResponse) return current;
      if (!current?.enabled || !current.optedInAt) {
        return response(
          {
            error: "오늘의 한 가지를 먼저 켠 뒤 잠시 쉴 수 있어요.",
            code: "TODAY_ONE_NOT_ENABLED",
          },
          409,
        );
      }
    }

    const enabled = mode !== "disable";
    const pausedUntil = mode === "pause_24h"
      ? new Date(Date.now() + PAUSE_MS).toISOString()
      : null;
    const { data, error } = await auth.value.supabase.rpc(
      "set_amora_today_one_preference",
      {
        p_enabled: enabled,
        p_paused_until: pausedUntil,
      },
    );
    if (error) {
      const text = rpcErrorText(error);
      if (/AMORA_TODAY_ONE_AUTH_REQUIRED/i.test(text)) {
        return response({ error: "인증이 필요합니다." }, 401);
      }
      if (/AMORA_TODAY_ONE_PREFERENCE_INVALID/i.test(text) || error.code === "22023") {
        return response({ error: "설정 동작이 올바르지 않습니다." }, 400);
      }
      console.error("[today-one-preferences] preference RPC failed", {
        code: typeof error.code === "string" ? error.code : "unknown",
      });
      return response(
        { error: "오늘의 한 가지 설정을 저장하지 못했어요. 기존 설정은 그대로예요." },
        503,
      );
    }
    const preference = parseRpcPreference(data);
    if (!preference) {
      return response({ error: "설정이 저장됐는지 확인하지 못했어요." }, 503);
    }
    return response({ available: true, preference });
  } catch (error) {
    console.error("[today-one-preferences] PUT failed", error);
    return response(
      { error: "오늘의 한 가지 설정을 저장하지 못했어요. 기존 설정은 그대로예요." },
      500,
    );
  }
}
