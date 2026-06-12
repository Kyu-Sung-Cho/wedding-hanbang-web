// 아모라(Claude) 비용 가드레일 — 유통 테스트 전 지갑 보호용.
//
// 두 겹의 차단기:
//  1) 커플당 누적 무료 메시지 상한 — 신규 유저 1명이 태울 수 있는 최대 비용을 고정.
//  2) 전역 일일 메시지 상한 — 정상 유저가 많아도 하루 총비용에 천장(서킷브레이커).
//
// 카운트는 chat_messages(role='user')를 DB에서 직접 세므로 서버리스에서도 정확
// (인메모리 rate limit과 달리 인스턴스 간 공유됨). service_role로 호출해 RLS 우회.
//
// 환경변수로 조정 가능 (미설정 시 보수적 기본값):
//   AMORA_FREE_MESSAGES_PER_COUPLE (기본 100)
//   AMORA_GLOBAL_DAILY_MESSAGE_CAP (기본 300)
//   AMORA_COST_GUARD_ENABLED=false 로 완전 비활성(긴급 시)

import type { SupabaseClient } from "@supabase/supabase-js";

const FREE_PER_COUPLE = Number(process.env.AMORA_FREE_MESSAGES_PER_COUPLE ?? 100);
const GLOBAL_DAILY_CAP = Number(process.env.AMORA_GLOBAL_DAILY_MESSAGE_CAP ?? 300);
const GUARD_ENABLED = process.env.AMORA_COST_GUARD_ENABLED !== "false";

export interface CostGuardResult {
  allowed: boolean;
  reason?: "couple_quota" | "global_daily";
  message?: string;
}

const ALLOW: CostGuardResult = { allowed: true };

// 커플(또는 데모) 단위로 아모라 사용 가능 여부 판정. user 역할 메시지만 카운트.
export async function checkAmoraCostGuard(
  admin: SupabaseClient,
  params: { coupleId: string; isDemo: boolean; isAdmin: boolean }
): Promise<CostGuardResult> {
  // 데모는 별도 분기에서 실제 API를 태우지 않음 + 관리자 면제 + 킬스위치 off
  if (!GUARD_ENABLED || params.isDemo || params.isAdmin) return ALLOW;

  // 1) 전역 일일 상한 — KST 자정 기준 오늘 발생한 모든 user 메시지 수
  const startOfTodayKstUtc = getStartOfTodayKstAsUtcIso();
  const { count: globalToday, error: globalErr } = await admin
    .from("chat_messages")
    .select("id", { count: "exact", head: true })
    .eq("role", "user")
    .gte("created_at", startOfTodayKstUtc);

  if (globalErr) {
    // 카운트 실패 시 차단하지 않음 — 가드 오류가 정상 사용을 막으면 안 됨 (fail-open)
    console.error("[costGuard] 전역 카운트 실패 (통과 처리):", globalErr.message);
    return ALLOW;
  }
  if ((globalToday ?? 0) >= GLOBAL_DAILY_CAP) {
    return {
      allowed: false,
      reason: "global_daily",
      message:
        "오늘 아모라 상담이 많아 잠시 쉬어가고 있어요. 내일 다시 이어서 도와드릴게요. (베타 기간 한도)",
    };
  }

  // 2) 커플 누적 무료 상한
  const { count: coupleTotal, error: coupleErr } = await admin
    .from("chat_messages")
    .select("id", { count: "exact", head: true })
    .eq("couple_id", params.coupleId)
    .eq("role", "user");

  if (coupleErr) {
    console.error("[costGuard] 커플 카운트 실패 (통과 처리):", coupleErr.message);
    return ALLOW;
  }
  if ((coupleTotal ?? 0) >= FREE_PER_COUPLE) {
    return {
      allowed: false,
      reason: "couple_quota",
      message:
        "베타 기간 무료 상담을 모두 사용하셨어요. 더 많은 상담은 곧 열릴 예정이에요 — 그때 가장 먼저 알려드릴게요.",
    };
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
