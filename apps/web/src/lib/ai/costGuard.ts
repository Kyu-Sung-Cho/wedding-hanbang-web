// 아모라 AI 비용 가드레일 — 유통 테스트 전 지갑 보호용.
//
// 두 겹의 차단기:
//  1) 커플당 누적 무료 상한 — 신규 유저 1명이 태울 수 있는 최대 비용을 고정.
//  2) 전역 일일 턴 + 보수적 USD 예산 상한 — 정상 유저가 많아도 지갑에 천장.
//
// 두 함수:
//  - reserveAmoraTurn: 원자적 체크+예약 (reserve_amora_turn RPC, FOR UPDATE 잠금).
//    실제 LLM 호출 직전에 사용 — 동시 요청도 상한을 못 넘는다 (감사 2.3 H1 해소).
//  - checkAmoraCostGuard: 읽기전용 체크 (레이스 가능). LLM 호출이 일어날지 불확실한
//    앞단 게이트(예: check-couple-conflict — 파트너 메시지마다 호출되나 대부분 LLM 0회)와
//    선행 UX 게이트용. 여기서 예약하면 LLM 없는 호출이 쿼터를 태우므로 예약 금지.
//
// 쿼터 단위는 사용자 상담 turn이다. 최초 카운터 시드는 과거
// ai_interactions_log.chat_turn에서 읽고, 이후에는 reserve RPC 카운터가 진실원본이다.
// 한 turn 안의 Luna/Terra provider 호출별 비용 행(amora_director)은 실제 비용
// 정산용이며 커플 무료 turn을 추가 차감하지 않는다.
// (chat_messages 기준은 두 번 기각: ①user 메시지 카운트는 파트너 메시지(비용 0)까지
// 깎아 부당 차단 ②AI 메시지 카운트는 isDemo 위조 시 저장 스킵으로 카운트 우회 가능)
// 카운터 테이블(amora_turn_counters)은 첫 접근 시 이 장부에서 자동 시드된다.
// DB 카운트라 서버리스에서도 정확. service_role로 RLS 우회.
//
// 커플 한도는 DB 검증 관리자에게, 전체 한도는 서버에서 확인한 팀 테스트 계정에
// 한해 면제한다. 클라이언트 body의 isDemo·면제 플래그는 신뢰하지 않는다.
// 팀도 비용 예약과 receipt 검증·정산을 거치며 사용량 장부는 그대로 남긴다.
//
// 환경변수로 조정 가능 (미설정 시 보수적 기본값):
//   AMORA_COUPLE_QUOTA_ENABLED=false (커플별 한도만 해제, 전역 가드는 유지)
//   AMORA_FREE_MESSAGES_PER_COUPLE (기본 50; 커플당 누적 무료 상한)
//   AMORA_GLOBAL_DAILY_MESSAGE_CAP (기본 300)
//   AMORA_GLOBAL_DAILY_COST_CAP_USD (기본 $20; provider 호출 전 최악 비용 예약)
//   AMORA_COUPLE_DAILY_CAP (기본 10; 커플당 **하루** 무료 상한)
//   AMORA_COUPLE_DAILY_CAP_ENABLED=false (하루 상한만 해제 — 무료 한도 스위치와 별개)
//   AMORA_COST_GUARD_ENABLED=false 로 완전 비활성(긴급 시)

import type { SupabaseClient } from "@supabase/supabase-js";

const POSTGRES_INT_MAX = 2_147_483_647;
const POSTGRES_BIGINT_SAFE_MAX = Number.MAX_SAFE_INTEGER;
export const DEFAULT_FREE_PER_COUPLE = 50;
const DEFAULT_GLOBAL_DAILY_CAP = 300;
const DEFAULT_GLOBAL_DAILY_COST_CAP_USD = 20;
/**
 * 커플 한 쌍이 **하루에** 무료로 쓸 수 있는 상담 턴(KST 자정 기준 리셋).
 *
 * 무료 이용자의 일일 사용량을 10회로 제한해 과도한 단일 커플 비용 소모를 막고,
 * 커플당 누적 무료 한도(기본 50회)와 함께 이중으로 지갑과 공정성을 지킨다.
 */
export const DEFAULT_COUPLE_DAILY_CAP = 10;
/**
 * 신규 가입자 무료 상담 제한 및 파트너 연결 보너스 정책 적용 기준 시각(UTC ISO).
 *
 * 이 시각 이전에 이미 생성된 기존 커플/계정(`couples.created_at < cutoff`)은
 * 기존 이용자 보호(Grandfathering)를 위해 커플당 일일·누적 무료 상담 제한에서 면제한다.
 * 이 시각 이후 가입한 계정부터 기본 무료 한도(일일 10회 / 누적 50회)가 적용되며,
 * 파트너를 초대해 연결하면 보너스 상담 횟수(일일 +5회, 누적 +30회)가 즉시 추가된다.
 */
