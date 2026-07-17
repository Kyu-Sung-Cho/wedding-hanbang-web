import type { SupabaseClient } from "@supabase/supabase-js";
import { getAmoraProviderCallCostReservationMicrousd } from "@/lib/ai/amoraRequestPolicy";
import { reserveAmoraTurn, type CostGuardResult } from "@/lib/ai/costGuard";

type MemoryBudgetReason = NonNullable<CostGuardResult["reason"]>;

const REASON_CODE: Record<MemoryBudgetReason, string> = {
  couple_quota: "COUPLE_QUOTA",
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

/** Runs after exact token counting and immediately before the paid call. */
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
