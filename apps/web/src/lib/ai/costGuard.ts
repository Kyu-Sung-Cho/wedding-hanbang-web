// Amora 비용 보호는 사용자에게 보이는 상담 횟수와 provider slot을 분리한다.
// 메인 채팅의 한 slot은 exact count와 이어지는 generation을 묶는다.
// - 사용자 턴: 커플 무료 상담 한도 + provider slot 한도를 함께 예약
// - 추가 Terra 라운드/Luna 후처리: provider slot 한도만 예약
// 두 경로 모두 reserve_amora_usage RPC의 row lock 안에서 원자적으로 증가한다.

import type { SupabaseClient } from "@supabase/supabase-js";

function boundedPositiveInteger(
  raw: string | undefined,
  fallback: number,
  hardCeiling: number
): number {
  if (!raw || !/^\d+$/.test(raw)) return fallback;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= 1
    ? Math.min(value, hardCeiling)
    : fallback;
}

// Deployment variables may lower these limits, but cannot silently restore the
// old high-cost beta limits. Raising a ceiling requires a reviewed code change.
const HARD_COUPLE_TURN_CEILING = 30;
const HARD_DAILY_PROVIDER_CALL_CEILING = 60;
const FREE_USER_TURNS_PER_COUPLE = boundedPositiveInteger(
  process.env.AMORA_FREE_MESSAGES_PER_COUPLE,
  HARD_COUPLE_TURN_CEILING,
  HARD_COUPLE_TURN_CEILING
);
const GLOBAL_DAILY_PROVIDER_CALL_CAP = boundedPositiveInteger(
  process.env.AMORA_GLOBAL_DAILY_PROVIDER_CALL_CAP ??
    process.env.AMORA_GLOBAL_DAILY_MESSAGE_CAP,
  HARD_DAILY_PROVIDER_CALL_CEILING,
  HARD_DAILY_PROVIDER_CALL_CEILING
);
// Production cannot disable the ledger or fail open through a stale/accidental
// environment variable. Those switches remain available only for local tests.
const IS_PRODUCTION = process.env.NODE_ENV === "production";
const GUARD_ENABLED = IS_PRODUCTION || process.env.AMORA_COST_GUARD_ENABLED !== "false";
const FAIL_OPEN_ON_ERROR =
  !IS_PRODUCTION && process.env.AMORA_COST_GUARD_FAIL_OPEN === "true";

export interface CostGuardResult {
  allowed: boolean;
  reason?: "couple_quota" | "couple_provider_daily" | "global_daily" | "guard_unavailable";
  message?: string;
  /** 사용자에게 보이는 무료 상담 잔여 횟수. provider-only 예약에는 없다. */
  remaining?: number;
  /** 이 예약 뒤 오늘 남은 provider slot 수(커플·전역 중 더 작은 값). */
  providerRemaining?: number;
  /** 동일 request_key/call ordinal 예약을 재사용했는지 여부. */
  reservationReused?: boolean;
}

export interface AmoraUsageReservationIdentity {
  requestKey: string;
  requestHash: string;
  providerOrdinal: 0 | 1;
}

const ALLOW: CostGuardResult = { allowed: true };
const DENY_GLOBAL: CostGuardResult = {
  allowed: false,
  reason: "global_daily",
  message: "오늘 아모라 이용량이 안전 한도에 도달했어요. 내일 다시 이어서 도와드릴게요.",
};
const DENY_COUPLE: CostGuardResult = {
  allowed: false,
  reason: "couple_quota",
  message: "베타 기간 무료 상담을 모두 사용하셨어요. 추가 상담이 열리면 알려드릴게요.",
};
const DENY_COUPLE_DAILY: CostGuardResult = {
  allowed: false,
  reason: "couple_provider_daily",
  message: "오늘 이 커플의 아모라 이용량이 안전 한도에 도달했어요. 내일 다시 이어서 도와드릴게요.",
};
const DENY_GUARD_UNAVAILABLE: CostGuardResult = {
  allowed: false,
  reason: "guard_unavailable",
  message: "비용 보호 장치를 확인하지 못해 아모라를 잠시 멈췄어요. 잠시 후 다시 시도해 주세요.",
};

function safeCostGuardErrorCode(error: unknown): string {
  const record = error && typeof error === "object"
    ? error as { name?: unknown; status?: unknown; code?: unknown }
    : {};
  const cleanToken = (value: unknown): string | null => {
    if (typeof value !== "string") return null;
    const cleaned = value.replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 64);
    return cleaned || null;
  };
  const parts = ["cost_guard_failed"];
  const name = cleanToken(record.name);
  const code = cleanToken(record.code);
  const status = typeof record.status === "number" && Number.isSafeInteger(record.status)
    ? record.status
    : null;
  if (name) parts.push(`name_${name}`);
  if (status !== null) parts.push(`status_${status}`);
  if (code) parts.push(`code_${code}`);
  return parts.join(":").slice(0, 240);
}

function guardErrorResult(): CostGuardResult {
  return FAIL_OPEN_ON_ERROR ? ALLOW : DENY_GUARD_UNAVAILABLE;
}

