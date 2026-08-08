import type { SupabaseClient } from "@supabase/supabase-js";
import type { AmoraMemoryVisibility } from "@/lib/ai/amoraMemoryCompiler";
import { createAdminClient } from "@/lib/supabase/admin";

export type AmoraMemoryRepairResult =
  | { status: "unavailable" }
  | {
      status: "repaired";
      scanned: number;
      queued: number;
      duplicate: number;
      skipped: number;
      failed: number;
    };

export type AmoraMemoryRepairCandidateVerification =
  | { status: "confirmed" }
  | { status: "absent" }
  | { status: "unavailable" };

export type ActiveAmoraMemoryJobVerification =
  | { status: "confirmed" }
  | { status: "absent" }
  | { status: "unavailable" };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeDatabaseErrorCode(value: unknown): string {
  if (!isRecord(value)) return "unknown";
  const code = value.code;
  return typeof code === "string" && /^[A-Z0-9_]{1,64}$/i.test(code)
    ? code
    : "unknown";
}

function boundedMetric(
  value: unknown,
  limit: number,
): number | null {
  return Number.isSafeInteger(value)
    && (value as number) >= 0
    && (value as number) <= limit
    ? (value as number)
    : null;
}

export async function verifyAmoraMemoryEnqueueRepairCandidate(input: {
  admin?: SupabaseClient;
  coupleId: string;
  userId: string;
  visibility: AmoraMemoryVisibility;
  toMessageId: string;
}): Promise<AmoraMemoryRepairCandidateVerification> {
  try {
    const admin = input.admin ?? createAdminClient();
    const { data, error } = await admin.rpc(
      "has_amora_memory_enqueue_repair_candidate",
      {
        p_couple_id: input.coupleId,
        p_user_id: input.userId,
        p_visibility: input.visibility,
        p_to_message_id: input.toMessageId,
      },
    );
    if (error) {
      console.error(
        "[amora-memory-repair] candidate proof unavailable",
        safeDatabaseErrorCode(error),
      );
      return { status: "unavailable" };
    }
    if (data === true) return { status: "confirmed" };
    if (data === false) return { status: "absent" };

    console.error(
      "[amora-memory-repair] candidate proof unavailable",
      "invalid_result",
    );
    return { status: "unavailable" };
  } catch {
    console.error(
      "[amora-memory-repair] candidate proof unavailable",
      "transport_error",
    );
    return { status: "unavailable" };
  }
}

export async function verifyActiveAmoraMemoryJob(input: {
  admin?: SupabaseClient;
  coupleId: string;
  userId: string;
  visibility: AmoraMemoryVisibility;
  toMessageId: string;
}): Promise<ActiveAmoraMemoryJobVerification> {
  try {
    const admin = input.admin ?? createAdminClient();
    const { data, error } = await admin.rpc(
      "has_active_amora_memory_job",
      {
        p_couple_id: input.coupleId,
        p_user_id: input.userId,
        p_visibility: input.visibility,
        p_to_message_id: input.toMessageId,
      },
    );
    if (error) {
      console.error(
        "[amora-memory-repair] active job proof unavailable",
        safeDatabaseErrorCode(error),
      );
      return { status: "unavailable" };
    }
    if (data === true) return { status: "confirmed" };
    if (data === false) return { status: "absent" };

    console.error(
      "[amora-memory-repair] active job proof unavailable",
      "invalid_result",
    );
    return { status: "unavailable" };
  } catch {
    console.error(
      "[amora-memory-repair] active job proof unavailable",
      "transport_error",
    );
    return { status: "unavailable" };
  }
}

export async function repairMissingAmoraMemoryJobs(
  admin: SupabaseClient,
  limit: number,
): Promise<AmoraMemoryRepairResult> {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new RangeError("Amora memory repair limit must be an integer from 1 to 100");
  }

  try {
    const { data, error } = await admin.rpc(
      "repair_missing_amora_memory_jobs",
      { p_limit: limit },
    );
    if (error) {
      console.error(
        "[amora-memory-repair] repair unavailable",
        safeDatabaseErrorCode(error),
      );
      return { status: "unavailable" };
    }
    if (!isRecord(data)) {
      console.error(
        "[amora-memory-repair] repair unavailable",
        "invalid_result",
      );
      return { status: "unavailable" };
    }

    const scanned = boundedMetric(data.scanned, limit);
    const queued = boundedMetric(data.queued, limit);
    const duplicate = boundedMetric(data.duplicate, limit);
    const skipped = boundedMetric(data.skipped, limit);
    const failed = boundedMetric(data.failed, limit);
    if (
      scanned === null
      || queued === null
      || duplicate === null
      || skipped === null
      || failed === null
      || queued + duplicate + skipped + failed !== scanned
    ) {
      console.error(
        "[amora-memory-repair] repair unavailable",
        "invalid_result",
      );
      return { status: "unavailable" };
    }

    return {
      status: "repaired",
      scanned,
      queued,
      duplicate,
      skipped,
      failed,
    };
  } catch {
    console.error(
      "[amora-memory-repair] repair unavailable",
      "transport_error",
    );
    return { status: "unavailable" };
  }
}
