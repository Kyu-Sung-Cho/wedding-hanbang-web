import { NextResponse } from "next/server";

import { isAmoraAppPushEnabled } from "@/lib/amora/push/sendAmoraPush";
import { createClientFromRequest } from "@/lib/supabase/server";
import { checkRateLimit, rateLimitKey } from "@/utils/rateLimit";
import { isRecord, readBoundedUtf8Text } from "@/utils/requestValidation";
import { isTrustedMutationRequest } from "@/utils/trustedMutation";

/**
 * 아모라 앱 알림 동의(결정 D-86). 메일 동의(`/api/amora/care-preferences`)·커뮤니티 답글 알림 동의와 따로다.
 *
 * `available` 은 지금 서버가 실제로 보낼 수 있는가다(발송 스위치와 Expo 열쇠). 보낼 수 없는 동안에는 켜기를 받지
 * 않는다. 켜도 오지 않는 알림을 약속하지 않기 위해서다(앱의 커뮤니티 답글 칸이 같은 일로 고쳐진 적이 있다).
 * 끄기는 언제나 받는다.
 */

export const dynamic = "force-dynamic";
export const revalidate = 0;

const HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  Vary: "Origin, Sec-Fetch-Site, Authorization",
};
const MAX_BODY_BYTES = 256;

export type AmoraPushPreferencePayload = {
  available: boolean;
  enabled: boolean;
  consentedAt: string | null;
};

function response(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: HEADERS });
}

function rate(scope: string, request: Request, userId: string, maxRequests: number) {
  const limited = checkRateLimit(rateLimitKey(scope, request, userId), { maxRequests, windowMs: 60 * 1000 });
  if (!limited) return null;
  for (const [name, value] of Object.entries(HEADERS)) limited.headers.set(name, value);
  return limited;
}

function pushAvailable(): boolean {
  const token = process.env.EXPO_ACCESS_TOKEN;
  return isAmoraAppPushEnabled() && typeof token === "string" && token.length > 0;
}

function parsePreference(value: unknown): { enabled: boolean; consentedAt: string | null } | null {
  if (!isRecord(value) || typeof value.enabled !== "boolean") return null;
  const consentedAt = value.consentedAt;
  if (!(consentedAt === null || (typeof consentedAt === "string" && consentedAt.length <= 40))) return null;
  if (value.enabled !== (consentedAt !== null)) return null;
  return { enabled: value.enabled, consentedAt };
}

async function open(request: Request) {
  const supabase = await createClientFromRequest(request);
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user?.id) return null;
  return { supabase, userId: data.user.id };
}

export async function GET(request: Request) {
  try {
    const opened = await open(request);
    if (!opened) return response({ error: "인증이 필요합니다." }, 401);
    const limited = rate("amora-push-preference:read", request, opened.userId, 60);
    if (limited) return limited;
    const { data, error } = await opened.supabase.rpc("get_amora_push_preference");
    const preference = error ? null : parsePreference(data);
    if (!preference) return response({ error: "앱 알림 설정을 불러오지 못했어요." }, 503);
    const payload: AmoraPushPreferencePayload = { available: pushAvailable(), ...preference };
    return response(payload);
  } catch {
    return response({ error: "앱 알림 설정을 불러오지 못했어요." }, 500);
  }
}

export async function PUT(request: Request) {
  try {
    if (!isTrustedMutationRequest(request)) return response({ error: "잘못된 요청 출처입니다." }, 403);
    const body = await readBoundedUtf8Text(request, MAX_BODY_BYTES);
    if (!body.ok) return response({ error: "요청 데이터를 읽지 못했습니다." }, body.reason === "too_large" ? 413 : 400);
    let parsed: unknown;
    try {
      parsed = JSON.parse(body.text);
    } catch {
      return response({ error: "요청 형식이 올바르지 않습니다." }, 400);
    }
    if (!isRecord(parsed) || Object.keys(parsed).length !== 1 || typeof parsed.enabled !== "boolean") {
      return response({ error: "요청 형식이 올바르지 않습니다." }, 400);
    }
    const opened = await open(request);
    if (!opened) return response({ error: "인증이 필요합니다." }, 401);
    const limited = rate("amora-push-preference:write", request, opened.userId, 20);
    if (limited) return limited;
    const available = pushAvailable();
    if (parsed.enabled && !available) {
      return response({ error: "앱 알림은 아직 켤 수 없어요.", code: "AMORA_PUSH_UNAVAILABLE" }, 409);
    }
    const { data, error } = await opened.supabase.rpc("set_amora_push_preference", { p_enabled: parsed.enabled });
    const preference = error ? null : parsePreference(data);
    if (!preference || preference.enabled !== parsed.enabled) {
      return response({ error: "설정을 저장하지 못했어요. 기존 설정은 그대로예요." }, 503);
    }
    const payload: AmoraPushPreferencePayload = { available, ...preference };
    return response(payload);
  } catch {
    return response({ error: "설정을 저장하지 못했어요. 기존 설정은 그대로예요." }, 500);
  }
}
