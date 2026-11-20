import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  AMORA_MEMORY_CURSOR_SUMMARY,
  compileAmoraMemory,
  shouldDeferAmoraMemoryBatch,
  type AmoraMemoryVisibility,
} from "@/lib/ai/amoraMemoryCompiler";
import {
  AMORA_MEMORY_SOURCE_READ_LIMIT,
  prepareTrustedAmoraMemoryBatch,
} from "@/lib/ai/amoraMemorySourceScope";
import {
  getAmoraMemoryEnablement,
  isAuxiliaryMemoryRuntimeEnabled,
} from "@/lib/ai/amoraMemoryQueue";
import { repairMissingAmoraMemoryJobs } from "@/lib/ai/amoraMemoryRepair";
import { AmoraMemoryConversationPolicyError, resolveAmoraMemoryConversationExclusions } from "@/lib/ai/amoraMemoryConversationPolicy";
import {
  AmoraMemoryBudgetDeferredError,
  createAmoraMemoryProviderBudgetGate,
  deferAmoraMemoryJobForBudget,
} from "@/lib/ai/amoraMemoryCostGate";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const MAX_JOBS_PER_RUN = 3;
const MAX_REPAIR_CANDIDATES_PER_RUN = 20;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
  metadata: Record<string, unknown> | null;
  visibility: AmoraMemoryVisibility;
  created_at: string;
  segment_id: string | null;
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
    .select(
      (process.env.AMORA_NEUTRAL_PREPARATION_SPACE_ENABLED === "true"
        ? "bride_id, groom_id, member_model_version"
        : "bride_id, groom_id") as "bride_id, groom_id",
    )
    .eq("id", job.couple_id)
    .maybeSingle();
  if (coupleError || !couple) throw new Error("MEMORY_COUPLE_LOOKUP_FAILED");
  const usesNeutralMemberPresentation =
    (couple as { member_model_version?: unknown }).member_model_version === 2;

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
    .select("id, sender_id, sender_type, role, content, metadata, visibility, created_at, segment_id")
    .eq("couple_id", job.couple_id)
    .lte("created_at", target.created_at)
    .or("metadata->>target.is.null,metadata->>target.neq.partner")
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(AMORA_MEMORY_SOURCE_READ_LIMIT);
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
    if (
      row.visibility !== job.visibility
      || row.metadata?.target === "partner"
      || row.content.trim().length === 0
    ) return false;
    if (!resetDominatesCursor && previousCreatedAt && previousMessageId) {
      const followsCursor = row.created_at > previousCreatedAt
        || (row.created_at === previousCreatedAt && row.id > previousMessageId);
      if (!followsCursor) return false;
    }
    return row.created_at < target.created_at
      || (row.created_at === target.created_at && row.id <= target.id);
  });
  // 첫 금지 메시지는 provider 성공과 무관하게, cursor 소비 전에 서버 정책으로 남긴다.
  const policyInput = { admin, coupleId: job.couple_id, visibility: job.visibility,
    couple: { brideId: couple.bride_id, groomId: couple.groom_id }, rows: messages };
  const excludedSources = await resolveAmoraMemoryConversationExclusions(policyInput);
  const assertConversationPolicyCurrent = async () => {
    const latest = await resolveAmoraMemoryConversationExclusions({ ...policyInput, registerDenials: false });
    if ([...latest].some(id => !excludedSources.has(id))) throw new AmoraMemoryConversationPolicyError();
  };
  // Only a fresh job waits for ten messages. A continuation must consume its
  // final short remainder or the original target could never be completed.
  if (shouldDeferAmoraMemoryBatch(messages.length, job.continuation_count)) {
    await finishJob(job.id, job.attempt_count, true);
    return "deferred";
  }

  const batch = prepareTrustedAmoraMemoryBatch(messages, {
    brideId: couple.bride_id,
    groomId: couple.groom_id,
  }, excludedSources);
  if (batch.messages.length === 0) {
    if (batch.blockedByUnresolvedSource) {
      // A concurrent Amora reply can arrive after this fetch. Do not advance
      // past its W0/W1 user row; the later reply enqueue will safely retry from
      // the unchanged cursor instead of losing that source forever.
      await finishJob(job.id, job.attempt_count, true);
      return "deferred";
    }
    throw new Error("MEMORY_BATCH_EMPTY");
  }
  let compilation: Awaited<ReturnType<typeof compileAmoraMemory>>;
  try {
    // 이미 쓰고 있는 키를 모델에게 보여준다. 안 보여주면 같은 주제에 새 키를
    // 지어내 옛 값과 새 값이 **둘 다 활성**으로 남는다(2026-08-22 스테이징 실측:
    // `guest_count:expected` "200명 정도" 와 `guest_count:total` "300명",
    // `ceremony:venue_type` "실내" 와 `venue:format` "야외"). DB 의 유니크 색인은
    // 같은 키만 막을 수 있고, 다른 키로 들어오면 막을 방법이 없다.
    //
    // 이 조회가 실패해도 **작업을 죽이지 않는다.** 키 목록은 정확도를 높이는
    // 보조 자료이지 컴파일의 전제가 아니다. 실패했다고 기억을 통째로 못 만들면
    // 보조 자료 하나 때문에 기능이 멈춘다.
    let existingMemoryKeys: string[] = [];
    try {
      const { data: existingKeyRows, error: existingKeyError } = await admin
        .from("decision_nodes")
        .select("memory_key")
        .eq("couple_id", job.couple_id)
        .eq("visibility", job.visibility)
        .is("superseded_at", null)
        .not("memory_key", "is", null)
        .order("updated_at", { ascending: false })
        .limit(200);
      if (existingKeyError) throw existingKeyError;
      existingMemoryKeys = (existingKeyRows ?? [])
        .map((row) => (row as { memory_key?: unknown }).memory_key)
        .filter((key): key is string => typeof key === "string");
    } catch {
      console.warn("[amora-memory-cron] existing memory keys unavailable");
    }

    const reserveProviderBudgetOnce = createAmoraMemoryProviderBudgetGate(admin, job.couple_id);
    compilation = await compileAmoraMemory({
      coupleId: job.couple_id,
      userId: job.user_id,
      visibility: job.visibility,
      messages: batch.messages,
      existingMemoryKeys,
      neutralMemberPresentation: usesNeutralMemberPresentation,
      // 예산 초과로 미룰 작업이면 대화 원문이 토큰 계산 요청으로도 나가면 안 된다.
      // 그래서 예산 검사를 모든 provider 요청 앞에 건다. 예약은 컴파일당 한 번이다.
      // 두 관문이 각자 예약하면 컴파일 한 번이 전역 하루 턴 2개와 비용 2배를 가져간다.
      beforeProviderEgress: async () => { await assertConversationPolicyCurrent(); await reserveProviderBudgetOnce(); },
      beforeGeneration: async () => { await assertConversationPolicyCurrent(); await reserveProviderBudgetOnce(); },
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
  // DB RPC 자체의 deny-commit 동시성은 별도 경계다. 여기서 관측한 변경은 결과/요약 모두 폐기한다.
  await assertConversationPolicyCurrent();
  const { data: committed, error: commitError } = await admin.rpc("commit_amora_memory_job", {
    p_job_id: job.id,
    p_attempt_count: job.attempt_count,
    p_memories: compilation.memories.map((memory) => ({
      memory_key: memory.memoryKey,
      category: memory.category,
      title: memory.title,
      value: memory.value,
      // 2026-11-20 D-87·09장 M5-3: 모델이 쓴 "이유"는 인용에 묶이지 않은 추정이라 저장하지 않는다(I11).
      reasoning: null,
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
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isAuxiliaryMemoryRuntimeEnabled()) {
    return NextResponse.json({ ok: true, enabled: false, claimed: 0 });
  }

  const stats = {
    repairScanned: 0,
    repairQueued: 0,
    repairDuplicate: 0,
    repairSkipped: 0,
    repairFailed: 0,
    repairUnavailable: false,
    claimed: 0,
    compiled: 0,
    deferred: 0,
    budgetDeferred: 0,
    cancelled: 0,
    failed: 0,
  };

  // A response can be atomically persisted while the immediately-following,
  // runtime-gated enqueue RPC loses its result. Drain the bounded ID-only
  // repair outbox before the queue, but never let repair availability block
  // older jobs.
  try {
    const repair = await repairMissingAmoraMemoryJobs(
      createAdminClient(),
      MAX_REPAIR_CANDIDATES_PER_RUN,
    );
    if (repair.status === "unavailable") {
      stats.repairUnavailable = true;
    } else {
      stats.repairScanned = repair.scanned;
      stats.repairQueued = repair.queued;
      stats.repairDuplicate = repair.duplicate;
      stats.repairSkipped = repair.skipped;
      stats.repairFailed = repair.failed;
    }
  } catch {
    // The helper validates its fixed bound and normally contains transport
    // failures. This last fence protects the pre-existing queue drain from an
    // unexpected local regression without logging message text or raw errors.
    stats.repairUnavailable = true;
    console.error("[amora-memory-cron] repair unavailable", "internal_error");
  }

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
