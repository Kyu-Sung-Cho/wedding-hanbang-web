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
// ⚠️ 면제는 is_admin(DB 검증)만. 클라이언트가 보내는 값(body의 isDemo 등)으로
// 면제하면 안 됨 — 인증 유저가 그 값을 조작해 가드를 우회할 수 있다.
//
// 환경변수로 조정 가능 (미설정 시 보수적 기본값):
//   AMORA_COUPLE_QUOTA_ENABLED=false (커플별 한도만 해제, 전역 가드는 유지)
//   AMORA_FREE_MESSAGES_PER_COUPLE (기본 100)
//   AMORA_GLOBAL_DAILY_MESSAGE_CAP (기본 300)
//   AMORA_GLOBAL_DAILY_COST_CAP_USD (기본 $20; provider 호출 전 최악 비용 예약)
//   AMORA_COUPLE_DAILY_CAP (기본 80; 커플당 **하루** 상한)
//   AMORA_COST_GUARD_ENABLED=false 로 완전 비활성(긴급 시)

import type { SupabaseClient } from "@supabase/supabase-js";

const POSTGRES_INT_MAX = 2_147_483_647;
const POSTGRES_BIGINT_SAFE_MAX = Number.MAX_SAFE_INTEGER;
const DEFAULT_FREE_PER_COUPLE = 100;
const DEFAULT_GLOBAL_DAILY_CAP = 300;
const DEFAULT_GLOBAL_DAILY_COST_CAP_USD = 20;
/**
 * 커플 한 쌍이 **하루에** 쓸 수 있는 상담 턴.
 *
 * 전역 상한만 있으면 그것은 한 사람이 당길 수 있는 **전 서비스 킬 스위치**다.
 * 커플당 누적 무료 한도는 평생 기준이라 하루치를 막지 못한다.
 *
 * 2026-08-25 운영 실측: 24시간 동안 한 커플이 158턴을 썼다. 전역 기본 상한이
 * 300이므로 그런 사용자 둘이면 그날 **모든 사용자**가 막힌다.
 *
 * 80은 사람이 하루에 쓰기엔 넉넉하고(실측 두 번째 커플 67턴), 한 쌍이 전역
 * 상한을 혼자 태우지는 못하는 값이다.
 */
const DEFAULT_COUPLE_DAILY_CAP = 80;

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
const GUARD_ENABLED = process.env.AMORA_COST_GUARD_ENABLED !== "false";
const COUPLE_QUOTA_ENABLED = process.env.AMORA_COUPLE_QUOTA_ENABLED !== "false";
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
    "오늘 아모라 상담이 많아 잠시 쉬어가고 있어요. 내일 다시 이어서 도와드릴게요. (베타 기간 한도)",
};

const DENY_GLOBAL_BUDGET: CostGuardResult = {
  allowed: false,
  reason: "global_budget",
  message:
    "오늘 아모라의 안전 예산에 도달해 현재는 상담을 시작할 수 없어요. 잠시 후 다시 시도해 주세요.",
};

const DENY_COUPLE: CostGuardResult = {
  allowed: false,
  reason: "couple_quota",
  message:
    "이 커플에 제공된 베타 무료 상담 한도를 모두 사용했어요. 추가 이용 방법과 시점은 아직 정해지지 않았어요.",
};

const DENY_COUPLE_DAILY: CostGuardResult = {
  allowed: false,
  reason: "couple_daily",
  message:
    "오늘 이 대화에서 쓸 수 있는 상담 횟수를 다 썼어요. 내일 다시 이어서 도와드릴게요.",
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
  if (!GUARD_ENABLED) return ALLOW;
  if (
    !Number.isSafeInteger(params.maxCostMicrousd)
    || params.maxCostMicrousd < 1
  ) {
    console.error("[costGuard] invalid maxCostMicrousd; blocking provider call");
    return DENY_UNAVAILABLE;
  }
  const appliesCoupleQuota =
    !params.isAdmin
    && (params.quotaScope ?? "standard") === "standard"
    && COUPLE_QUOTA_ENABLED;
  const coupleCap = appliesCoupleQuota ? FREE_PER_COUPLE : DISABLED_COUPLE_CAP;
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
  if (appliesCoupleQuota) {
    const usedToday = await countCoupleTurnsToday(admin, params.coupleId);
    if (usedToday !== null && usedToday >= COUPLE_DAILY_CAP) {
      return DENY_COUPLE_DAILY;
    }
  }

  try {
    const { data, error } = await admin.rpc("reserve_amora_turn", {
      p_couple_id: ledgerCoupleId,
      p_couple_cap: coupleCap,
      p_global_cap: GLOBAL_DAILY_CAP,
      p_reserve_cost_microusd: params.maxCostMicrousd,
      p_global_cost_cap_microusd: GLOBAL_DAILY_COST_CAP_MICROUSD,
    });
    if (error) {
      console.error("[costGuard] 원자 예약 실패 (차단):", error.message);
      return DENY_UNAVAILABLE;
    }

    const row = Array.isArray(data) ? data[0] : data;
    if (row?.allowed === true) {
      // 소진 예고용 잔여 횟수 — 예약 직후 카운터 PK 조회(비원자여도 배너 용도라 충분).
      // 조회 실패는 remaining만 비울 뿐 통과 여부에 영향 없음.
      return {
        allowed: true,
        remaining: appliesCoupleQuota
          ? await readCoupleRemaining(admin, params.coupleId)
          : undefined,
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

  const appliesCoupleQuota =
    GUARD_ENABLED
    && !params.isAdmin
    && (params.quotaScope ?? "standard") === "standard"
    && COUPLE_QUOTA_ENABLED;
  const coupleCap = appliesCoupleQuota ? FREE_PER_COUPLE : DISABLED_COUPLE_CAP;
  const ledgerCoupleId = params.quotaScope === "background"
    ? BACKGROUND_COST_LEDGER_COUPLE_ID
    : params.coupleId;

  try {
    const { data, error } = await admin.rpc("reserve_amora_provider_call", {
      p_receipt_id: params.receiptId,
      p_claim_token: params.claimToken,
      p_request_key: params.requestKey,
      p_cost_couple_id: ledgerCoupleId,
      p_couple_cap: coupleCap,
      p_global_cap: GUARD_ENABLED ? GLOBAL_DAILY_CAP : POSTGRES_INT_MAX,
      p_reserve_cost_microusd: params.maxCostMicrousd,
      p_global_cost_cap_microusd: GUARD_ENABLED
        ? GLOBAL_DAILY_COST_CAP_MICROUSD
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
      return {
        allowed: true,
        remaining: appliesCoupleQuota && typeof row.remaining === "number"
          ? Math.max(0, row.remaining)
          : undefined,
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
  params: CostGuardParams,
): Promise<CostGuardResult> {
  if (!GUARD_ENABLED) return ALLOW;

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
