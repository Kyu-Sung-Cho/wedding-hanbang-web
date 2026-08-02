import { NextRequest, NextResponse } from "next/server";
import { verifySecretBearerRequest } from "@/lib/auth/secretBearer";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  AMORA_MEMORY_CURSOR_SUMMARY,
  AMORA_MEMORY_MAX_BATCH,
  compileAmoraMemory,
  extractTrustedMomentMemoryKeys,
  prepareAmoraMemoryBatch,
  shouldDeferAmoraMemoryBatch,
  type AmoraMemoryVisibility,
  type MemoryCompilerMessage,
} from "@/lib/ai/amoraMemoryCompiler";
import {
  getAmoraMemoryEnablement,
  isAuxiliaryMemoryRuntimeEnabled,
} from "@/lib/ai/amoraMemoryQueue";
import {
  AmoraMemoryBudgetDeferredError,
  assertAmoraMemoryProviderBudget,
  deferAmoraMemoryJobForBudget,
} from "@/lib/ai/amoraMemoryCostGate";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const MAX_JOBS_PER_RUN = 3;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

type MemoryJob = {
  id: string;
  couple_id: string;
  user_id: string | null;
  visibility: AmoraMemoryVisibility;
  to_message_id: string;
  attempt_count: number;
  continuation_count: number;
};

type ChatRow = {
  id: string;
  sender_id: string | null;
  sender_type: "bride" | "groom" | "ai";
  role: "user" | "assistant";
  content: string;
  metadata: {
    client_request_id?: string;
    target?: string;
    moment?: {
      memoryKeys?: unknown;
    };
  } | null;
  visibility: AmoraMemoryVisibility;
  created_at: string;
};

function errorCode(error: unknown): string {
  const name = error instanceof Error ? error.name.toUpperCase() : "UNKNOWN";
  if (name.includes("OPENAI")) return "PROVIDER_ERROR";
  if (name.includes("ABORT")) return "PROVIDER_ABORTED";
  return "MEMORY_COMPILE_FAILED";
}

async function finishJob(jobId: string, attemptCount: number, success: boolean, code?: string): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin.rpc("finish_amora_memory_job", {
    p_job_id: jobId,
    p_success: success,
    p_error_code: success ? null : code ?? "UNKNOWN",
    p_attempt_count: attemptCount,
  });
  if (error) console.error("[amora-memory-cron] finish failed", error.code ?? "unknown");
}

