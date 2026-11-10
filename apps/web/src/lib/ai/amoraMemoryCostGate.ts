import type { SupabaseClient } from "@supabase/supabase-js";
import { getAmoraProviderCallCostReservationMicrousd } from "@/lib/ai/amoraRequestPolicy";
import { reserveAmoraTurn, type CostGuardResult } from "@/lib/ai/costGuard";

type MemoryBudgetReason = NonNullable<CostGuardResult["reason"]>;

const REASON_CODE: Record<MemoryBudgetReason, string> = {
  couple_quota: "COUPLE_QUOTA",
  couple_daily: "COUPLE_DAILY",
  global_daily: "GLOBAL_DAILY",
  global_budget: "GLOBAL_BUDGET",
  guard_unavailable: "GUARD_UNAVAILABLE",
};

export class AmoraMemoryBudgetDeferredError extends Error {
  readonly reason: MemoryBudgetReason;

  constructor(reason?: MemoryBudgetReason) {
    super("AMORA_MEMORY_PROVIDER_BUDGET_DEFERRED");
    this.name = "AmoraMemoryBudgetDeferredError";
    this.reason = reason ?? "guard_unavailable";
  }
}

/**
 * Reserves one background provider call from the global day. The memory cron
 * calls it once per compile through createAmoraMemoryProviderBudgetGate, in
 * front of the first provider request (before token counting).
 */
export async function assertAmoraMemoryProviderBudget(
  admin: SupabaseClient,
  coupleId: string,
): Promise<void> {
  let reservation: CostGuardResult;
  try {
    reservation = await reserveAmoraTurn(admin, {
      coupleId,
      isAdmin: false,
      quotaScope: "background",
      maxCostMicrousd: getAmoraProviderCallCostReservationMicrousd("fast"),
    });
  } catch {
    throw new AmoraMemoryBudgetDeferredError("guard_unavailable");
  }
  if (!reservation.allowed) {
    throw new AmoraMemoryBudgetDeferredError(reservation.reason);
  }
}

/**
 * One compile makes one paid call, so it reserves once.
 *
 * The cron runs the budget check in front of both provider gates (before token
 * counting and before generation). Each gate used to reserve on its own, so one
 * compile took two turns and twice the cost from the global day. The second
 * gate now waits on the first reservation.
 */
export function createAmoraMemoryProviderBudgetGate(
  admin: SupabaseClient,
  coupleId: string,
): () => Promise<void> {
  let reservation: Promise<void> | null = null;
  return () => {
    reservation ??= assertAmoraMemoryProviderBudget(admin, coupleId);
    return reservation;
  };
}

export async function deferAmoraMemoryJobForBudget(
  admin: SupabaseClient,
  input: {
    jobId: string;
    attemptCount: number;
    reason: MemoryBudgetReason;
  },
): Promise<void> {
  const { data, error } = await admin.rpc("defer_amora_memory_job", {
    p_job_id: input.jobId,
    p_attempt_count: input.attemptCount,
    p_defer_seconds: 3_600,
    p_reason_code: REASON_CODE[input.reason],
  });
  if (error || data !== true) {
    throw new Error("MEMORY_BUDGET_DEFER_FAILED");
  }
}