async function reserveUsage(
  admin: SupabaseClient,
  params: { coupleId: string; isAdmin: boolean; reservation?: AmoraUsageReservationIdentity },
  countUserTurn: boolean
): Promise<CostGuardResult> {
  if (!GUARD_ENABLED) return ALLOW;

  try {
    const rpcName = params.reservation ? "reserve_amora_usage_v2" : "reserve_amora_usage";
    const rpcParams = {
      p_couple_id: params.coupleId,
      p_couple_cap: FREE_USER_TURNS_PER_COUPLE,
      p_global_provider_cap: GLOBAL_DAILY_PROVIDER_CALL_CAP,
      // 관리자는 무료 상담 횟수만 면제된다. 실제 provider 비용의 전역 천장은 적용한다.
      p_count_user_turn: countUserTurn && !params.isAdmin,
      ...(params.reservation ? {
        p_request_key: params.reservation.requestKey,
        p_request_hash: params.reservation.requestHash,
        p_provider_ordinal: params.reservation.providerOrdinal,
      } : {}),
    };
    const { data, error } = await admin.rpc(rpcName, rpcParams);
    if (error) {
      console.error("[costGuard] 원자 예약 실패 (비용 보호 차단):", safeCostGuardErrorCode(error));
      return guardErrorResult();
    }

    const row = Array.isArray(data) ? data[0] : data;
    if (row?.allowed === true) {
      return {
        allowed: true,
        ...(typeof row.remaining === "number" ? { remaining: Math.max(0, row.remaining) } : {}),
        ...(typeof row.provider_remaining === "number"
          ? { providerRemaining: Math.max(0, row.provider_remaining) }
          : {}),
        ...(row.reused === true ? { reservationReused: true } : {}),
      };
    }
    if (row?.reason === "global_daily") return DENY_GLOBAL;
    if (row?.reason === "couple_provider_daily") return DENY_COUPLE_DAILY;
    if (row?.reason === "couple_quota") return DENY_COUPLE;

    console.error("[costGuard] 예약 RPC 응답 형태 불명 (비용 보호 차단): invalid_response_shape");
    return guardErrorResult();
  } catch (error) {
    console.error("[costGuard] 원자 예약 예외 (비용 보호 차단):", safeCostGuardErrorCode(error));
    return guardErrorResult();
  }
}

/** 실제 사용자 상담 1회를 예약한다. 첫 provider 호출 예약도 함께 포함한다. */
export function reserveAmoraUserTurn(
  admin: SupabaseClient,
  params: { coupleId: string; isAdmin: boolean; reservation?: AmoraUsageReservationIdentity }
): Promise<CostGuardResult> {
  return reserveUsage(admin, params, true);
}

/** 도구 후속 라운드·요약·분류 등 숨은 provider 호출 1회만 예약한다. */
export function reserveAmoraProviderCall(
  admin: SupabaseClient,
  params: { coupleId: string; isAdmin: boolean; reservation?: AmoraUsageReservationIdentity }
): Promise<CostGuardResult> {
  return reserveUsage(admin, params, false);
}

/** 기존 호출처 호환용. 새 코드는 의도를 드러내는 reserveAmoraUserTurn을 사용한다. */
export const reserveAmoraTurn = reserveAmoraUserTurn;

/** 예약된 provider 호출이 실제 HTTP 경계에 진입했음을 기록한다. */
export async function markAmoraProviderStarted(
  admin: SupabaseClient,
  reservation: AmoraUsageReservationIdentity
): Promise<void> {
  if (!GUARD_ENABLED) return;
  const { data, error } = await admin.rpc("mark_amora_provider_started", {
    p_request_key: reservation.requestKey,
    p_request_hash: reservation.requestHash,
    p_provider_ordinal: reservation.providerOrdinal,
  });
  if (error || data !== true) {
    throw new Error("아모라 provider 시작 장부를 확정하지 못했습니다.");
  }
}

/** 비소모형 사전 표시용 검사. 실제 호출 직전에는 반드시 reserve 함수를 사용한다. */
export async function checkAmoraCostGuard(
  admin: SupabaseClient,
  params: { coupleId: string; isAdmin: boolean }
): Promise<CostGuardResult> {
  if (!GUARD_ENABLED) return ALLOW;
  try {
    const { data, error } = await admin.rpc("check_amora_usage", {
      p_couple_id: params.coupleId,
      p_couple_cap: FREE_USER_TURNS_PER_COUPLE,
      p_global_provider_cap: GLOBAL_DAILY_PROVIDER_CALL_CAP,
      p_count_user_turn: !params.isAdmin,
    });
    if (error) return guardErrorResult();
    const row = Array.isArray(data) ? data[0] : data;
    if (row?.allowed === true) {
      return {
        allowed: true,
        ...(typeof row.remaining === "number" ? { remaining: Math.max(0, row.remaining) } : {}),
        ...(typeof row.provider_remaining === "number"
          ? { providerRemaining: Math.max(0, row.provider_remaining) }
          : {}),
      };
    }
    if (row?.reason === "global_daily") return DENY_GLOBAL;
    if (row?.reason === "couple_provider_daily") return DENY_COUPLE_DAILY;
    if (row?.reason === "couple_quota") return DENY_COUPLE;
    return guardErrorResult();
  } catch {
    return guardErrorResult();
  }
}