export const DEFAULT_NEW_ACCOUNT_QUOTA_CUTOFF_ISO = "2026-10-20T14:00:00.000Z";
export const PARTNER_LINK_BONUS_LIFETIME_TURNS = 30;
export const PARTNER_LINK_BONUS_DAILY_TURNS = 5;
/**
 * 채팅 하단 무료 상담 소진 예고 배너를 띄우는 잔여 횟수 임계값(일일·누적 중 더 적은 잔여 횟수 기준).
 */
export const AMORA_QUOTA_WARNING_THRESHOLD = 5;
/**
 * 로그인 없이 하는 **체험**이 하루에 태울 수 있는 몫.
 *
 * ## 무엇이 문제였나
 *
 * 체험은 실사용자와 **같은 전역 하루 지갑**을 썼다. 게다가 커플당 하루 상한이
 * 체험에는 걸리지 않는다(`denyIfCoupleUsedTodayUp` 이 standard 가 아니면 즉시
 * null). 막는 것은 IP당 시간당 60회뿐이다.
 *
 * 그래서 출시 공지 후 구경하는 사람이 몰리면 **가입한 사람이 첫 메시지부터**
 * "오늘 아모라 상담이 많아 잠시 쉬어가고 있어요" 를 본다. 한국시간 자정까지
 * 풀리지 않는다. 제품이 가장 잘 보여야 하는 날에 정확히 그 확률이 올라간다.
 *
 * ## 어떻게 나누나
 *
 * 전역 카운터 키(`global:<KST날짜>`)는 RPC 안에 박혀 있어 지갑을 물리적으로 쪼개려면
 * 마이그레이션이 필요하다. 대신 **같은 카운터에 체험만 낮은 천장**을 넘긴다 —
 * RPC 가 `IF v_global_count >= p_global_cap` 으로 비교하므로
 * (`20260716097000_amora_atomic_cost_budget.sql:164`), 체험은 이 값에서 멈추고
 * 그 차이가 실사용자 몫으로 남는다.
 *
 * 부작용은 의도한 것이다: 하루가 바쁘면 **체험이 먼저 꺼진다.** 가입한 사람이
 * 밀려나는 것보다 낫고, 체험이 막힌 사람에게는 가입이라는 다음 걸음이 있다.
 *
 * ## 왜 장부를 세지 않나
 *
 * 커플당 하루 상한처럼 `ai_interactions_log` 를 세려 했는데 **체험은 그 표에
 * `couple_id` 를 남기지 않는다**(2026-08-26 운영 실측: 체험 합성 ID 로 조회하면
 * `chat_turn` 0건인데 `amora_turn_counters` 는 89턴). 그 방식이었으면 체험은
 * 영원히 0으로 세어져 상한이 한 번도 안 걸렸을 것이다.
 */
const DEFAULT_DEMO_GLOBAL_DAILY_CAP = 150;
const DEFAULT_DEMO_GLOBAL_DAILY_COST_CAP_USD = 4;

function readPositivePostgresInteger(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const parsed = Number(raw);
  if (
    Number.isSafeInteger(parsed)
    && parsed > 0
    && parsed <= POSTGRES_INT_MAX
  ) {
    return parsed;
  }
  // 잘못된 배포 설정이 NaN 비교로 상한을 사실상 해제하거나 RPC int4 오류로
  // 전체 장애를 만들지 않도록, 작고 검증된 기본 상한으로 되돌린다.
  console.error(`[costGuard] invalid ${name}; using safe default`);
  return fallback;
}

function readPositiveUsdMicros(name: string, fallbackUsd: number): number {
  const raw = process.env[name];
  const fallback = Math.round(fallbackUsd * 1_000_000);
  if (raw === undefined || raw.trim() === "") return fallback;
  const parsed = Number(raw);
  const micros = Math.floor(parsed * 1_000_000);
  if (
    Number.isFinite(parsed)
    && parsed > 0
    && Number.isSafeInteger(micros)
    && micros > 0
  ) {
    return micros;
  }
  console.error(`[costGuard] invalid ${name}; using safe default`);
  return fallback;
}

const FREE_PER_COUPLE = readPositivePostgresInteger(
  "AMORA_FREE_MESSAGES_PER_COUPLE",
  DEFAULT_FREE_PER_COUPLE,
);
const GLOBAL_DAILY_CAP = readPositivePostgresInteger(
  "AMORA_GLOBAL_DAILY_MESSAGE_CAP",
  DEFAULT_GLOBAL_DAILY_CAP,
);
const GLOBAL_DAILY_COST_CAP_MICROUSD = readPositiveUsdMicros(
  "AMORA_GLOBAL_DAILY_COST_CAP_USD",
  DEFAULT_GLOBAL_DAILY_COST_CAP_USD,
);
const COUPLE_DAILY_CAP = readPositivePostgresInteger(
  "AMORA_COUPLE_DAILY_CAP",
  DEFAULT_COUPLE_DAILY_CAP,
);
const DEMO_GLOBAL_DAILY_CAP = readPositivePostgresInteger(
  "AMORA_DEMO_GLOBAL_DAILY_CAP",
  DEFAULT_DEMO_GLOBAL_DAILY_CAP,
);
const DEMO_GLOBAL_DAILY_COST_CAP_MICROUSD = readPositiveUsdMicros(
  "AMORA_DEMO_GLOBAL_DAILY_COST_CAP_USD",
  DEFAULT_DEMO_GLOBAL_DAILY_COST_CAP_USD,
);

