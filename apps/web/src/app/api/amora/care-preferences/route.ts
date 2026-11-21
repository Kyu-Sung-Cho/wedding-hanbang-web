import { NextResponse } from "next/server";

import {
  buildCarePreferencePayload,
  isCadenceUpdate,
  parseCarePreferenceUpdate,
  readCareCadence,
  readCareChannels,
  readCoupleCareCadence,
  soloCoupleCadence,
  type CareConsentRow,
  type CarePreferencePayload,
  type CarePreferenceUpdate,
  type CoupleCareCadence,
} from "@/lib/care/carePreferences";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClientFromRequest } from "@/lib/supabase/server";
import { checkRateLimit, rateLimitKey } from "@/utils/rateLimit";
import { isRecord, readBoundedUtf8Text } from "@/utils/requestValidation";
import { isTrustedMutationRequest } from "@/utils/trustedMutation";

// "아모라가 먼저 알려 주기" 설정(10장 P1). 웹 설정, 앱 설정, 라운지의 한 번 묻는 카드가
// 이 한 계약만 쓴다. 동의는 사람별이고, 함께 대화 글은 두 사람이 모두 켜야 온다.

export const dynamic = "force-dynamic";
export const revalidate = 0;

const PRIVATE_NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  Vary: "Origin, Sec-Fetch-Site, Authorization",
};
const MAX_BODY_BYTES = 512;
const MAX_READS_PER_MINUTE = 60;
const MAX_WRITES_PER_MINUTE = 20;
const CONSENT_COLUMNS =
  "couple_id, care_notifications_enabled, care_notifications_consented_at, care_email_enabled, care_email_consented_at, care_prompt_answered_at, care_intensity, care_window_start_hour, care_window_end_hour";
const PARTNER_COLUMNS = "care_notifications_enabled, care_notifications_consented_at";

type AuthUser = {
  id: string;
  email?: string | null;
  email_confirmed_at?: string | null;
};
type Admin = ReturnType<typeof createAdminClient>;
type ReadResult =
  | { ok: true; payload: CarePreferencePayload }
  | { ok: false; response: NextResponse };

function response(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: PRIVATE_NO_STORE_HEADERS });
}

function withPrivateHeaders(value: NextResponse) {
  for (const [name, header] of Object.entries(PRIVATE_NO_STORE_HEADERS)) {
    value.headers.set(name, header);
  }
  return value;
}

async function authenticate(request: Request): Promise<AuthUser | null> {
  const supabase = await createClientFromRequest(request);
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user?.id) return null;
  return data.user as AuthUser;
}

function emailConfirmed(user: AuthUser): boolean {
  return typeof user.email_confirmed_at === "string"
    && user.email_confirmed_at.trim().length > 0;
}

function rate(scope: string, request: Request, userId: string, maxRequests: number) {
  const limited = checkRateLimit(rateLimitKey(scope, request, userId), {
    maxRequests,
    windowMs: 60 * 1000,
  });
  return limited ? withPrivateHeaders(limited) : null;
}

async function readPartnerConsent(
  admin: Admin,
  coupleId: string,
  userId: string,
): Promise<{ ok: true; partner: CareConsentRow | null } | { ok: false }> {
  const { data: couple, error: coupleError } = await admin
    .from("couples")
    .select("bride_id, groom_id")
    .eq("id", coupleId)
    .maybeSingle();
  if (coupleError || !isRecord(couple)) return { ok: false };
  const members = [couple.bride_id, couple.groom_id].filter(
    (value): value is string => typeof value === "string",
  );
  // 프로필이 가리키는 커플에 본인이 없으면 상대 정보를 읽지 않는다.
  if (!members.includes(userId)) return { ok: false };
  const partnerId = members.find((member) => member !== userId) ?? null;
  if (!partnerId) return { ok: true, partner: null };

  const { data: partner, error: partnerError } = await admin
    .from("profiles")
    .select(PARTNER_COLUMNS)
    .eq("id", partnerId)
    .maybeSingle();
  if (partnerError) return { ok: false };
  return { ok: true, partner: isRecord(partner) ? partner : {} };
}

