// 아모라 AI 비용 가드레일 — 유통 테스트 전 지갑 보호용.
//
// 두 겹의 차단기:
//  1) 커플당 누적 무료 상한 — 신규 유저 1명이 태울 수 있는 최대 비용을 고정.
//  2) 전역 일일 상한 — 정상 유저가 많아도 하루 총비용에 천장(서킷브레이커).
//
// 두 함수:
//  - reserveAmoraTurn: 원자적 체크+예약 (reserve_amora_turn RPC, FOR UPDATE 잠금).
//    실제 LLM 호출 직전에 사용 — 동시 요청도 상한을 못 넘는다 (감사 2.3 H1 해소).
//  - checkAmoraCostGuard: 읽기전용 체크 (레이스 가능). LLM 호출이 일어날지 불확실한
//    앞단 게이트(예: check-couple-conflict — 파트너 메시지마다 호출되나 대부분 LLM 0회)와
//    RPC 미배포 시 폴백용. 여기서 예약하면 LLM 없는 호출이 쿼터를 태우므로 예약 금지.
//
// 카운트 기준은 ai_interactions_log의 chat_turn — 모든 LLM 턴이 isDemo·저장 여부와
// 무관하게 무조건 기록되는 비용 장부라 클라이언트가 어떤 값을 조작해도 속일 수 없다.
// (chat_messages 기준은 두 번 기각: ①user 메시지 카운트는 파트너 메시지(비용 0)까지
// 깎아 부당 차단 ②AI 메시지 카운트는 isDemo 위조 시 저장 스킵으로 카운트 우회 가능)
// 카운터 테이블(amora_turn_counters)은 첫 접근 시 이 장부에서 자동 시드된다.
// DB 카운트라 서버리스에서도 정확. service_role로 RLS 우회.
//
// ⚠️ 면제는 is_admin(DB 검증)만. 클라이언트가 보내는 값(body의 isDemo 등)으로
// 면제하면 안 됨 — 인증 유저가 그 값을 조작해 가드를 우회할 수 있다.
//
// 환경변수로 조정 가능 (미설정 시 보수적 기본값):
//   AMORA_COUPLE_QUOTA_ENABLED=false (커플별 한도만 해제, 전역 가드는 유지)
//   AMORA_FREE_MESSAGES_PER_COUPLE (기본 100)
//   AMORA_GLOBAL_DAILY_MESSAGE_CAP (기본 300)
//   AMORA_COST_GUARD_ENABLED=false 로 완전 비활성(긴급 시)

import type { SupabaseClient } from "@supabase/supabase-js";

const FREE_PER_COUPLE = Number(process.env.AMORA_FREE_MESSAGES_PER_COUPLE ?? 100);
const GLOBAL_DAILY_CAP = Number(process.env.AMORA_GLOBAL_DAILY_MESSAGE_CAP ?? 300);
const GUARD_ENABLED = process.env.AMORA_COST_GUARD_ENABLED !== "false";
const COUPLE_QUOTA_ENABLED = process.env.AMORA_COUPLE_QUOTA_ENABLED !== "false";
// Keep the atomic global reservation when the per-couple quota is disabled.
// The RPC parameter is PostgreSQL INTEGER, so the sentinel must stay within int4.
const DISABLED_COUPLE_CAP = 2_147_483_647;
const EFFECTIVE_COUPLE_CAP = COUPLE_QUOTA_ENABLED
  ? FREE_PER_COUPLE
  : DISABLED_COUPLE_CAP;

export interface CostGuardResult {
  allowed: boolean;
  reason?: "couple_quota" | "global_daily" | "guard_unavailable";
  message?: string;
  /** 커플 무료 상담 잔여 횟수 — 예약 성공 시에만 채워짐(소진 예고 UX용). 실패해도 undefined일 뿐 차단과 무관. */
  remaining?: number;
}

const ALLOW: CostGuardResult = { allowed: true };

const DENY_GLOBAL: CostGuardResult = {
  allowed: false,
  reason: "global_daily",
  message:
    "오늘 아모라 상담이 많아 잠시 쉬어가고 있어요. 내일 다시 이어서 도와드릴게요. (베타 기간 한도)",
};

const DENY_COUPLE: CostGuardResult = {
  allowed: false,
  reason: "couple_quota",
  message:
    "베타 기간 무료 상담을 모두 사용하셨어요. 더 많은 상담은 곧 열릴 예정이에요 — 그때 가장 먼저 알려드릴게요.",
};

const DENY_UNAVAILABLE: CostGuardResult = {
  allowed: false,
  reason: "guard_unavailable",
  message:
    "아모라 사용량을 안전하게 확인하지 못했어요. 잠시 후 다시 시도해 주세요.",
};

