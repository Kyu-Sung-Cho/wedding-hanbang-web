import type { SupabaseClient } from "@supabase/supabase-js";

import {
  enqueueAmoraMemoryJob,
  type AmoraMemoryEnqueueResult,
} from "@/lib/ai/amoraMemoryQueue";
import type { AmoraMemoryVisibility } from "@/lib/ai/amoraMemoryCompiler";
import { hasTrustedAmoraMemoryEligibilityMetadata } from "@/lib/ai/amoraMemorySourceScope";
import {
  verifyActiveAmoraMemoryJob,
  verifyAmoraMemoryEnqueueRepairCandidate,
} from "@/lib/ai/amoraMemoryRepair";

type PersistedMemoryCandidate = {
  id: string | null;
  visibility: AmoraMemoryVisibility | null;
  metadata: Record<string, unknown> | null;
};

export type PersistedAmoraMemoryEnqueueReconciliation =
  | { status: "not_eligible" }
  | { status: "invalid_message_scope" }
  | { status: "retry_required" }
  | { status: "repair_queued" }
  | {
      status: "reconciled";
      enqueueResult: Exclude<
        AmoraMemoryEnqueueResult,
        "failed" | "dead_letter"
      >;
    };

export async function reconcilePersistedAmoraMemoryEnqueue(input: {
  coupleId: string;
  userId: string;
  expectedVisibility: AmoraMemoryVisibility;
  message: PersistedMemoryCandidate;
  admin?: SupabaseClient;
}): Promise<PersistedAmoraMemoryEnqueueReconciliation> {
  if (!hasTrustedAmoraMemoryEligibilityMetadata(input.message.metadata)) {
    return { status: "not_eligible" };
  }
  if (
    !input.message.id
    || input.message.visibility !== input.expectedVisibility
  ) {
    return { status: "invalid_message_scope" };
  }

  const enqueueResult = await enqueueAmoraMemoryJob({
    coupleId: input.coupleId,
    userId: input.userId,
    visibility: input.expectedVisibility,
    toMessageId: input.message.id,
    admin: input.admin,
  });
  if (enqueueResult === "dead_letter") {
    return { status: "retry_required" };
  }
  if (enqueueResult !== "failed" && enqueueResult !== "duplicate") {
    return { status: "reconciled", enqueueResult };
  }

  if (enqueueResult === "duplicate") {
    const activeJobProof = await verifyActiveAmoraMemoryJob({
      admin: input.admin,
      coupleId: input.coupleId,
      userId: input.userId,
      visibility: input.expectedVisibility,
      toMessageId: input.message.id,
    });
    return activeJobProof.status === "confirmed"
      ? { status: "reconciled", enqueueResult }
      : { status: "retry_required" };
  }

  const repairProof = await verifyAmoraMemoryEnqueueRepairCandidate({
    admin: input.admin,
    coupleId: input.coupleId,
    userId: input.userId,
    visibility: input.expectedVisibility,
    toMessageId: input.message.id,
  });
  return repairProof.status === "confirmed"
    ? { status: "repair_queued" }
    : { status: "retry_required" };
}