function readCutoffTimestampMs(name: string, fallbackIso: string): number {
  const raw = process.env[name];
  if (raw && raw.trim() !== "") {
    const parsed = Date.parse(raw.trim());
    if (Number.isFinite(parsed)) return parsed;
    console.error(`[costGuard] invalid ${name}; using safe default cutoff`);
  }
  return Date.parse(fallbackIso);
}

const NEW_ACCOUNT_QUOTA_CUTOFF_MS = readCutoffTimestampMs(
  "AMORA_NEW_ACCOUNT_QUOTA_CUTOFF_ISO",
  DEFAULT_NEW_ACCOUNT_QUOTA_CUTOFF_ISO,
);

export interface CoupleQuotaPolicy {
  /** 기준 시각 이전에 생성된 기존 계정/커플 여부 (true면 커플 일일·누적 제한 면제) */
  isGrandfathered: boolean;
  /** 파트너 초대·연결 완료 여부 (신규 계정이 파트너 연결 시 보너스 턴 부여) */
  isPartnerLinked: boolean;
  /** 적용할 누적 무료 상담 상한 */
  lifetimeCap: number;
  /** 적용할 일일 무료 상담 상한 */
  dailyCap: number;
}

/**
 * 커플 생성 시각(`created_at`)과 파트너 연결 상태(`bride_id`, `groom_id`, `membership_sealed_at`)를 읽어
 * 기존 가입 계정 면제(Grandfathering) 및 신규 계정 파트너 초대 보너스(+30회 / 일일 +5회)를 판정한다.
 *
 * 조회 실패 시(또는 단위 테스트 목에 `couples.maybeSingle`이 없을 때)에는 안전하게
 * 신규 기본 정책(일일 10회 / 누적 50회)으로 폴백한다.
 */
export async function resolveCoupleQuotaPolicy(
  admin: SupabaseClient,
  coupleId: string,
): Promise<CoupleQuotaPolicy> {
  const defaultPolicy: CoupleQuotaPolicy = {
    isGrandfathered: false,
    isPartnerLinked: false,
    lifetimeCap: FREE_PER_COUPLE,
    dailyCap: COUPLE_DAILY_CAP,
  };
  try {
    const { data, error } = await admin
      .from("couples")
      .select("created_at, bride_id, groom_id, membership_sealed_at")
      .eq("id", coupleId)
      .maybeSingle();
    if (error || !data || typeof data !== "object") {
      return defaultPolicy;
    }
    const row = data as {
      created_at?: unknown;
      bride_id?: unknown;
      groom_id?: unknown;
      membership_sealed_at?: unknown;
    };
    const isPartnerLinked =
      (typeof row.membership_sealed_at === "string" && row.membership_sealed_at.length > 0)
      || (
        typeof row.bride_id === "string"
        && row.bride_id.length > 0
        && typeof row.groom_id === "string"
        && row.groom_id.length > 0
      );

    if (typeof row.created_at === "string" && row.created_at.length > 0) {
      const createdAtMs = Date.parse(row.created_at);
      if (Number.isFinite(createdAtMs) && createdAtMs < NEW_ACCOUNT_QUOTA_CUTOFF_MS) {
        return {
          isGrandfathered: true,
          isPartnerLinked,
          lifetimeCap: POSTGRES_INT_MAX,
          dailyCap: POSTGRES_INT_MAX,
        };
      }
    }

    const lifetimeCap = isPartnerLinked
      ? Math.min(POSTGRES_INT_MAX, FREE_PER_COUPLE + PARTNER_LINK_BONUS_LIFETIME_TURNS)
      : FREE_PER_COUPLE;
    const dailyCap = isPartnerLinked
      ? Math.min(POSTGRES_INT_MAX, COUPLE_DAILY_CAP + PARTNER_LINK_BONUS_DAILY_TURNS)
      : COUPLE_DAILY_CAP;

    return {
      isGrandfathered: false,
      isPartnerLinked,
      lifetimeCap,
      dailyCap,
    };
  } catch {
    return defaultPolicy;
  }
}

/**
 * 체험이 볼 천장. 실사용자보다 **낮을 때만** 뜻이 있으므로 더 낮은 쪽을 쓴다.
 *
 * 설정을 잘못해 체험 몫이 전역보다 커지면 분리가 사라지는데, 그건 조용히
 * 일어나면 안 된다 — `Math.min` 으로 막고 시작 로그에 실제 적용값을 찍는다.
 */
