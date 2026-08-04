/**
 * 커플 갈등 자동 감지 + mediation 응답 생성 (C안 서버사이드 단일 진실원본).
 *
 * 호출 시점:
 *  - 커플 멤버가 chat_messages 에 메시지 INSERT 직후 (chatStore.sendMessage 에서 fire-and-forget POST)
 *
 * 동작:
 *  1. 인증 + 커플 매핑 확인
 *  2. 최근 shared 메시지 + pastConflicts 조회
 *  3. detectCoupleConflict 실행 (휴리스틱 + borderline LLM 검증)
 *  4. 트리거 시:
 *     a. cooldown 락 — 최근 10분 내 mediation 메시지 있으면 abort (race condition 방어)
 *     b. OpenAI Responses API로 [MEDIATION_REQUEST] 응답 생성
 *     c. extractMediation 으로 [mediation] 마커 파싱
 *     d. chat_messages 에 sender_type='ai', visibility='shared', metadata.mediation 으로 INSERT
 *  5. Realtime 이 양쪽 클라이언트에 mediation 메시지 자동 전달
 *
 * 응답: { triggered, score, reason }
 *  fire-and-forget 이라 클라이언트가 응답을 사용하지 않아도 OK.
 */

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient as createPinnedAdminClient } from "@/lib/supabase/admin";
import { createClientFromRequest } from "@/lib/supabase/server";
import {
  detectCoupleConflict,
  type ConflictDetection,
  type CoupleMessage,
} from "@/lib/ai/conflict-detector";
import { extractMediation } from "@/lib/ai/mediation";
import { buildAmoraSystemPrompt } from "@/lib/ai/amoraPromptComposer";
import { checkRateLimitPersistent, rateLimitKey } from "@/utils/rateLimit";
import {
  AmoraCostGuardError,
  checkAmoraCostGuard,
} from "@/lib/ai/costGuard";
import {
  AMORA_MAX_INPUT_TOKENS_PER_PROVIDER_CALL,
  getAmoraProviderCallCostReservationMicrousd,
} from "@/lib/ai/amoraRequestPolicy";
import { createOpenAIResponseWithAudit } from "@/lib/ai/auditedOpenAI";
import { hasOpenAIConfig } from "@/lib/ai/modelConfig";
import {
  AmoraPrivacyContextError,
  getAmoraMemoryEnablement,
  getAmoraPrivacyEpoch,
} from "@/lib/ai/amoraMemoryQueue";
import { isFactualAmoraMemorySummary } from "@/lib/ai/amoraMemoryCompiler";
import { classifyAmoraCrisis } from "@/lib/ai/amoraCrisisSafety";
import {
  claimChatRequest,
  failChatRequest,
} from "@/lib/ai/chatRequestClaim";
import {
  claimAmoraConflictCheck,
  checkpointAmoraConflictCheck,
  completeAmoraConflictCheck,
  createAmoraConflictMessageDigest,
  failAmoraConflictCheck,
  type AmoraConflictDetectionCheckpoint,
} from "@/lib/ai/amoraConflictCheckClaim";
import {
  runAmoraProviderCallWithLedger,
  type AtomicAmoraChatResponseFinalization,
} from "@/lib/ai/amoraProviderCallLedger";
import { readBoundedUtf8Text } from "@/utils/requestValidation";
import { isTrustedMutationRequest } from "@/utils/trustedMutation";

const MEDIATION_COOLDOWN_MIN = 10;
const RECENT_MESSAGE_LIMIT = 20;
const MAX_MEDIATION_SYSTEM_CHARS = 48_000;
const MAX_MEDIATION_MESSAGE_CHARS = 1_200;
const MAX_CONFLICT_CONTEXT_CHARS = 2_000;
const MAX_REQUEST_BODY_BYTES = 4 * 1024;

type MemoryClassifiableDecision = {
  memory_key: string | null;
  superseded_at: string | null;
  metadata: { extracted_by?: string } | null;
};

function isAutomaticMemoryDecision(decision: MemoryClassifiableDecision): boolean {
  return decision.memory_key !== null
    || typeof decision.metadata?.extracted_by === "string";
}

