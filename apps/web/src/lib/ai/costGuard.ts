// 테스트 단계에서는 사용량 제한을 기본 비활성화한다.
// AMORA_USAGE_LIMITS_ENABLED=true를 명시한 향후 운영에서만 provider slot 제한 장부를 사용한다.
// 메인 채팅의 한 slot은 exact count와 이어지는 generation을 묶는다.
// - 사용자 턴: provider slot을 예약
// - 추가 Terra 라운드/Luna 후처리: provider slot을 추가 예약
// 제한이 꺼져도 무제한 계량 RPC의 row lock 안에서 원자적으로 기록한다.

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

// DB 함수의 이전 시그니처와 호환하기 위한 값이다. p_count_user_turn=false라
// 영구 누적 상담 제한에는 사용되지 않는다. 제거는 DB 함수 시그니처 변경과 함께 한다.
const LEGACY_COUPLE_CAP_PARAMETER = 30;
const HARD_DAILY_PROVIDER_CALL_CEILING = 60;
const GLOBAL_DAILY_PROVIDER_CALL_CAP = boundedPositiveInteger(
  process.env.AMORA_GLOBAL_DAILY_PROVIDER_CALL_CAP ??
    process.env.AMORA_GLOBAL_DAILY_MESSAGE_CAP,
  HARD_DAILY_PROVIDER_CALL_CEILING,
  HARD_DAILY_PROVIDER_CALL_CEILING
);
const IS_PRODUCTION = process.env.NODE_ENV === "production";
// 현재 테스트 정책은 환경과 무관하게 명시적으로 opt-in한 경우에만 제한한다.
// 기존 AMORA_COST_GUARD_ENABLED 값은 오래된 배포 변수가 제한을 되살리지 않도록 무시한다.
const USAGE_LIMITS_ENABLED = process.env.AMORA_USAGE_LIMITS_ENABLED === "true";
const FAIL_OPEN_ON_ERROR =
  USAGE_LIMITS_ENABLED && !IS_PRODUCTION && process.env.AMORA_COST_GUARD_FAIL_OPEN === "true";

export interface CostGuardResult {
  allowed: boolean;
  reason?: "couple_quota" | "couple_provider_daily" | "global_daily" | "guard_unavailable";
  message?: string;
  /** 이전 서버 응답과의 롤링 호환용. 새 정책은 영구 누적 잔여 횟수를 보내지 않는다. */
  remaining?: number;
  /** 향후 사용량 제한을 opt-in했을 때만 제공되는 오늘의 잔여 provider slot. */
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
  params: { coupleId: string; isAdmin: boolean; reservation?: AmoraUsageReservationIdentity }
): Promise<CostGuardResult> {
  try {
    if (!USAGE_LIMITS_ENABLED) {
      if (params.reservation) {
        const { data, error } = await admin.rpc("reserve_amora_usage_unlimited_v1", {
          p_couple_id: params.coupleId,
          p_request_key: params.reservation.requestKey,
          p_request_hash: params.reservation.requestHash,
          p_provider_ordinal: params.reservation.providerOrdinal,
        });
        if (error) {
          console.error("[costGuard] 무제한 계량 예약 실패:", safeCostGuardErrorCode(error));
          return guardErrorResult();
        }
        const row = Array.isArray(data) ? data[0] : data;
        if (row?.allowed === true) {
          return {
            allowed: true,
            ...(row.reused === true ? { reservationReused: true } : {}),
          };
        }
        console.error("[costGuard] 무제한 계량 응답 형태 불명: invalid_response_shape");
        return guardErrorResult();
      }

      const { data, error } = await admin.rpc("meter_amora_provider_usage_unlimited_v1", {
        p_couple_id: params.coupleId,
      });
      if (error || data !== true) {
        console.error(
          "[costGuard] 무제한 보조 호출 계량 실패:",
          error ? safeCostGuardErrorCode(error) : "invalid_response_shape"
        );
        return guardErrorResult();
      }
      return ALLOW;
    }

    const rpcName = params.reservation ? "reserve_amora_usage_v2" : "reserve_amora_usage";
    const rpcParams = {
      p_couple_id: params.coupleId,
      p_couple_cap: LEGACY_COUPLE_CAP_PARAMETER,
      p_global_provider_cap: GLOBAL_DAILY_PROVIDER_CALL_CAP,
      // 과거 베타의 영구 누적 상담 한도는 적용하지 않는다. 이 경로는
      // AMORA_USAGE_LIMITS_ENABLED=true인 향후 운영에서만 실행된다.
      p_count_user_turn: false,
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
    if (row?.reason === "couple_quota") {
      console.error("[costGuard] 비활성화된 누적 quota 응답 (비용 보호 차단): legacy_couple_quota");
      return guardErrorResult();
    }

    console.error("[costGuard] 예약 RPC 응답 형태 불명 (비용 보호 차단): invalid_response_shape");
    return guardErrorResult();
  } catch (error) {
    console.error("[costGuard] 원자 예약 예외 (비용 보호 차단):", safeCostGuardErrorCode(error));
    return guardErrorResult();
  }
}

/** 실제 사용자 상담의 첫 provider slot을 예약한다. */
export function reserveAmoraUserTurn(
  admin: SupabaseClient,
  params: { coupleId: string; isAdmin: boolean; reservation?: AmoraUsageReservationIdentity }
): Promise<CostGuardResult> {
  return reserveUsage(admin, params);
}

/** 도구 후속 라운드·요약·분류 등 숨은 provider 호출 1회만 예약한다. */
export function reserveAmoraProviderCall(
  admin: SupabaseClient,
  params: { coupleId: string; isAdmin: boolean; reservation?: AmoraUsageReservationIdentity }
): Promise<CostGuardResult> {
  return reserveUsage(admin, params);
}

/** 기존 호출처 호환용. 새 코드는 의도를 드러내는 reserveAmoraUserTurn을 사용한다. */
export const reserveAmoraTurn = reserveAmoraUserTurn;

/** 예약된 provider 호출이 실제 HTTP 경계에 진입했음을 기록한다. */
export async function markAmoraProviderStarted(
  admin: SupabaseClient,
  reservation: AmoraUsageReservationIdentity
): Promise<void> {
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
  if (!USAGE_LIMITS_ENABLED) return ALLOW;
  try {
    const { data, error } = await admin.rpc("check_amora_usage", {
      p_couple_id: params.coupleId,
      p_couple_cap: LEGACY_COUPLE_CAP_PARAMETER,
      p_global_provider_cap: GLOBAL_DAILY_PROVIDER_CALL_CAP,
      p_count_user_turn: false,
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
    if (row?.reason === "couple_quota") return guardErrorResult();
    return guardErrorResult();
  } catch {
    return guardErrorResult();
  }
}