export function resolveGlobalCaps(input: {
  quotaScope: string | undefined;
  globalTurns: number;
  globalCostMicrousd: number;
  demoTurns: number;
  demoCostMicrousd: number;
}): { turns: number; costMicrousd: number } {
  if (input.quotaScope !== "demo") {
    return { turns: input.globalTurns, costMicrousd: input.globalCostMicrousd };
  }
  return {
    turns: Math.min(input.demoTurns, input.globalTurns),
    costMicrousd: Math.min(input.demoCostMicrousd, input.globalCostMicrousd),
  };
}

function globalCapsFor(quotaScope: string | undefined): {
  turns: number;
  costMicrousd: number;
} {
  return resolveGlobalCaps({
    quotaScope,
    globalTurns: GLOBAL_DAILY_CAP,
    globalCostMicrousd: GLOBAL_DAILY_COST_CAP_MICROUSD,
    demoTurns: DEMO_GLOBAL_DAILY_CAP,
    demoCostMicrousd: DEMO_GLOBAL_DAILY_COST_CAP_MICROUSD,
  });
}
const GUARD_ENABLED = process.env.AMORA_COST_GUARD_ENABLED !== "false";
// **꺼져 있으면 그 사실이 보여야 한다.**
//
// 이 스위치는 긴급용이다 — 켜면 커플 한도·전역 일일 상한·전역 비용 상한이
// 전부 무효가 되고 지갑에 천장이 없어진다. 그런데 꺼진 상태는 아무 데도
// 나타나지 않았다.
//
// 2026-08-25: 하루 상한을 세 번 만들어 세 번 배포했는데 운영에서 한 번도
// 동작하지 않았다. 스위치·호출 경로를 차례로 의심하다 마지막에 남은 것이
// 이것이었다. 조건을 하나씩 지워 낼 때까지 아무 단서도 없었다.
if (!GUARD_ENABLED) {
  console.error("[costGuard] DISABLED — 커플 한도·전역 일일 상한·전역 비용 상한이 모두 무효입니다 (AMORA_COST_GUARD_ENABLED=false)");
}
const COUPLE_QUOTA_ENABLED = process.env.AMORA_COUPLE_QUOTA_ENABLED !== "false";
// 하루 상한은 **무료 한도와 다른 것을 지킨다.**
//
// `AMORA_COUPLE_QUOTA_ENABLED=false` 는 베타에서 무료 턴 제한을 없애려고
// 켠 스위치다(운영 실측: 커플 카운터 710·397·193턴, 기본 한도 100). 그런데
// 처음에 하루 상한을 그 스위치에 묶어서, **배선하고 배포했는데 아무 일도 안
// 하는 상태**로 나갔다(2026-08-25 라이브에서 잡음).
//
// 무료 턴을 얼마나 주느냐는 요금 결정이고, 한 커플이 전 서비스를 멈추지
// 못하게 하는 것은 가용성 결정이다. 스위치를 따로 둔다.
const COUPLE_DAILY_CAP_ENABLED = process.env.AMORA_COUPLE_DAILY_CAP_ENABLED !== "false";

// **지금 걸려 있는 값을 한 번은 말한다.**
//
// 이 상한들은 Vercel 에서 Sensitive 로 저장돼 있어 **값을 되읽을 수 없다**.
// 그래서 "공개 규모에 이 값이 맞는가" 를 아무도 답할 수 없었다 — 바꾸려면
// 무엇을 바꾸는지 모르는 채로 덮어써야 했다.
//
// 2026-08-25: 하루 상한이 안 먹는 원인을 찾느라 세 번 배포하고 네 번 눌러
// 봤는데, 값이 보였다면 첫 번째에 알았다. 비밀이 아니라 **설정 숫자**다.
//
// 서버에서만 찍는다. Vercel 함수 로그에서 `[costGuard] config` 로 찾는다.
console.info("[costGuard] config", {
  guardEnabled: GUARD_ENABLED,
  coupleLifetimeQuota: COUPLE_QUOTA_ENABLED ? FREE_PER_COUPLE : "off",
  coupleDailyCap: COUPLE_DAILY_CAP_ENABLED ? COUPLE_DAILY_CAP : "off",
  globalDailyTurns: GLOBAL_DAILY_CAP,
  globalDailyCostUsd: GLOBAL_DAILY_COST_CAP_MICROUSD / 1_000_000,
  // 턴당 실측 $0.027(2026-08-25 운영 5일치) 로 나눈 값. 비용 상한이 먼저
  // 걸리는지 턴 상한이 먼저 걸리는지 바로 보인다.
  costCapReachedAtTurns: Math.floor(GLOBAL_DAILY_COST_CAP_MICROUSD / 27_000),
  // 체험 몫. 실사용자에게 남는 것은 globalDailyTurns - demoGlobalTurns 다.
  demoGlobalTurns: Math.min(DEMO_GLOBAL_DAILY_CAP, GLOBAL_DAILY_CAP),
  demoGlobalCostUsd: Math.min(
    DEMO_GLOBAL_DAILY_COST_CAP_MICROUSD,
    GLOBAL_DAILY_COST_CAP_MICROUSD,
  ) / 1_000_000,
});
// Keep the atomic global reservation when the per-couple quota is disabled.
// The RPC parameter is PostgreSQL INTEGER, so the sentinel must stay within int4.
const DISABLED_COUPLE_CAP = POSTGRES_INT_MAX;
// 자동 갈등 감지처럼 사용자 상담 응답이 아닌 provider 호출은 전역 비용 상한에는
// 포함하되 실제 커플의 무료 상담 카운터를 깎지 않는다. RPC는 UUID 형식만 요구하고
// counter table에 FK가 없으므로 별도 synthetic ledger key를 안전하게 쓸 수 있다.
const BACKGROUND_COST_LEDGER_COUPLE_ID = "00000000-0000-4000-8000-000000000002";

