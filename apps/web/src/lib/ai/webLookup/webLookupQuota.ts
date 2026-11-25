import type { SupabaseClient } from "@supabase/supabase-js";

import { getAmoraGlobalDailyCostCap } from "@/lib/ai/costGuard";
import { coupleDailyWebLookupCap, globalDailyWebLookupCap } from "@/lib/ai/webLookup/webLookupConfig";
import { ymdInKst } from "@/lib/utils/kstDate";

/**
 * 인터넷 찾기 하루 한도(D-88). 커플당 하루 30회, 서비스 전체 하루 상한, 그리고 그날의 하루 금액 상한.
 *
 * 새 표를 만들지 않는다. 비용 가드가 쓰는 `amora_turn_counters`(키·개수 표, service_role 전용)에
 * 날짜가 든 새 키로 센다. 비용 가드의 키(`couple:<uuid>`, `global:<날짜>`)와 겹치지 않는다.
 *
 *     web_lookup:couple:<커플 uuid>:<KST 날짜>
 *     web_lookup:global:<KST 날짜>
 *
 * 올리는 법은 "읽은 개수가 그대로일 때만 +1"(비교 후 교체)이다. 같은 커플의 두 요청이 동시에
 * 와도 한도를 넘지 않는다(두 번째는 다시 읽고 다시 시도한다).
 *
 * 하루 금액 상한: 비용 가드가 그날 예약해 둔 금액(`global:<날짜>` 행의 `reserved_cost_microusd`)이
 * 상한에 닿았으면 찾기를 멈춘다. 모델 호출은 이미 비용 가드를 지나므로 여기서는 읽기만 한다.
 *
 * 카운터를 읽거나 쓰지 못하면 **막는다**. 세지 못하는 찾기는 한도가 없는 찾기다.
 */

const COUNTER_TABLE = "amora_turn_counters";
const MAX_CAS_ATTEMPTS = 5;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

export type WebLookupQuotaDenial =
  | "couple_daily_cap"
  | "global_daily_cap"
  | "global_cost_cap"
  | "quota_unavailable";

export type WebLookupQuotaDecision =
  | { allowed: true; usedToday: number; remainingToday: number }
  | { allowed: false; reason: WebLookupQuotaDenial; remainingToday: number | null };

export function webLookupCoupleCounterKey(coupleId: string, ymd: string): string {
  return `web_lookup:couple:${coupleId.toLowerCase()}:${ymd}`;
}

export function webLookupGlobalCounterKey(ymd: string): string {
  return `web_lookup:global:${ymd}`;
}

async function readCount(admin: SupabaseClient, key: string): Promise<number | null> {
  const { data, error } = await admin.from(COUNTER_TABLE).select("count").eq("key", key).maybeSingle();
  if (error) return null;
  const count = (data as { count?: unknown } | null)?.count;
  if (count === undefined || count === null) return 0;
  return typeof count === "number" && Number.isSafeInteger(count) && count >= 0 ? count : null;
}

/** 한도 안이면 +1 하고 새 개수를 돌려준다. 한도에 닿았으면 "full", 못 세면 null. */
async function incrementWithin(
  admin: SupabaseClient,
  key: string,
  cap: number,
): Promise<number | "full" | null> {
  const { error: seedError } = await admin
    .from(COUNTER_TABLE)
    .upsert({ key, count: 0 }, { onConflict: "key", ignoreDuplicates: true });
  if (seedError) return null;
  for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt += 1) {
    const current = await readCount(admin, key);
    if (current === null) return null;
    if (current >= cap) return "full";
    const { data, error } = await admin
      .from(COUNTER_TABLE)
      .update({ count: current + 1, updated_at: new Date().toISOString() })
      .eq("key", key)
      .eq("count", current)
      .select("count");
    if (error) return null;
    if (Array.isArray(data) && data.length === 1) return current + 1;
    // 다른 요청이 먼저 올렸다. 다시 읽는다.
  }
  return null;
}

async function costCapReached(admin: SupabaseClient, ymd: string): Promise<boolean | null> {
  const cap = getAmoraGlobalDailyCostCap();
  if (!cap.guardEnabled) return false;
  const { data, error } = await admin
    .from(COUNTER_TABLE)
    .select("reserved_cost_microusd")
    .eq("key", `global:${ymd}`)
    .maybeSingle();
  if (error) return null;
  const reserved = Number((data as { reserved_cost_microusd?: unknown } | null)?.reserved_cost_microusd ?? 0);
  if (!Number.isFinite(reserved)) return null;
  return reserved >= cap.costMicrousd;
}

export async function reserveWebLookupQuota(
  admin: SupabaseClient,
  coupleId: string,
  options: { now?: Date; coupleCap?: number; globalCap?: number } = {},
): Promise<WebLookupQuotaDecision> {
  if (!UUID_RE.test(coupleId)) return { allowed: false, reason: "quota_unavailable", remainingToday: null };
  const ymd = ymdInKst(options.now ?? new Date());
  const coupleCap = options.coupleCap ?? coupleDailyWebLookupCap();
  const globalCap = options.globalCap ?? globalDailyWebLookupCap();
  try {
    const costReached = await costCapReached(admin, ymd);
    if (costReached === null) return { allowed: false, reason: "quota_unavailable", remainingToday: null };
    if (costReached) return { allowed: false, reason: "global_cost_cap", remainingToday: null };

    const globalKey = webLookupGlobalCounterKey(ymd);
    const globalUsed = await readCount(admin, globalKey);
    if (globalUsed === null) return { allowed: false, reason: "quota_unavailable", remainingToday: null };
    if (globalUsed >= globalCap) return { allowed: false, reason: "global_daily_cap", remainingToday: null };

    const coupleUsed = await incrementWithin(admin, webLookupCoupleCounterKey(coupleId, ymd), coupleCap);
    if (coupleUsed === null) return { allowed: false, reason: "quota_unavailable", remainingToday: null };
    if (coupleUsed === "full") return { allowed: false, reason: "couple_daily_cap", remainingToday: 0 };

    // 전체 개수는 커플 몫을 쓴 뒤에 올린다. 여기서 실패해도 이 찾기는 이미 커플 몫으로 셌다.
    // 전체 상한은 바깥 울타리라 동시 요청 몇 개만큼 넘칠 수 있다(위에서 먼저 읽어 막는다).
    await incrementWithin(admin, globalKey, Number.MAX_SAFE_INTEGER);
    return { allowed: true, usedToday: coupleUsed, remainingToday: Math.max(0, coupleCap - coupleUsed) };
  } catch {
    return { allowed: false, reason: "quota_unavailable", remainingToday: null };
  }
}