async function readPreference(user: AuthUser): Promise<ReadResult> {
  const admin = createAdminClient();
  const { data: own, error } = await admin
    .from("profiles")
    .select(CONSENT_COLUMNS)
    .eq("id", user.id)
    .maybeSingle();
  if (error || !isRecord(own)) {
    console.error("[care-preferences] profile read failed", {
      code: typeof error?.code === "string" ? error.code : "missing_profile",
    });
    return {
      ok: false,
      response: response({ error: "알림 설정을 불러오지 못했어요." }, 503),
    };
  }

  const cadence = readCareCadence(own);
  let partner: CareConsentRow | null = null;
  let couple: CoupleCareCadence = soloCoupleCadence(cadence);
  if (typeof own.couple_id === "string") {
    const partnerResult = await readPartnerConsent(admin, own.couple_id, user.id);
    // 10장 P2: 두 사람 설정을 합친 값은 DB 가 발송 때 쓰는 함수 그대로 읽는다.
    const { data: coupleCadence, error: cadenceError } = partnerResult.ok
      ? await admin.rpc("amora_care_couple_cadence", { p_couple_id: own.couple_id })
      : { data: null, error: null };
    const parsedCouple = readCoupleCareCadence(coupleCadence);
    if (!partnerResult.ok || cadenceError || !parsedCouple) {
      console.error("[care-preferences] couple read failed");
      return {
        ok: false,
        response: response({ error: "알림 설정을 불러오지 못했어요." }, 503),
      };
    }
    partner = partnerResult.partner;
    couple = parsedCouple;
  }

  return {
    ok: true,
    payload: buildCarePreferencePayload({
      channels: readCareChannels(),
      own,
      partner,
      emailConfirmed: emailConfirmed(user),
      email: user.email,
      cadence,
      couple,
    }),
  };
}

async function saveCadence(userId: string, update: CarePreferenceUpdate): Promise<NextResponse | null> {
  const { error } = await createAdminClient().rpc("set_amora_care_cadence", {
    p_user_id: userId,
    p_intensity: update.intensity ?? null,
    p_window_start_hour: update.windowStartHour ?? null,
    p_window_end_hour: update.windowEndHour ?? null,
  });
  if (!error) return null;
  if (/AMORA_CARE_CADENCE_WINDOW_INVALID/.test(rpcErrorText(error))) {
    return response(
      { error: "시작 시각이 끝 시각보다 앞서야 해요.", code: "CARE_WINDOW_INVALID" },
      400,
    );
  }
  console.error("[care-preferences] cadence RPC failed", {
    code: typeof error.code === "string" ? error.code : "unknown",
  });
  return response({ error: "알림 설정을 저장하지 못했어요. 기존 설정은 그대로예요." }, 503);
}

async function readUpdate(request: Request): Promise<CarePreferenceUpdate | NextResponse> {
  const body = await readBoundedUtf8Text(request, MAX_BODY_BYTES);
  if (!body.ok) {
    return response(
      {
        error: body.reason === "too_large"
          ? "요청 데이터가 너무 커요."
          : "요청 데이터를 읽지 못했어요.",
      },
      body.reason === "too_large" ? 413 : 400,
    );
  }
  try {
    const update = parseCarePreferenceUpdate(JSON.parse(body.text) as unknown);
    if (update) return update;
  } catch {
    // Fall through to the bounded generic error.
  }
  return response({ error: "알림 설정 요청이 올바르지 않아요." }, 400);
}

