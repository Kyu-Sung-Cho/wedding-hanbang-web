// Amora 비용 보호는 사용자에게 보이는 상담 횟수와 실제 provider 호출을 분리한다.
// - 사용자 턴: 커플 무료 상담 한도 + 전역 provider 호출 한도를 함께 예약
// - 추가 Terra 라운드/Luna 후처리: 전역 provider 호출 한도만 예약
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
  reason?: "couple_quota" | "global_daily" | "guard_unavailable";
  message?: string;
  /** 사용자에게 보이는 무료 상담 잔여 횟수. provider-only 예약에는 없다. */
  remaining?: number;
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
const DENY_GUARD_UNAVAILABLE: CostGuardResult = {
  allowed: false,
  reason: "guard_unavailable",
  message: "비용 보호 장치를 확인하지 못해 아모라를 잠시 멈췄어요. 잠시 후 다시 시도해 주세요.",
};

function guardErrorResult(): CostGuardResult {
  return FAIL_OPEN_ON_ERROR ? ALLOW : DENY_GUARD_UNAVAILABLE;
}

async function reserveUsage(
  admin: SupabaseClient,
  params: { coupleId: string; isAdmin: boolean },
  countUserTurn: boolean
): Promise<CostGuardResult> {
  if (!GUARD_ENABLED) return ALLOW;

  try {
    const { data, error } = await admin.rpc("reserve_amora_usage", {
      p_couple_id: params.coupleId,
      p_couple_cap: FREE_USER_TURNS_PER_COUPLE,
      p_global_provider_cap: GLOBAL_DAILY_PROVIDER_CALL_CAP,
      // 관리자는 무료 상담 횟수만 면제된다. 실제 provider 비용의 전역 천장은 적용한다.
      p_count_user_turn: countUserTurn && !params.isAdmin,
    });
    if (error) {
      console.error("[costGuard] 원자 예약 실패 (비용 보호 차단):", error.message);
      return guardErrorResult();
    }

    const row = Array.isArray(data) ? data[0] : data;
    if (row?.allowed === true) {
      return {
        allowed: true,
        ...(typeof row.remaining === "number" ? { remaining: Math.max(0, row.remaining) } : {}),
      };
    }
    if (row?.reason === "global_daily") return DENY_GLOBAL;
    if (row?.reason === "couple_quota") return DENY_COUPLE;

    console.error("[costGuard] 예약 RPC 응답 형태 불명 (비용 보호 차단):", JSON.stringify(row ?? null));
    return guardErrorResult();
  } catch (error) {
    console.error("[costGuard] 원자 예약 예외 (비용 보호 차단):", error);
    return guardErrorResult();
  }
}

/** 실제 사용자 상담 1회를 예약한다. 첫 provider 호출 예약도 함께 포함한다. */
export function reserveAmoraUserTurn(
  admin: SupabaseClient,
  params: { coupleId: string; isAdmin: boolean }
): Promise<CostGuardResult> {
  return reserveUsage(admin, params, true);
}

/** 도구 후속 라운드·요약·분류 등 숨은 provider 호출 1회만 예약한다. */
export function reserveAmoraProviderCall(
  admin: SupabaseClient,
  params: { coupleId: string; isAdmin: boolean }
): Promise<CostGuardResult> {
  return reserveUsage(admin, params, false);
}

/** 기존 호출처 호환용. 새 코드는 의도를 드러내는 reserveAmoraUserTurn을 사용한다. */
export const reserveAmoraTurn = reserveAmoraUserTurn;

function currentKstDate(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const read = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${read("year")}-${read("month")}-${read("day")}`;
}

async function readCounter(
  admin: SupabaseClient,
  key: string
): Promise<{ count: number | null; error: unknown }> {
  const { data, error } = await admin
    .from("amora_turn_counters")
    .select("count")
    .eq("key", key)
    .maybeSingle();
  return {
    count: typeof data?.count === "number" ? data.count : 0,
    error,
  };
}

/** 비소모형 사전 표시용 검사. 실제 호출 직전에는 반드시 reserve 함수를 사용한다. */
export async function checkAmoraCostGuard(
  admin: SupabaseClient,
  params: { coupleId: string; isAdmin: boolean }
): Promise<CostGuardResult> {
  if (!GUARD_ENABLED) return ALLOW;

  const global = await readCounter(
    admin,
    `global:provider_calls:${currentKstDate()}`
  );
  if (global.error) return guardErrorResult();
  if ((global.count ?? 0) >= GLOBAL_DAILY_PROVIDER_CALL_CAP) return DENY_GLOBAL;
  if (params.isAdmin) return ALLOW;

  const couple = await readCounter(admin, `couple:user_turns:${params.coupleId}`);
  if (couple.error) return guardErrorResult();
  if ((couple.count ?? 0) >= FREE_USER_TURNS_PER_COUPLE) return DENY_COUPLE;
  return ALLOW;
}