async function processJob(
  job: MemoryJob,
): Promise<"compiled" | "deferred" | "budgetDeferred" | "cancelled"> {
  const admin = createAdminClient();
  const { data: setting, error: settingError } = await admin
    .from("amora_memory_settings")
    .select("enabled, memory_reset_at")
    .eq("couple_id", job.couple_id)
    .eq("visibility", job.visibility)
    .maybeSingle();
  if (settingError) throw new Error("MEMORY_SETTING_LOOKUP_FAILED");
  const currentEnablement = await getAmoraMemoryEnablement(
    job.couple_id,
    [job.visibility],
    admin,
  );
  if (setting?.enabled !== true || currentEnablement[job.visibility] !== true) {
    const { error } = await admin
      .from("amora_memory_jobs")
      .update({ status: "cancelled", claimed_at: null, completed_at: new Date().toISOString() })
      .eq("id", job.id)
      .eq("status", "processing");
    if (error) throw new Error("MEMORY_JOB_CANCEL_FAILED");
    return "cancelled";
  }

  const { data: target, error: targetError } = await admin
    .from("chat_messages")
    .select("id, created_at")
    .eq("id", job.to_message_id)
    .eq("couple_id", job.couple_id)
    .eq("visibility", job.visibility)
    .maybeSingle();
  if (targetError || !target) throw new Error("MEMORY_TARGET_NOT_FOUND");

  const { data: couple, error: coupleError } = await admin
    .from("couples")
    .select("bride_id, groom_id")
    .eq("id", job.couple_id)
    .maybeSingle();
  if (coupleError || !couple) throw new Error("MEMORY_COUPLE_LOOKUP_FAILED");

  const { data: previousSummary, error: summaryLookupError } = await admin
    .from("chat_summaries")
    .select("id, to_message_id")
    .eq("couple_id", job.couple_id)
    .eq("visibility", job.visibility)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (summaryLookupError) throw new Error("MEMORY_CURSOR_LOOKUP_FAILED");

  let previousCreatedAt: string | null = null;
  const previousMessageId = previousSummary?.to_message_id;
  if (typeof previousMessageId === "string" && UUID_PATTERN.test(previousMessageId)) {
    const { data: previousMessage } = await admin
      .from("chat_messages")
      .select("created_at")
      .eq("id", previousMessageId)
      .eq("couple_id", job.couple_id)
      .maybeSingle();
    previousCreatedAt = previousMessage?.created_at ?? null;
  }

  let messagesQuery = admin
    .from("chat_messages")
    .select("id, sender_id, sender_type, role, content, metadata, visibility, created_at")
    .eq("couple_id", job.couple_id)
    .lte("created_at", target.created_at)
    .or("metadata->>target.is.null,metadata->>target.neq.partner")
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(AMORA_MEMORY_MAX_BATCH);
  messagesQuery = messagesQuery.eq("visibility", job.visibility);
  const resetAt = typeof setting.memory_reset_at === "string" ? setting.memory_reset_at : null;
  const resetDominatesCursor = Boolean(resetAt && (!previousCreatedAt || resetAt >= previousCreatedAt));
  if (resetDominatesCursor && resetAt) {
    // A reset is an exclusive privacy boundary. A message timestamp equal to
    // the reset instant must never be compiled again.
    messagesQuery = messagesQuery.gt("created_at", resetAt);
  } else if (previousCreatedAt && previousMessageId) {
    // Apply the compound cursor before LIMIT. A plain created_at >= filter can
    // fill all 40 rows with already-consumed messages that share the cursor's
    // timestamp, causing a false empty batch and skipped memory compilation.
    messagesQuery = messagesQuery.or(
      `created_at.gt.${previousCreatedAt},and(created_at.eq.${previousCreatedAt},id.gt.${previousMessageId})`,
    );
  }

  const { data: rows, error: messagesError } = await messagesQuery;
  if (messagesError) throw new Error("MEMORY_MESSAGES_LOOKUP_FAILED");
  const messages = ((rows ?? []) as ChatRow[]).filter((row) => {
    if (row.metadata?.target === "partner" || row.content.trim().length === 0) return false;
    if (!resetDominatesCursor && previousCreatedAt && previousMessageId) {
      const followsCursor = row.created_at > previousCreatedAt
        || (row.created_at === previousCreatedAt && row.id > previousMessageId);
      if (!followsCursor) return false;
    }
    return row.created_at < target.created_at
      || (row.created_at === target.created_at && row.id <= target.id);
  });
  // Only a fresh job waits for ten messages. A continuation must consume its
  // final short remainder or the original target could never be completed.
  if (shouldDeferAmoraMemoryBatch(messages.length, job.continuation_count)) {
    await finishJob(job.id, job.attempt_count, true);
    return "deferred";
  }

  const compilerMessages: MemoryCompilerMessage[] = messages.map((row) => {
    const isAssistant = row.sender_type === "ai" || row.role === "assistant";
    const sourceActorRole = isAssistant
      ? null
      : row.sender_id === couple.bride_id
        ? "bride" as const
        : row.sender_id === couple.groom_id
          ? "groom" as const
          : null;
    return {
      id: row.id,
      role: isAssistant ? "assistant" : "user",
      content: row.content,
      sourceActorRole,
      // Only a canonical AI/assistant row can carry a server-authored care
      // taxonomy hint. Its text is still excluded from provider evidence.
      trustedMomentMemoryKeys: row.sender_type === "ai" && row.role === "assistant"
        ? extractTrustedMomentMemoryKeys(row.metadata)
        : [],
    };
  });
  const batch = prepareAmoraMemoryBatch(compilerMessages);
  if (batch.messages.length === 0) throw new Error("MEMORY_BATCH_EMPTY");
  let compilation: Awaited<ReturnType<typeof compileAmoraMemory>>;
  try {
    compilation = await compileAmoraMemory({
      coupleId: job.couple_id,
      userId: job.user_id,
      visibility: job.visibility,
      messages: batch.messages,
      beforeGeneration: () => assertAmoraMemoryProviderBudget(admin, job.couple_id),
    });
  } catch (error) {
    if (!(error instanceof AmoraMemoryBudgetDeferredError)) throw error;
    await deferAmoraMemoryJobForBudget(admin, {
      jobId: job.id,
      attemptCount: job.attempt_count,
      reason: error.reason,
    });
    return "budgetDeferred";
  }

  const lastMessageId = batch.messages[batch.messages.length - 1]?.id;
  if (!lastMessageId) throw new Error("MEMORY_CURSOR_MISSING");
  const { data: committed, error: commitError } = await admin.rpc("commit_amora_memory_job", {
    p_job_id: job.id,
    p_attempt_count: job.attempt_count,
    p_memories: compilation.memories.map((memory) => ({
      memory_key: memory.memoryKey,
      category: memory.category,
      title: memory.title,
      value: memory.value,
      reasoning: memory.reasoning,
      confidence: memory.confidence,
      // An AI extraction from a shared chat is never mutual confirmation.
      // Only the explicit two-person mediation flow may create a shared
      // `decided` node. Private memories may preserve the user's own decision.
      decision_type: job.visibility === "shared" || memory.kind === "preference"
        ? "considering"
        : "decided",
      source_message_id: memory.sourceMessageId,
      metadata: {
        memory_kind: memory.kind,
        explicit: true,
        compiled_by: "openai_luna_v2",
      },
    })),
    p_summary: compilation.summary ?? AMORA_MEMORY_CURSOR_SUMMARY,
    p_message_count: batch.messages.length,
    p_from_message_id: resetDominatesCursor ? null : previousMessageId ?? null,
    p_to_message_id: lastMessageId,
  });
  if (commitError || committed !== true) {
    throw new Error("MEMORY_BUNDLE_COMMIT_FAILED");
  }
  return "compiled";
}