export interface CostGuardResult {
  allowed: boolean;
  reason?: "couple_quota" | "couple_daily" | "global_daily" | "global_budget" | "guard_unavailable";
  message?: string;
  /** 커플 무료 상담 잔여 횟수 — 예약 성공 시에만 채워짐(소진 예고 UX용). 실패해도 undefined일 뿐 차단과 무관. */
  remaining?: number;
}

export class AmoraCostGuardError extends Error {
  readonly code: string;

  constructor(readonly result: CostGuardResult) {
    super(result.message ?? "AMORA_COST_GUARD_BLOCKED");
    this.name = "AmoraCostGuardError";
    this.code = result.reason === "couple_quota"
      ? "COST_GUARD_COUPLE_QUOTA"
      : result.reason === "couple_daily"
        ? "COST_GUARD_COUPLE_DAILY"
      : result.reason === "global_daily"
        ? "COST_GUARD_GLOBAL_DAILY"
        : result.reason === "global_budget"
          ? "COST_GUARD_GLOBAL_BUDGET"
          : "COST_GUARD_UNAVAILABLE";
  }
}

type CostGuardParams = {
  coupleId: string;
  isAdmin: boolean;
  /** 인증 사용자와 서버 허용 목록으로만 판정한다. 요청 body의 값을 전달하지 않는다. */
  isQuotaExempt?: boolean;
  /** Demo/release-eval/background calls bypass couple quota, never global cost. */
  quotaScope?: "standard" | "demo" | "release_eval" | "background";
};

type ReserveCostGuardParams = CostGuardParams & {
  /** Conservative maximum provider cost for this logical reservation. */
  maxCostMicrousd: number;
};

export type ReserveProviderCallParams = ReserveCostGuardParams & {
  receiptId: string;
  claimToken: string;
  requestKey: string;
};

const ALLOW: CostGuardResult = { allowed: true };

const DENY_GLOBAL: CostGuardResult = {
  allowed: false,
  reason: "global_daily",
  message:
    "오늘 아모라 상담이 많아 잠시 쉬어가고 있어요. 내일 다시 이어서 도와드릴게요.",
};

// 사용자에게는 위 `DENY_GLOBAL` 과 **같은 상황**이다 — 서비스 전체가 오늘 천장에
// 닿았고, 카운터 키가 `global:YYYY-MM-DD` 라 한국 시간 자정에 풀린다. 우리에게만
// 원인이 다르고(턴 수 vs 비용) 그 구분은 `reason` 필드가 진다.
//
// 예전 문구는 "안전 예산에 도달해 … **잠시 후** 다시 시도해 주세요" 였다. 두 군데가
// 틀렸다. "안전 예산" 은 우리 내부 용어라 읽는 사람이 무슨 말인지 모르고, 자정까지
// 몇 시간이 남았는데 "잠시 후" 라고 해서 사용자를 헛되이 다시 누르게 만든다.
const DENY_GLOBAL_BUDGET: CostGuardResult = {
  allowed: false,
  reason: "global_budget",
  message:
    "오늘 아모라 상담이 많아 잠시 쉬어가고 있어요. 내일 다시 이어서 도와드릴게요.",
};

const DENY_COUPLE: CostGuardResult = {
  allowed: false,
  reason: "couple_quota",
  message:
    "이 커플에 제공된 무료 아모라 상담을 모두 사용했어요. 아직 파트너를 연결하지 않았다면 설정에서 파트너 초대 코드를 연결해 보너스 상담(+30회)을 즉시 받을 수 있어요. 예산·체크리스트·일정·견적 진단 등 웨딩 준비 워크스페이스는 계속 무료로 이용하실 수 있어요.",
};

