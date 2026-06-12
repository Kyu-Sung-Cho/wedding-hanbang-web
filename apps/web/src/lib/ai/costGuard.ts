// 아모라(Claude) 비용 가드레일 — 유통 테스트 전 지갑 보호용.
//
// 두 겹의 차단기:
//  1) 커플당 누적 무료 상한 — 신규 유저 1명이 태울 수 있는 최대 비용을 고정.
//  2) 전역 일일 상한 — 정상 유저가 많아도 하루 총비용에 천장(서킷브레이커).
//
// 카운트 기준은 ai_interactions_log의 chat_turn — 모든 LLM 턴이 isDemo·저장 여부와
// 무관하게 무조건 기록되는 비용 장부라 클라이언트가 어떤 값을 조작해도 속일 수 없다.
// (chat_messages 기준은 두 번 기각: ①user 메시지 카운트는 파트너 메시지(비용 0)까지
// 깎아 부당 차단 ②AI 메시지 카운트는 isDemo 위조 시 저장 스킵으로 카운트 우회 가능)
// DB 카운트라 서버리스에서도 정확. service_role로 RLS 우회.
//
// ⚠️ 면제는 is_admin(DB 검증)만. 클라이언트가 보내는 값(body의 isDemo 등)으로
// 면제하면 안 됨 — 인증 유저가 그 값을 조작해 가드를 우회할 수 있다.
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

  // 2) 커플 누적 무료 상한 — 이 커플이 발생시킨 LLM 턴 수
  const { count: coupleTotal, error: coupleErr } = await admin
    .from("ai_interactions_log")
    .select("id", { count: "exact", head: true })
    .eq("couple_id", params.coupleId)
    .eq("interaction_type", "chat_turn");

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