export async function GET(request: NextRequest) {
  if (!verifySecretBearerRequest(request, process.env.CRON_SECRET)) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: NO_STORE_HEADERS },
    );
  }
  if (!isAuxiliaryMemoryRuntimeEnabled()) {
    return NextResponse.json(
      { ok: true, enabled: false, claimed: 0 },
      { headers: NO_STORE_HEADERS },
    );
  }

  const stats = {
    claimed: 0,
    compiled: 0,
    deferred: 0,
    budgetDeferred: 0,
    cancelled: 0,
    failed: 0,
  };
  for (let index = 0; index < MAX_JOBS_PER_RUN; index += 1) {
    const admin = createAdminClient();
    const { data, error } = await admin.rpc("claim_amora_memory_job", { p_lease_seconds: 300 });
    if (error) {
      console.error("[amora-memory-cron] claim failed", error.code ?? "unknown");
      return NextResponse.json(
        { error: "memory queue unavailable", ...stats },
        { status: 503, headers: NO_STORE_HEADERS },
      );
    }
    const job = Array.isArray(data) ? (data[0] as MemoryJob | undefined) : undefined;
    if (!job) break;
    stats.claimed += 1;
    try {
      const result = await processJob(job);
      stats[result] += 1;
    } catch (error) {
      stats.failed += 1;
      console.error("[amora-memory-cron] job failed", { code: errorCode(error) });
      await finishJob(job.id, job.attempt_count, false, errorCode(error));
    }
  }

  return NextResponse.json(
    { ok: true, enabled: true, ...stats },
    { headers: NO_STORE_HEADERS },
  );
}