function getAdminClient() {
  return createPinnedAdminClient();
}

export async function POST(req: NextRequest) {
  if (!isTrustedMutationRequest(req)) {
    return NextResponse.json(
      { triggered: false, reason: "untrusted_origin" },
      { status: 403 },
    );
  }
  // Product contract: mediation is user-requested, never a hidden automatic
  // mode. Keep the legacy detector available only for explicit local test/dev
  // evaluation while production remains hard-disabled even if an environment
  // variable is accidentally enabled. The main /api/chat mediation request is
  // the supported requester-summary-only path.
  if (
    process.env.NODE_ENV === "production"
    || process.env.AMORA_AUTOMATIC_CONFLICT_MEDIATION_ENABLED !== "true"
  ) {
    return NextResponse.json(
      { triggered: false, reason: "explicit_mediation_required" },
      {
        status: 410,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }
  const boundedBody = await readBoundedUtf8Text(req, MAX_REQUEST_BODY_BYTES);
  if (!boundedBody.ok) {
    return NextResponse.json(
      {
        triggered: false,
        reason: boundedBody.reason === "too_large"
          ? "request_too_large"
          : "invalid_request_body",
      },
      { status: boundedBody.reason === "too_large" ? 413 : 400 },
    );
  }
  let body: { coupleId?: string } = {};
  try {
    const parsed = boundedBody.text.length > 0 ? JSON.parse(boundedBody.text) : {};
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new TypeError("request body must be a JSON object");
    }
    body = parsed as { coupleId?: string };
  } catch {
    return NextResponse.json(
      { triggered: false, reason: "invalid_request_body" },
      { status: 400 },
    );
  }
  let conflictCheckClaim: {
    coupleId: string;
    messageDigest: string;
    claimToken: string;
  } | null = null;
  let durableClaim: {
    coupleId: string;
    requestKey: string;
    userId: string;
    visibility: "shared";
  } | null = null;
  let durableClaimAttemptCount: number | null = null;
  let initialPrivacyEpoch: number | null = null;
  try {
    // ── 1. 인증 + 커플 확인 ───────────────────────────────────
    const supabase = await createClientFromRequest(req);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ triggered: false, reason: "unauthenticated" }, { status: 401 });
    }

    const requestCoupleId = body.coupleId;

    const admin = getAdminClient();
    const { data: profile } = await admin
      .from("profiles")
      .select("couple_id, role, name, is_admin")
      .eq("id", user.id)
      .single();

    const coupleId = profile?.couple_id;
    if (!coupleId) {
      return NextResponse.json({ triggered: false, reason: "no_couple" });
    }
    if (requestCoupleId && requestCoupleId !== coupleId) {
      return NextResponse.json({ triggered: false, reason: "couple_mismatch" }, { status: 403 });
    }

    try {
      initialPrivacyEpoch = await getAmoraPrivacyEpoch(
        coupleId,
        "shared",
        supabase,
      );
    } catch {
      return NextResponse.json(
        { triggered: false, reason: "privacy_context_unavailable" },
        {
          status: 503,
          headers: { "Cache-Control": "no-store", "Retry-After": "2" },
        },
      );
    }
    const assertPrivacyEpochStillCurrent = async () => {
      if (initialPrivacyEpoch === null) {
        throw new AmoraPrivacyContextError(
          "AMORA_PRIVACY_CONTEXT_UNAVAILABLE",
        );
      }
      const currentEpoch = await getAmoraPrivacyEpoch(
        coupleId,
        "shared",
        supabase,
      );
      if (currentEpoch !== initialPrivacyEpoch) {
        throw new AmoraPrivacyContextError("AMORA_PRIVACY_CONTEXT_CHANGED");
      }
    };

    // ── 2. cooldown 락 — 최근 10분 mediation 메시지 검사 ──────
    const cooldownCutoff = new Date(Date.now() - MEDIATION_COOLDOWN_MIN * 60 * 1000).toISOString();
    const { data: recentAi } = await admin
      .from("chat_messages")
      .select("id, metadata, created_at")
      .eq("couple_id", coupleId)
      .eq("sender_type", "ai")
      .eq("visibility", "shared")
      .gte("created_at", cooldownCutoff)
      .order("created_at", { ascending: false })
      .limit(5);

    const hasMediationRecent =
      (recentAi ?? []).some((m) => {
        const md = m.metadata as { kind?: string; mediation?: unknown } | null;
        return md?.kind === "mediation" || Boolean(md?.mediation);
      });
    if (hasMediationRecent) {
      return NextResponse.json({ triggered: false, reason: "cooldown_active" });
    }

    // ── 3. 최근 shared 메시지 조회 ───────────────────────────
    const { data: rawMessages } = await admin
      .from("chat_messages")
      .select("id, content, sender_type, sender_id, created_at, visibility, metadata")
      .eq("couple_id", coupleId)
      .eq("visibility", "shared")
      .order("created_at", { ascending: false })
      .limit(RECENT_MESSAGE_LIMIT);

    if (!rawMessages || rawMessages.length < 2) {
      return NextResponse.json({ triggered: false, reason: "insufficient_messages" });
    }

    // Never send a crisis disclosure through conflict detection or mediation.
    // The main chat route owns the fixed 109/112/119/1366 response; this
    // fire-and-forget route only guarantees that every provider path is closed.
    const containsCrisisDisclosure = rawMessages.some((message) =>
      message.sender_type !== "ai"
      && typeof message.content === "string"
      && classifyAmoraCrisis(message.content) !== null
    );
    if (containsCrisisDisclosure) {
      return NextResponse.json({
        triggered: false,
        reason: "crisis_safety_delegated",
      });
    }

    // Rate-limit only the ordinary provider-capable path. Crisis messages have
    // already been delegated to the deterministic boundary above.
    const limited = await checkRateLimitPersistent(
      rateLimitKey("conflict-check", req, user.id),
      {
        maxRequests: 30,
        windowMs: 60 * 60 * 1000,
      },
      { failClosed: true },
    );
    if (limited) return limited;

    // Partner-addressed messages are private correspondence. Until both people
    // explicitly opt in to provider processing, fail closed before either the
    // conflict-verification or mediation OpenAI calls can receive their text.
    const containsPartnerOnlyMessage = rawMessages.some((message) => {
      const metadata = message.metadata as { target?: unknown } | null;
      return metadata?.target === "partner";
    });
    if (containsPartnerOnlyMessage) {
      return NextResponse.json({
        triggered: false,
        reason: "privacy_consent_required",
      });
    }

    // The shared message-set claim is acquired before memory reads, conflict
    // history reads, or any provider reservation/call. Requests from either
    // partner therefore converge on one durable result.
    const messageDigest = createAmoraConflictMessageDigest(
      rawMessages.map((message) => String(message.id)),
    );
    const checkClaim = await claimAmoraConflictCheck({
      coupleId,
      messageDigest,
      requesterUserId: user.id,
    }, admin);
    if (checkClaim.action === "completed") {
      return NextResponse.json(checkClaim.result, {
        headers: { "Cache-Control": "no-store" },
      });
    }
    if (checkClaim.action === "in_progress") {
      return NextResponse.json(
        {
          triggered: false,
          reason: "in_progress",
          retryAfterMs: checkClaim.retryAfterMs,
        },
        {
          status: 409,
          headers: {
            "Cache-Control": "no-store",
            "Retry-After": String(Math.max(1, Math.ceil(checkClaim.retryAfterMs / 1_000))),
          },
        },
      );
    }
    conflictCheckClaim = {
      coupleId,
      messageDigest,
      claimToken: checkClaim.claimToken,
    };

    const respondAndCompleteConflictCheck = async (
      result: Record<string, unknown>,
      status = 200,
    ) => {
      if (!conflictCheckClaim) {
        throw new Error("AMORA_CONFLICT_CHECK_CLAIM_MISSING");
      }
      await completeAmoraConflictCheck({
        ...conflictCheckClaim,
        result,
      }, admin);
      conflictCheckClaim = null;
      return NextResponse.json(result, {
        status,
        headers: { "Cache-Control": "no-store" },
      });
    };
    const releaseConflictCheck = async (failureCode: string) => {
      if (!conflictCheckClaim) return;
      const claimToRelease = conflictCheckClaim;
      await failAmoraConflictCheck({
        ...claimToRelease,
        failureCode,
      }, admin);
      conflictCheckClaim = null;
    };

    const replayedDetection = checkClaim.checkpoint;
    if (replayedDetection && !replayedDetection.triggered) {
      return respondAndCompleteConflictCheck({
        triggered: false,
        score: replayedDetection.score,
        reason: replayedDetection.reason,
        llmVerified: replayedDetection.llmVerified,
      });
    }

    // Cost availability is persisted for this exact message set. Repeated
    // fire-and-forget requests cannot keep probing or paying for the same work.
    const guard = await checkAmoraCostGuard(admin, {
      coupleId,
      isAdmin: profile?.is_admin === true,
    });
    if (!guard.allowed) {
      return respondAndCompleteConflictCheck({
        triggered: false,
        reason: "cost_guard",
      });
    }

    // Reuse the main chat's current-consent lookup. The helper defaults to
    // disabled and treats an RPC error as false, so provider context fails
    // closed even though this route reads through a service-role client.
    const memoryEnablement = await getAmoraMemoryEnablement(
      coupleId,
      ["shared"],
      admin,
    );
    const sharedMemoryEnabled = memoryEnablement.shared === true;

    const recentMessages: CoupleMessage[] = rawMessages
      .map((m) => ({
        content: m.content as string,
        senderRole: m.sender_type as CoupleMessage["senderRole"],
        createdAt: m.created_at as string,
        visibility: m.visibility as CoupleMessage["visibility"],
        metadata: m.metadata as CoupleMessage["metadata"],
      }))
      .reverse(); // 시간 오름차순으로 정렬

    const conflictProviderRequestKey = `conflict:${messageDigest}`;
    const conflictCostGuard = (maxCostMicrousd: number) => ({
      coupleId,
      isAdmin: profile?.is_admin === true,
      // Background conflict checks count against global spend, never the
      // couple's free consultation counter.
      quotaScope: "background" as const,
      maxCostMicrousd,
    });

    let detection: ConflictDetection;
    if (replayedDetection) {
      detection = replayedDetection;
    } else {
      // ── 4. 과거 conflict_resolution decision_nodes ──────────
      const { data: pastConflictsRaw } = await admin
        .from("decision_nodes")
        .select("title, created_at, memory_key, superseded_at, metadata")
        .eq("couple_id", coupleId)
        .eq("category", "conflict_resolution")
        .eq("visibility", "shared")
        .order("created_at", { ascending: false })
        .limit(10);

      const pastConflicts = (pastConflictsRaw ?? [])
        .filter((conflict) => {
          const candidate = conflict as typeof conflict & MemoryClassifiableDecision;
          return candidate.superseded_at === null
            && (sharedMemoryEnabled || !isAutomaticMemoryDecision(candidate));
        })
        .map((c) => ({
          title: c.title as string,
          createdAt: c.created_at as string,
        }));

      const verificationClaim = conflictCheckClaim;
      if (!verificationClaim) {
        throw new Error("AMORA_CONFLICT_CHECK_CLAIM_MISSING");
      }

      // ── 5. detector 실행 ────────────────────────────────────
      detection = await detectCoupleConflict({
        coupleId,
        userId: user.id,
        recentSharedMessages: recentMessages,
        pastConflicts,
        windowMinutes: 5,
        beforeProviderEgress: assertPrivacyEpochStillCurrent,
        runProviderCall: (call) => runAmoraProviderCallWithLedger(
          {
            userId: user.id,
            coupleId,
            requestKey: conflictProviderRequestKey,
            source: "conflict_check",
            sessionId: messageDigest,
            modelRole: "fast",
            specialistType: "general",
            callIndex: 1,
            phase: "conflict_verify",
            conflictCheckpointClaim: verificationClaim,
            costGuard: conflictCostGuard(
              getAmoraProviderCallCostReservationMicrousd("fast"),
            ),
          },
          async (beforeGeneration) => {
            const result = await call(async () => {
              await assertPrivacyEpochStillCurrent();
              await beforeGeneration();
            });
            await assertPrivacyEpochStillCurrent();
            return result;
          },
        ),
      });
    }

    if (detection.providerBlockedReason === "cost_guard") {
      return respondAndCompleteConflictCheck({
        triggered: false,
        reason: "cost_guard",
      });
    }
    if (detection.providerBlockedReason === "provider_error") {
      await releaseConflictCheck("CONFLICT_VERIFICATION_PROVIDER_FAILED");
      return NextResponse.json(
        { triggered: false, reason: "provider_unavailable" },
        {
          status: 503,
          headers: { "Cache-Control": "no-store", "Retry-After": "2" },
        },
      );
    }

    if (!detection.triggered) {
      return respondAndCompleteConflictCheck({
        triggered: false,
        score: detection.score,
        reason: detection.reason,
        llmVerified: detection.llmVerified,
      });
    }

    // ── 6. mediation 메시지 생성 ─────────────────────────────
    if (!hasOpenAIConfig("primary")) {
      return respondAndCompleteConflictCheck({
        triggered: false,
        reason: "openai_not_configured",
      });
    }

    // Hard heuristic triggers have no Luna receipt to carry the checkpoint.
    // Persist their bounded detection result before the paid Terra boundary so
    // a transient mediation failure can resume without time-window drift.
    if (!replayedDetection && !detection.llmVerified) {
      if (!conflictCheckClaim) {
        throw new Error("AMORA_CONFLICT_CHECK_CLAIM_MISSING");
      }
      const checkpoint: AmoraConflictDetectionCheckpoint = {
        stage: "detection_complete",
        triggered: true,
        score: Math.round(detection.score),
        reason: detection.reason.slice(0, 2_000),
        conflictContext: detection.conflictContext.slice(0, MAX_CONFLICT_CONTEXT_CHARS),
        llmVerified: false,
      };
      await checkpointAmoraConflictCheck({
        ...conflictCheckClaim,
        checkpoint,
      }, admin);
    }

    durableClaim = {
      coupleId,
      requestKey: `mediation:${messageDigest}`,
      userId: user.id,
      visibility: "shared",
    };
    const claim = await claimChatRequest(durableClaim, admin);
    if (claim.action === "completed") {
      durableClaim = null;
      return respondAndCompleteConflictCheck({
        triggered: false,
        reason: "already_completed",
      });
    }
    if (claim.action === "in_progress") {
      durableClaim = null;
      await releaseConflictCheck("MEDIATION_IN_PROGRESS");
      return NextResponse.json(
        { triggered: false, reason: "in_progress" },
        { status: 409, headers: { "Cache-Control": "no-store" } },
      );
    }
    if (claim.action === "conflict") {
      durableClaim = null;
      await releaseConflictCheck("MEDIATION_REQUEST_CONFLICT");
      return NextResponse.json(
        { triggered: false, reason: "request_conflict" },
        { status: 409, headers: { "Cache-Control": "no-store" } },
      );
    }
    durableClaimAttemptCount = claim.attemptCount;

    // 6-a. 시스템 프롬프트 빌드용 컨텍스트 조회
    const { data: journey } = await admin
      .from("wedding_journeys")
      .select("wedding_date, venue, total_budget, progress")
      .eq("couple_id", coupleId)
      .single();

    const { data: coupleProfiles } = await admin
      .from("profiles")
      .select("id, role, name")
      .eq("couple_id", coupleId);

    const brideName =
      coupleProfiles?.find((p) => p.role === "bride")?.name ?? null;
    const groomName =
      coupleProfiles?.find((p) => p.role === "groom")?.name ?? null;
    const senderName = profile?.name ?? "사용자";

    // 6-b. 최근 대화 요약
    let chatSummaries: string[] = [];
    if (sharedMemoryEnabled) {
      const { data: summariesRaw } = await admin
        .from("chat_summaries")
        .select("summary, summary_type")
        .eq("couple_id", coupleId)
        .eq("visibility", "shared")
        .or("summary_type.is.null,summary_type.neq.cursor")
        .order("created_at", { ascending: false })
        .limit(3);
      chatSummaries = (summariesRaw ?? [])
        .filter(isFactualAmoraMemorySummary)
        .map((summary) => summary.summary);
    }

    // 6-c. pastDecisions / pastConflicts 요약 풀어주기
    const { data: decisionsRaw } = await admin
      .from("decision_nodes")
      .select("category, decision_type, title, chosen_value, reasoning, confidence, source, stage_tag, created_at, memory_key, superseded_at, metadata")
      .eq("couple_id", coupleId)
      .eq("visibility", "shared")
      .order("created_at", { ascending: false })
      .limit(30);
    const decisionsData = (decisionsRaw ?? []).filter((decision) => {
      const candidate = decision as typeof decision & MemoryClassifiableDecision;
      return candidate.superseded_at === null
        && (sharedMemoryEnabled || !isAutomaticMemoryDecision(candidate));
    });
    const pastDecisions = decisionsData.map((d) => ({
      category: d.category as string,
      decisionType: d.decision_type as string,
      title: d.title as string,
      value: ((d.chosen_value as { value?: string } | null)?.value) ?? null,
      reasoning: (d.reasoning as string | null) ?? null,
      confidence: (d.confidence as number | null) ?? 0.5,
      source: d.source as string,
      createdAt: d.created_at as string,
      vendorDeliveryStatus:
        ((d.chosen_value as Record<string, unknown> | null)?.vendor_delivery_status as string | undefined)
        ?? ((d.metadata as Record<string, unknown> | null)?.vendor_delivery_status as string | undefined)
        ?? null,
      vendorConfirmationStatus:
        ((d.chosen_value as Record<string, unknown> | null)?.vendor_confirmation_status as string | undefined)
        ?? ((d.metadata as Record<string, unknown> | null)?.vendor_confirmation_status as string | undefined)
        ?? null,
      internalRequestStatus:
        ((d.chosen_value as Record<string, unknown> | null)?.internal_request_status as string | undefined)
        ?? null,
      vendorCancellationStatus:
        ((d.chosen_value as Record<string, unknown> | null)?.vendor_cancellation_status as string | undefined)
        ?? ((d.metadata as Record<string, unknown> | null)?.vendor_cancellation_status as string | undefined)
        ?? null,
      refundStatus:
        ((d.chosen_value as Record<string, unknown> | null)?.refund_status as string | undefined)
        ?? ((d.metadata as Record<string, unknown> | null)?.refund_status as string | undefined)
        ?? null,
      completionEvidence:
        ((d.chosen_value as Record<string, unknown> | null)?.completion_evidence as string | undefined)
        ?? ((d.metadata as Record<string, unknown> | null)?.completion_evidence as string | undefined)
        ?? null,
    }));

    const pastConflictsForPrompt = decisionsData
      .filter((decision) => decision.category === "conflict_resolution")
      .slice(0, 5)
      .map((c) => ({
        title: c.title as string,
        resolution:
          ((c.chosen_value as { value?: string } | null)?.value) ?? null,
        reasoning: (c.reasoning as string | null) ?? null,
        stageTag: (c.stage_tag as string | null) ?? null,
        createdAt: c.created_at as string,
      }));

    // 6-d. 시스템 프롬프트 생성
    const systemPrompt = buildAmoraSystemPrompt({
      weddingDate: (journey?.wedding_date as string | null) ?? null,
      budget: (journey?.total_budget as number | null) ?? 0,
      venue: (journey?.venue as string | null) ?? null,
      progress: (journey?.progress as Record<string, unknown>) ?? {},
      brideName,
      groomName,
      senderName,
      bookings: [],
      scheduleEvents: [],
      chatSummaries,
      preferences: undefined,
      pastDecisions,
      pastConflicts: pastConflictsForPrompt,
    }, {
      specialist: "general",
      requestKind: "mediation",
      persistenceMode: "durable",
      enabledToolNames: [],
      maxChars: MAX_MEDIATION_SYSTEM_CHARS,
    });

    // 6-e. OpenAI Responses 입력 — recent 메시지에 [MEDIATION_REQUEST] 추가
    const messageList = recentMessages.map((m) => {
      const boundedContent = m.content.trim().slice(0, MAX_MEDIATION_MESSAGE_CHARS);
      if (m.senderRole === "ai") {
        return { role: "assistant" as const, content: boundedContent };
      }
      const roleLabel = m.senderRole === "bride" ? "신부" : "신랑";
      const target = m.metadata?.target;
      const prefix = target === "partner" ? `[${roleLabel}→상대방]` : `[${roleLabel}]`;
      return { role: "user" as const, content: `${prefix} ${boundedContent}` };
    });

    const triggerRoleLabel =
      profile?.role === "bride" ? "신부" : profile?.role === "groom" ? "신랑" : "사용자";
    messageList.push({
      role: "user" as const,
      content: `[${triggerRoleLabel}] [MEDIATION_REQUEST] 위 커플 대화에서 갈등이 감지되었습니다. 아모라가 중립적으로 중재해주세요. 최근 갈등 맥락: ${detection.conflictContext.slice(0, MAX_CONFLICT_CONTEXT_CHARS)}`,
    });

    // 6-f. Exact count first, then a receipt-scoped atomic reservation at the
    // paid Terra boundary. Known usage settles the conservative maximum.
    let completion: Awaited<ReturnType<typeof createOpenAIResponseWithAudit>>;
    let preparedMediation: ReturnType<typeof extractMediation> | null = null;
    let atomicFinalization: AtomicAmoraChatResponseFinalization | null = null;
    try {
      completion = await runAmoraProviderCallWithLedger(
        {
          userId: user.id,
          coupleId,
          requestKey: conflictProviderRequestKey,
          source: "conflict_check",
          sessionId: messageDigest,
          modelRole: "primary",
          specialistType: "general",
          // A hard heuristic trigger skips Luna verification, so Terra owns
          // the first receipt. Borderline verified conflicts already used #1.
          callIndex: detection.llmVerified ? 2 : 1,
          phase: "conflict_mediation",
          costGuard: conflictCostGuard(
            getAmoraProviderCallCostReservationMicrousd("primary"),
          ),
        },
        async (beforeGeneration) => {
          const result = await createOpenAIResponseWithAudit({
            modelRole: "primary",
            maxInputTokens: AMORA_MAX_INPUT_TOKENS_PER_PROVIDER_CALL,
            maxOutputTokens: 800,
            // 두 사람의 갈등 대화 원문은 토큰 계산 요청에도 그대로 실린다.
            // 유료 생성 게이트는 계산 뒤에 오므로 계산 자체를 보호하지 못한다.
            beforeProviderEgress: assertPrivacyEpochStillCurrent,
            beforeGeneration: async () => {
              await assertPrivacyEpochStillCurrent();
              await beforeGeneration();
            },
            auditPersistence: "external_provider_receipt",
            instructions: systemPrompt,
            input: messageList,
            audit: {
              userId: user.id,
              coupleId,
              interactionType: "amora_director",
              specialistType: "general",
              userInput: null,
              metadata: { source: "auto_conflict_detection", score: detection.score },
            },
          });
          await assertPrivacyEpochStillCurrent();
          return result;
        },
        {
          buildAtomicChatResponse: (providerResult) => {
            const prepared = extractMediation(providerResult.text);
            preparedMediation = prepared;
            // Empty provider output is not a terminal response. Its paid
            // receipt is still settled, but no message/claim completion is
            // fabricated and the route fails closed below.
            if (!prepared.cleanText.trim()) return null;
            if (!durableClaim || durableClaimAttemptCount === null) {
              throw new Error("AMORA_MEDIATION_CLAIM_GENERATION_MISSING");
            }
            if (initialPrivacyEpoch === null) {
              throw new AmoraPrivacyContextError(
                "AMORA_PRIVACY_CONTEXT_UNAVAILABLE",
              );
            }
            return {
              coupleId,
              userId: user.id,
              requestKey: durableClaim.requestKey,
              visibility: "shared",
              claimAttemptCount: durableClaimAttemptCount,
              expectedPrivacyEpoch: initialPrivacyEpoch,
              content: prepared.cleanText,
              metadata: {
                kind: "mediation",
                ...(prepared.mediation ? { mediation: prepared.mediation } : {}),
                source: "auto_conflict_detection",
                score: detection.score,
                llmVerified: detection.llmVerified,
              },
              stageTag: null,
              specialistType: "general",
            };
          },
          onAtomicChatResponseFinalized: (finalization) => {
            atomicFinalization = finalization;
          },
        },
      );
    } catch (error) {
      if (!(error instanceof AmoraCostGuardError)) throw error;
      await failChatRequest({ ...durableClaim, failureCode: "COST_GUARD_REJECTED" }, admin)
        .catch((claimError) => console.error("[check-couple-conflict] claim release failed", claimError));
      durableClaim = null;
      durableClaimAttemptCount = null;
      return respondAndCompleteConflictCheck({
        triggered: false,
        reason: "cost_guard",
      });
    }

    const mediationResult = preparedMediation as
      ReturnType<typeof extractMediation> | null;
    const cleanText = mediationResult?.cleanText ?? completion.text;
    if (!cleanText.trim()) {
      await failChatRequest({ ...durableClaim, failureCode: "EMPTY_RESPONSE" }, admin)
        .catch((error) => console.error("[check-couple-conflict] claim failure marker failed", error));
      durableClaim = null;
      durableClaimAttemptCount = null;
      await releaseConflictCheck("EMPTY_RESPONSE");
      return NextResponse.json(
        { triggered: false, reason: "empty_response" },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    const committed = atomicFinalization as
      AtomicAmoraChatResponseFinalization | null;
    if (committed?.outcome === "cooldown_race_lost") {
      durableClaim = null;
      durableClaimAttemptCount = null;
      return respondAndCompleteConflictCheck({
        triggered: false,
        reason: "race_lost",
      });
    }
    if (committed?.outcome === "privacy_context_changed") {
      durableClaim = null;
      durableClaimAttemptCount = null;
      return respondAndCompleteConflictCheck({
        triggered: false,
        reason: "privacy_context_changed",
      });
    }
    if (committed?.outcome !== "persisted" || !committed.message?.id) {
      throw new Error("AMORA_MEDIATION_ATOMIC_COMMIT_MISSING");
    }
    const insertedMessageId = committed.message.id;
    durableClaim = null;
    durableClaimAttemptCount = null;

    return respondAndCompleteConflictCheck({
      triggered: true,
      messageId: insertedMessageId,
      score: detection.score,
      reason: detection.reason,
      llmVerified: detection.llmVerified,
    });
  } catch (err) {
    console.error("check-couple-conflict 에러:", err);
    const privacyError = err instanceof AmoraPrivacyContextError ? err : null;
    if (durableClaim) {
      await failChatRequest({
        ...durableClaim,
        failureCode: privacyError?.code ?? "MEDIATION_FAILED",
      }, getAdminClient())
        .catch((claimError) => console.error("[check-couple-conflict] claim failure marker failed", claimError));
    }
    if (conflictCheckClaim) {
      await failAmoraConflictCheck({
        ...conflictCheckClaim,
        failureCode: privacyError?.code ?? "CONFLICT_CHECK_FAILED",
      }, getAdminClient()).catch((claimError) => {
        console.error("[check-couple-conflict] conflict-check failure marker failed", claimError);
      });
    }
    return NextResponse.json(
      {
        triggered: false,
        reason: privacyError
          ? privacyError.code === "AMORA_PRIVACY_CONTEXT_CHANGED"
            ? "privacy_context_changed"
            : "privacy_context_unavailable"
          : "internal_error",
      },
      {
        status: privacyError
          ? privacyError.code === "AMORA_PRIVACY_CONTEXT_CHANGED" ? 409 : 503
          : 500,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }
}