function refuseUnavailableChange(
  update: CarePreferenceUpdate,
  current: CarePreferencePayload,
): NextResponse | null {
  if (update.chat === true && !current.available) {
    return response(
      { error: "지금은 이 알림을 켤 수 없어요.", code: "CARE_CHAT_UNAVAILABLE" },
      409,
    );
  }
  if (update.email !== true) return null;
  if (!current.emailAvailable) {
    return response(
      { error: "지금은 메일 알림을 켤 수 없어요.", code: "CARE_EMAIL_UNAVAILABLE" },
      409,
    );
  }
  if (!current.email.verified) {
    return response(
      { error: "가입 메일 확인을 마친 뒤에 켤 수 있어요.", code: "CARE_EMAIL_UNVERIFIED" },
      409,
    );
  }
  const chatOn = update.chat === true || (update.chat === undefined && current.chat.enabled);
  if (!chatOn) {
    return response(
      { error: "함께 대화 알림을 먼저 켜 주세요.", code: "CARE_EMAIL_REQUIRES_CHAT" },
      409,
    );
  }
  return null;
}

function rpcErrorText(error: { code?: unknown; message?: unknown; details?: unknown }) {
  return [error.code, error.message, error.details]
    .filter((value): value is string => typeof value === "string")
    .join(" ");
}

export async function GET(request: Request) {
  try {
    const user = await authenticate(request);
    if (!user) return response({ error: "로그인이 필요해요." }, 401);
    const limited = rate("amora-care-preferences:read", request, user.id, MAX_READS_PER_MINUTE);
    if (limited) return limited;

    const read = await readPreference(user);
    return read.ok ? response(read.payload) : read.response;
  } catch (error) {
    console.error("[care-preferences] GET failed", error);
    return response({ error: "알림 설정을 불러오지 못했어요." }, 500);
  }
}

export async function PUT(request: Request) {
  try {
    if (!isTrustedMutationRequest(request)) {
      return response({ error: "잘못된 요청 출처예요." }, 403);
    }
    const update = await readUpdate(request);
    if (update instanceof NextResponse) return update;

    const user = await authenticate(request);
    if (!user) return response({ error: "로그인이 필요해요." }, 401);
    const limited = rate("amora-care-preferences:write", request, user.id, MAX_WRITES_PER_MINUTE);
    if (limited) return limited;

    if (isCadenceUpdate(update)) {
      const failed = await saveCadence(user.id, update);
      if (failed) return failed;
      const saved = await readPreference(user);
      return saved.ok
        ? response(saved.payload)
        : response({ error: "알림 설정이 저장됐는지 확인하지 못했어요." }, 503);
    }

    const current = await readPreference(user);
    if (!current.ok) return current.response;
    const refused = refuseUnavailableChange(update, current.payload);
    if (refused) return refused;

    // 켜든 끄든 사람이 직접 고르면 라운지의 질문에도 답한 것으로 친다.
    const promptAnswered = update.promptAnswered === true || update.chat !== undefined;
    const { error } = await createAdminClient().rpc("patch_profile_atomic", {
      p_user_id: user.id,
      p_care_notifications_enabled: update.chat ?? null,
      p_care_email_enabled: update.email ?? null,
      p_care_prompt_answered: promptAnswered,
    });
    if (error) {
      if (/PROFILE_PATCH_CARE_EMAIL_REQUIRES_SHARED_CONSENT/.test(rpcErrorText(error))) {
        return response(
          { error: "함께 대화 알림을 먼저 켜 주세요.", code: "CARE_EMAIL_REQUIRES_CHAT" },
          409,
        );
      }
      console.error("[care-preferences] patch RPC failed", {
        code: typeof error.code === "string" ? error.code : "unknown",
      });
      return response(
        { error: "알림 설정을 저장하지 못했어요. 기존 설정은 그대로예요." },
        503,
      );
    }

    const saved = await readPreference(user);
    if (!saved.ok) {
      return response({ error: "알림 설정이 저장됐는지 확인하지 못했어요." }, 503);
    }
    return response(saved.payload);
  } catch (error) {
    console.error("[care-preferences] PUT failed", error);
    return response(
      { error: "알림 설정을 저장하지 못했어요. 기존 설정은 그대로예요." },
      500,
    );
  }
}