const DENY_COUPLE_DAILY: CostGuardResult = {
  allowed: false,
  reason: "couple_daily",
  message:
    "오늘 무료로 제공되는 아모라 상담(기본 하루 10회, 파트너 연결 시 15회)을 모두 사용했어요. 내일 자정(KST)에 다시 이어서 도와드릴게요. 아직 파트너를 연결하지 않았다면 설정에서 파트너 연결 시 일일 한도와 누적 보너스(+30회)가 즉시 늘어나며, 예산·체크리스트·일정·견적 진단 기능은 지금도 자유롭게 이용하실 수 있어요.",
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
// RPC 미배포/실패 시 fail closed. 읽기전용 카운트는 동시 요청 사이에서 같은
// 여유분을 관측하므로 provider 직전 안전 게이트를 대체할 수 없다.
export async function reserveAmoraTurn(
  admin: SupabaseClient,
  params: ReserveCostGuardParams,
): Promise<CostGuardResult> {
  // 팀 예외는 긴급 전체 해제와 달리 검증과 원자 예약을 항상 유지한다.
  if (!GUARD_ENABLED && params.isQuotaExempt !== true) return ALLOW;
  if (
    !Number.isSafeInteger(params.maxCostMicrousd)
    || params.maxCostMicrousd < 1
  ) {
    console.error("[costGuard] invalid maxCostMicrousd; blocking provider call");
    return DENY_UNAVAILABLE;
  }
  const enforceCaps = GUARD_ENABLED && params.isQuotaExempt !== true;
  const isStandardCoupleCheck =
    enforceCaps
    && !params.isAdmin
    && (params.quotaScope ?? "standard") === "standard";
  const couplePolicy = isStandardCoupleCheck
    ? await resolveCoupleQuotaPolicy(admin, params.coupleId)
    : null;
  const appliesCoupleQuota =
    isStandardCoupleCheck
    && COUPLE_QUOTA_ENABLED
    && couplePolicy?.isGrandfathered !== true;
  const coupleCap = appliesCoupleQuota
    ? (couplePolicy?.lifetimeCap ?? FREE_PER_COUPLE)
    : DISABLED_COUPLE_CAP;
  const ledgerCoupleId = params.quotaScope === "background"
    ? BACKGROUND_COST_LEDGER_COUPLE_ID
    : params.coupleId;

  // **한 커플이 전역 상한을 혼자 태우지 못하게 한다.**
  //
  // 전역 상한만 있으면 그것은 한 사람이 당길 수 있는 전 서비스 킬 스위치다.
  // 커플당 무료 한도는 평생 기준이라 하루치를 막지 못한다.
  // 2026-08-25 실측: 24시간에 한 커플이 158턴을 썼다.
  //
  // 세는 데 실패하면 **통과시킨다.** 이 한도는 공정성이지 지갑이 아니고,
  // 지갑은 아래 RPC 의 전역 비용 상한이 원자적으로 지킨다. 장부 조회 실패로
  // 정상 사용자를 막는 쪽이 더 나쁘다.
  const dailyCheck = await checkCoupleDailyUsage(admin, params, couplePolicy);
  if (dailyCheck.denied) return dailyCheck.denied;

  try {
    // 체험은 실사용자보다 낮은 천장을 본다 — 같은 카운터를 쓰되 먼저 멈춘다.
    const caps = globalCapsFor(params.quotaScope);
    const { data, error } = await admin.rpc("reserve_amora_turn", {
      p_couple_id: ledgerCoupleId,
      p_couple_cap: coupleCap,
      p_global_cap: enforceCaps ? caps.turns : POSTGRES_INT_MAX,
      p_reserve_cost_microusd: params.maxCostMicrousd,
      p_global_cost_cap_microusd: enforceCaps
        ? caps.costMicrousd
        : POSTGRES_BIGINT_SAFE_MAX,
    });
    if (error) {
      console.error("[costGuard] 원자 예약 실패 (차단):", error.message);
      return DENY_UNAVAILABLE;
    }

    const row = Array.isArray(data) ? data[0] : data;
    if (row?.allowed === true) {
      // 소진 예고용 잔여 횟수 — 예약 직후 카운터 PK 조회(비원자여도 배너 용도라 충분).
      // 누적 잔여 횟수와 오늘 잔여 횟수 중 더 적은 쪽을 돌려준다.
      const lifetimeRemaining = appliesCoupleQuota
        ? await readCoupleRemaining(admin, params.coupleId, coupleCap)
        : undefined;
      return {
        allowed: true,
        remaining:
          lifetimeRemaining !== undefined && dailyCheck.dailyRemaining !== undefined
            ? Math.min(lifetimeRemaining, dailyCheck.dailyRemaining)
            : lifetimeRemaining,
      };
    }
    if (row?.reason === "global_daily") return DENY_GLOBAL;
    if (row?.reason === "global_daily_budget") return DENY_GLOBAL_BUDGET;
    if (row?.reason === "couple_quota" && appliesCoupleQuota) return DENY_COUPLE;

    // Unknown reservation state must never create an unmetered provider call.
    console.error("[costGuard] 예약 RPC 응답 형태 불명 (차단):", JSON.stringify(row ?? null));
    return DENY_UNAVAILABLE;
  } catch (err) {
    console.error("[costGuard] 원자 예약 예외 (차단):", err);
    return DENY_UNAVAILABLE;
  }
}

/**
 * 오늘(KST) 이 커플이 쓴 상담 턴 수.
 *
 * 전역 예약 RPC 안이 아니라 그 앞에서 센다. 원자적이지 않지만 이 한도의
 * 목적은 지갑이 아니라 **공정성**이다 — 경합으로 한두 턴이 더 나가도 상관없다.
 * 돈을 지키는 것은 전역 비용 상한이고 그건 여전히 RPC 안에서 원자적이다.
 *
 * RPC 자신이 같은 장부에서 카운터를 시드한다(`ai_interactions_log` 의
 * `chat_turn`). 인덱스 `(couple_id, created_at DESC)` 가 있다.
 */
async function countCoupleTurnsToday(
  admin: SupabaseClient,
  coupleId: string,
): Promise<number | null> {
  // KST 자정. 서버는 UTC 라 직접 만든다.
  const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
  const nowKst = new Date(Date.now() + KST_OFFSET_MS);
  const startKstMidnightUtc = new Date(
    Date.UTC(nowKst.getUTCFullYear(), nowKst.getUTCMonth(), nowKst.getUTCDate())
      - KST_OFFSET_MS,
  );
  try {
    const { count, error } = await admin
      .from("ai_interactions_log")
      .select("id", { count: "exact", head: true })
      .eq("couple_id", coupleId)
      .eq("interaction_type", "chat_turn")
      .gte("created_at", startKstMidnightUtc.toISOString());
    if (error) return null;
    return typeof count === "number" ? count : null;
  } catch {
    return null;
  }
}

/**
 * 오늘 몫을 다 썼으면 거부 결과를, 아니면 이번 턴을 포함한 오늘 잔여 횟수를 준다.
 *
 * **두 예약 경로가 같은 규칙을 쓰게 하려고 뽑았다.** 처음에는
 * `reserveAmoraTurn` 에만 넣었는데 **채팅은 그 함수를 부르지 않는다** —
 * 채팅은 `reserveAmoraProviderCall` 을 탄다(`amoraProviderCallLedger` 경유).
 * 그래서 만들고 배포까지 했는데 주 제품에서 아무 일도 하지 않았다
 * (2026-08-25 라이브에서 138턴 커플이 통과하는 것을 보고 알았다).
 *
 * 한 턴에 provider 호출이 평균 1.3회라(운영 실측 221턴 / 281호출) 이 검사가
 * 턴당 여러 번 돈다. 세는 대상이 `chat_turn` 이라 결과는 같으므로 무해하다.
 * 경계에서 진행 중인 턴이 잘릴 수 있으나, 그때 사용자는 이유가 적힌 문구를 본다.
 */
async function checkCoupleDailyUsage(
  admin: SupabaseClient,
  params: CostGuardParams,
  preloadedPolicy?: CoupleQuotaPolicy | null,
): Promise<{ denied: CostGuardResult | null; dailyRemaining?: number }> {
  const applies =
    GUARD_ENABLED
    && params.isQuotaExempt !== true
    && !params.isAdmin
    && (params.quotaScope ?? "standard") === "standard"
    && COUPLE_DAILY_CAP_ENABLED;
  if (!applies) return { denied: null };
  const policy = preloadedPolicy ?? await resolveCoupleQuotaPolicy(admin, params.coupleId);
  if (policy.isGrandfathered) return { denied: null };
  const usedToday = await countCoupleTurnsToday(admin, params.coupleId);
  if (usedToday === null) return { denied: null };
  if (usedToday >= policy.dailyCap) {
    return { denied: DENY_COUPLE_DAILY };
  }
  return {
    denied: null,
    dailyRemaining: Math.max(0, policy.dailyCap - (usedToday + 1)),
  };
}

// 예약 성공 직후 커플 잔여 무료 턴 수 조회 (PK 단건 — 카운터에 이번 예약이 이미 반영됨)
/**
 * Reserves one provider-call receipt. This counts the logical request once and
 * reserves only the current generation maximum. Finalization later replaces
 * the reservation with actual usage. Receipt reservation remains mandatory
 * when caps are disabled so every paid call still has a settlement boundary.
 */
export async function reserveAmoraProviderCall(
  admin: SupabaseClient,
  params: ReserveProviderCallParams,
): Promise<CostGuardResult> {
  const uuidPattern =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (
    !Number.isSafeInteger(params.maxCostMicrousd)
    || params.maxCostMicrousd < 1
    || !uuidPattern.test(params.receiptId)
    || !uuidPattern.test(params.claimToken)
    || !/^[A-Za-z0-9_.:-]{1,240}$/.test(params.requestKey)
  ) {
    console.error("[costGuard] invalid provider receipt reservation; blocking call");
    return DENY_UNAVAILABLE;
  }

  const enforceCaps = GUARD_ENABLED && params.isQuotaExempt !== true;
  const isStandardCoupleCheck =
    enforceCaps
    && !params.isAdmin
    && (params.quotaScope ?? "standard") === "standard";
  const couplePolicy = isStandardCoupleCheck
    ? await resolveCoupleQuotaPolicy(admin, params.coupleId)
    : null;

  // **채팅이 실제로 타는 경로다.** 같은 하루 상한을 여기에도 건다.
  const dailyCheck = await checkCoupleDailyUsage(admin, params, couplePolicy);
  if (dailyCheck.denied) return dailyCheck.denied;

  const appliesCoupleQuota =
    isStandardCoupleCheck
    && COUPLE_QUOTA_ENABLED
    && couplePolicy?.isGrandfathered !== true;
  const coupleCap = appliesCoupleQuota
    ? (couplePolicy?.lifetimeCap ?? FREE_PER_COUPLE)
    : DISABLED_COUPLE_CAP;
  const ledgerCoupleId = params.quotaScope === "background"
    ? BACKGROUND_COST_LEDGER_COUPLE_ID
    : params.coupleId;
  // 체험은 실사용자보다 낮은 천장을 본다 — 같은 카운터를 쓰되 먼저 멈춘다.
  const providerCaps = globalCapsFor(params.quotaScope);

  try {
    const { data, error } = await admin.rpc("reserve_amora_provider_call", {
      p_receipt_id: params.receiptId,
      p_claim_token: params.claimToken,
      p_request_key: params.requestKey,
      p_cost_couple_id: ledgerCoupleId,
      p_couple_cap: coupleCap,
      p_global_cap: enforceCaps ? providerCaps.turns : POSTGRES_INT_MAX,
      p_reserve_cost_microusd: params.maxCostMicrousd,
      p_global_cost_cap_microusd: enforceCaps
        ? providerCaps.costMicrousd
        : POSTGRES_BIGINT_SAFE_MAX,
    });
    if (error) {
      console.error(
        "[costGuard] provider receipt reservation failed (blocked):",
        error.message,
      );
      return DENY_UNAVAILABLE;
    }

    const row = Array.isArray(data) ? data[0] : data;
    if (row?.allowed === true) {
      const lifetimeRemaining =
        appliesCoupleQuota && typeof row.remaining === "number"
          ? Math.max(0, row.remaining)
          : undefined;
      return {
        allowed: true,
        remaining:
          lifetimeRemaining !== undefined && dailyCheck.dailyRemaining !== undefined
            ? Math.min(lifetimeRemaining, dailyCheck.dailyRemaining)
            : lifetimeRemaining,
      };
    }
    if (row?.reason === "global_daily") return DENY_GLOBAL;
    if (row?.reason === "global_daily_budget") return DENY_GLOBAL_BUDGET;
    if (row?.reason === "couple_quota" && appliesCoupleQuota) return DENY_COUPLE;

    console.error(
      "[costGuard] provider receipt reservation state unknown (blocked):",
      JSON.stringify(row ?? null),
    );
    return DENY_UNAVAILABLE;
  } catch (err) {
    console.error(
      "[costGuard] provider receipt reservation exception (blocked):",
      err,
    );
    return DENY_UNAVAILABLE;
  }
}

async function readCoupleRemaining(
  admin: SupabaseClient,
  coupleId: string,
  lifetimeCap: number = FREE_PER_COUPLE,
): Promise<number | undefined> {
  try {
    const { data } = await admin
      .from("amora_turn_counters")
      .select("count")
      .eq("key", `couple:${coupleId}`)
      .maybeSingle();
    if (typeof data?.count === "number") {
      return Math.max(0, lifetimeCap - data.count);
    }
  } catch {
    // 배너용 조회 실패는 무시
  }
  return undefined;
}

// 커플 단위로 아모라 사용 가능 여부 판정. LLM 턴 로그 수로 비용을 추정.
export async function checkAmoraCostGuard(
  admin: SupabaseClient,
  params: CostGuardParams,
): Promise<CostGuardResult> {
  if (!GUARD_ENABLED || params.isQuotaExempt === true) return ALLOW;

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

  if (
    params.isAdmin
    || !COUPLE_QUOTA_ENABLED
    || (params.quotaScope ?? "standard") !== "standard"
  ) {
    return ALLOW;
  }

  const couplePolicy = await resolveCoupleQuotaPolicy(admin, params.coupleId);
  if (couplePolicy.isGrandfathered) {
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
  if ((coupleTotal ?? 0) >= couplePolicy.lifetimeCap) {
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