// LLM 턴 1회를 원자적으로 "체크+예약" (감사 2.3 H1 — TOCTOU 레이스 해소).
// reserve_amora_turn RPC가 카운터 행을 FOR UPDATE로 잠그고 같은 트랜잭션에서
// 증가시키므로, 동시 요청이 상한을 초과할 수 없다. 실제 LLM 호출 직전에만
// 부를 것 — 통과하면 턴 1회가 소모된 것으로 계산된다.
// RPC 미배포/실패 시 기존 읽기전용 가드로 폴백 (무중단, patchJourneyProgress 패턴).
export async function reserveAmoraTurn(
  admin: SupabaseClient,
  params: { coupleId: string; isAdmin: boolean }
): Promise<CostGuardResult> {
  if (!GUARD_ENABLED || params.isAdmin) return ALLOW;

  try {
    const { data, error } = await admin.rpc("reserve_amora_turn", {
      p_couple_id: params.coupleId,
      p_couple_cap: EFFECTIVE_COUPLE_CAP,
      p_global_cap: GLOBAL_DAILY_CAP,
    });
    if (error) {
      console.error("[costGuard] 원자 예약 실패 (읽기전용 가드 폴백):", error.message);
      return checkAmoraCostGuard(admin, params);
    }

    const row = Array.isArray(data) ? data[0] : data;
    if (row?.allowed === true) {
      // 소진 예고용 잔여 횟수 — 예약 직후 카운터 PK 조회(비원자여도 배너 용도라 충분).
      // 조회 실패는 remaining만 비울 뿐 통과 여부에 영향 없음.
      return {
        allowed: true,
        remaining: COUPLE_QUOTA_ENABLED
          ? await readCoupleRemaining(admin, params.coupleId)
          : undefined,
      };
    }
    if (row?.reason === "global_daily") return DENY_GLOBAL;
    if (row?.reason === "couple_quota" && COUPLE_QUOTA_ENABLED) return DENY_COUPLE;

    // Unknown reservation state must never create an unmetered provider call.
    console.error("[costGuard] 예약 RPC 응답 형태 불명 (차단):", JSON.stringify(row ?? null));
    return DENY_UNAVAILABLE;
  } catch (err) {
    console.error("[costGuard] 원자 예약 예외 (읽기전용 가드 폴백):", err);
    return checkAmoraCostGuard(admin, params);
  }
}

// 예약 성공 직후 커플 잔여 무료 턴 수 조회 (PK 단건 — 카운터에 이번 예약이 이미 반영됨)
async function readCoupleRemaining(
  admin: SupabaseClient,
  coupleId: string
): Promise<number | undefined> {
  try {
    const { data } = await admin
      .from("amora_turn_counters")
      .select("count")
      .eq("key", `couple:${coupleId}`)
      .maybeSingle();
    if (typeof data?.count === "number") {
      return Math.max(0, FREE_PER_COUPLE - data.count);
    }
  } catch {
    // 배너용 조회 실패는 무시
  }
  return undefined;
}

// 커플 단위로 아모라 사용 가능 여부 판정. LLM 턴 로그 수로 비용을 추정.
export async function checkAmoraCostGuard(
  admin: SupabaseClient,
  params: { coupleId: string; isAdmin: boolean }
): Promise<CostGuardResult> {
  if (!GUARD_ENABLED || params.isAdmin) return ALLOW;

  // 1) 전역 일일 상한 — KST 자정 기준 오늘 발생한 LLM 턴 수
  const startOfTodayKstUtc = getStartOfTodayKstAsUtcIso();
  const { count: globalToday, error: globalErr } = await admin
    .from("ai_interactions_log")
    .select("id", { count: "exact", head: true })
    .eq("interaction_type", "chat_turn")
    .gte("created_at", startOfTodayKstUtc);

  if (globalErr) {
    console.error("[costGuard] 전역 카운트 실패 (차단):", globalErr.message);
    return DENY_UNAVAILABLE;
  }
  if ((globalToday ?? 0) >= GLOBAL_DAILY_CAP) {
    return DENY_GLOBAL;
  }

  if (!COUPLE_QUOTA_ENABLED) {
    return ALLOW;
  }

  // 2) 커플 누적 무료 상한 — 이 커플이 발생시킨 LLM 턴 수
  const { count: coupleTotal, error: coupleErr } = await admin
    .from("ai_interactions_log")
    .select("id", { count: "exact", head: true })
    .eq("couple_id", params.coupleId)
    .eq("interaction_type", "chat_turn");

  if (coupleErr) {
    console.error("[costGuard] 커플 카운트 실패 (차단):", coupleErr.message);
    return DENY_UNAVAILABLE;
  }
  if ((coupleTotal ?? 0) >= FREE_PER_COUPLE) {
    return DENY_COUPLE;
  }

  return ALLOW;
}

// KST(UTC+9) 자정을 UTC ISO 문자열로. Date 연산만 사용 (외부 의존 없음).
function getStartOfTodayKstAsUtcIso(): string {
  const now = new Date();
  const kstMs = now.getTime() + 9 * 60 * 60 * 1000;
  const kst = new Date(kstMs);
  const y = kst.getUTCFullYear();
  const m = kst.getUTCMonth();
  const d = kst.getUTCDate();
  // KST 자정 = 그 날 00:00 KST = 전날 15:00 UTC
  const startUtcMs = Date.UTC(y, m, d, 0, 0, 0) - 9 * 60 * 60 * 1000;
  return new Date(startUtcMs).toISOString();
}
