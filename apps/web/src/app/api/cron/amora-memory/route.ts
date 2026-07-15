import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  AMORA_MEMORY_BATCH_THRESHOLD,
  AMORA_MEMORY_MAX_BATCH,
  compileAmoraMemory,
  type AmoraMemoryVisibility,
  type MemoryCompilerMessage,
} from "@/lib/ai/amoraMemoryCompiler";
import { isAuxiliaryMemoryRuntimeEnabled } from "@/lib/ai/amoraMemoryQueue";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const MAX_JOBS_PER_RUN = 3;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type MemoryJob = {
  id: string;
  couple_id: string;
  user_id: string | null;
  visibility: AmoraMemoryVisibility;
  to_message_id: string;
  attempt_count: number;
};

type ChatRow = {
  id: string;
  sender_type: "bride" | "groom" | "ai";
  role: "user" | "assistant";
  content: string;
  metadata: {
    target?: string;
    moment?: { memoryKeys?: unknown };
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

async function processJob(job: MemoryJob): Promise<"compiled" | "deferred" | "cancelled"> {
  const admin = createAdminClient();
  const { data: setting, error: settingError } = await admin
    .from("amora_memory_settings")
    .select("enabled, memory_reset_at")
    .eq("couple_id", job.couple_id)
    .eq("visibility", job.visibility)
    .maybeSingle();
  if (settingError) throw new Error("MEMORY_SETTING_LOOKUP_FAILED");
  if (setting?.enabled !== true) {
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

  const { data: previousSummary, error: summaryLookupError } = await admin
    .from("chat_summaries")
    .select("to_message_id")
    .eq("couple_id", job.couple_id)
    .eq("visibility", job.visibility)
    .order("created_at", { ascending: false })
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
    .select("id, sender_type, role, content, metadata, visibility, created_at")
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
  } else if (previousCreatedAt) {
    messagesQuery = messagesQuery.gte("created_at", previousCreatedAt);
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
  if (messages.length < AMORA_MEMORY_BATCH_THRESHOLD) {
    await finishJob(job.id, job.attempt_count, true);
    return "deferred";
  }

  const compilerMessages: MemoryCompilerMessage[] = messages.map((row) => ({
    id: row.id,
    role: row.sender_type === "ai" || row.role === "assistant" ? "assistant" : "user",
    content: row.content,
    momentMemoryKeys: Array.isArray(row.metadata?.moment?.memoryKeys)
      ? row.metadata?.moment?.memoryKeys.filter((value): value is string => typeof value === "string")
      : [],
  }));
  const compilation = await compileAmoraMemory({
    coupleId: job.couple_id,
    userId: job.user_id,
    visibility: job.visibility,
    messages: compilerMessages,
  });

  for (const memory of compilation.memories) {
    const { error } = await admin.rpc("upsert_amora_memory_node", {
      p_couple_id: job.couple_id,
      p_visibility: job.visibility,
      p_memory_key: memory.memoryKey,
      p_category: memory.category,
      p_title: memory.title,
      p_value: memory.value,
      p_reasoning: memory.reasoning,
      p_confidence: memory.confidence,
      p_decision_type: memory.kind === "preference" ? "considering" : "decided",
      p_source_message_id: memory.sourceMessageId,
      p_metadata: {
        memory_kind: memory.kind,
        explicit: true,
        compiled_by: "openai_luna_v2",
      },
    });
    if (error) throw new Error("MEMORY_NODE_UPSERT_FAILED");
  }

  const lastMessageId = messages[messages.length - 1]?.id;
  if (!lastMessageId) throw new Error("MEMORY_CURSOR_MISSING");
  const { error: insertSummaryError } = await admin.rpc("insert_amora_memory_summary", {
    p_couple_id: job.couple_id,
    p_user_id: job.user_id,
    p_visibility: job.visibility,
    p_summary: compilation.summary,
    p_message_count: messages.length,
    p_from_message_id: resetDominatesCursor ? null : previousMessageId ?? null,
    p_to_message_id: lastMessageId,
  });
  if (insertSummaryError) {
    throw new Error("MEMORY_SUMMARY_INSERT_FAILED");
  }
  await finishJob(job.id, job.attempt_count, true);
  return "compiled";
}

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isAuxiliaryMemoryRuntimeEnabled()) {
    return NextResponse.json({ ok: true, enabled: false, claimed: 0 });
  }

  const stats = { claimed: 0, compiled: 0, deferred: 0, cancelled: 0, failed: 0 };
  for (let index = 0; index < MAX_JOBS_PER_RUN; index += 1) {
    const admin = createAdminClient();
    const { data, error } = await admin.rpc("claim_amora_memory_job", { p_lease_seconds: 300 });
    if (error) {
      console.error("[amora-memory-cron] claim failed", error.code ?? "unknown");
      return NextResponse.json({ error: "memory queue unavailable", ...stats }, { status: 503 });
    }
    const job = Array.isArray(data) ? (data[0] as MemoryJob | undefined) : undefined;
    if (!job) break;
    stats.claimed += 1;
    try {
      const result = await processJob(job);
      stats[result] += 1;
    } catch (error) {
      stats.failed += 1;
      console.error("[amora-memory-cron] job failed", { jobId: job.id, code: errorCode(error) });
      await finishJob(job.id, job.attempt_count, false, errorCode(error));
    }
  }

  return NextResponse.json({ ok: true, enabled: true, ...stats });
}
