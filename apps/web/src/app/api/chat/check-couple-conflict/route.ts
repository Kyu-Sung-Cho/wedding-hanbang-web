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
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { createClientFromRequest } from "@/lib/supabase/server";
import { detectCoupleConflict, type CoupleMessage } from "@/lib/ai/conflict-detector";
import { extractMediation } from "@/lib/ai/mediation";
import { buildAmoraSystemPrompt } from "@/lib/ai/amoraPromptComposer";
import { checkRateLimit, rateLimitKey } from "@/utils/rateLimit";
import { checkAmoraCostGuard, reserveAmoraTurn } from "@/lib/ai/costGuard";
import { createOpenAIResponseWithAudit } from "@/lib/ai/auditedOpenAI";
import { hasOpenAIConfig } from "@/lib/ai/modelConfig";
import {
  claimChatRequest,
  completeChatRequest,
  failChatRequest,
} from "@/lib/ai/chatRequestClaim";
import { createHash } from "node:crypto";

const MEDIATION_COOLDOWN_MIN = 10;
const RECENT_MESSAGE_LIMIT = 20;
const MAX_MEDIATION_SYSTEM_CHARS = 48_000;
const MAX_MEDIATION_MESSAGE_CHARS = 1_200;
const MAX_CONFLICT_CONTEXT_CHARS = 2_000;

function getAdminClient() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

export async function POST(req: NextRequest) {
  let durableClaim: {
    coupleId: string;
    requestKey: string;
    userId: string;
    visibility: "shared";
  } | null = null;
  try {
    // ── 1. 인증 + 커플 확인 ───────────────────────────────────
    const supabase = await createClientFromRequest(req);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ triggered: false, reason: "unauthenticated" }, { status: 401 });
    }

    // Rate limit — 이 라우트는 중재 시 OpenAI 모델을 호출하므로, 메인 채팅과
    // 별개로 호출 빈도를 제한해 borderline 구간 반복 호출로 인한 LLM 폭주를 막는다.
    const limited = checkRateLimit(rateLimitKey("conflict-check", req, user.id), {
      maxRequests: 30,
      windowMs: 60 * 60 * 1000,
    });
    if (limited) return NextResponse.json({ triggered: false, reason: "rate_limited" });

    const body = (await req.json().catch(() => ({}))) as { coupleId?: string };
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

    // 비용 가드 — mediation LLM 호출도 메인 채팅과 같은 장부(chat_turn)를 공유한다.
    // 상한 도달 시 detector 실행 전에 차단(가드 밖 LLM 호출 사각지대 제거).
    // 여기는 읽기전용 체크만 — 이 라우트는 파트너 메시지마다 fire-and-forget으로
    // 호출되고 대부분 LLM 0회로 끝나므로, 예약(턴 소모)은 mediation 직전에만 한다.
    const guard = await checkAmoraCostGuard(admin, {
      coupleId,
      isAdmin: profile?.is_admin === true,
    });
    if (!guard.allowed) {
      return NextResponse.json({ triggered: false, reason: "cost_guard" });
    }

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

    const recentMessages: CoupleMessage[] = rawMessages
      .map((m) => ({
        content: m.content as string,
        senderRole: m.sender_type as CoupleMessage["senderRole"],
        createdAt: m.created_at as string,
        visibility: m.visibility as CoupleMessage["visibility"],
        metadata: m.metadata as CoupleMessage["metadata"],
      }))
      .reverse(); // 시간 오름차순으로 정렬

    // ── 4. 과거 conflict_resolution decision_nodes ────────────
    const { data: pastConflictsRaw } = await admin
      .from("decision_nodes")
      .select("title, created_at")
      .eq("couple_id", coupleId)
      .eq("category", "conflict_resolution")
      .order("created_at", { ascending: false })
      .limit(10);

    const pastConflicts = (pastConflictsRaw ?? []).map((c) => ({
      title: c.title as string,
      createdAt: c.created_at as string,
    }));

    // ── 5. detector 실행 ──────────────────────────────────────
    const detection = await detectCoupleConflict({
      coupleId,
      userId: user.id,
      recentSharedMessages: recentMessages,
      pastConflicts,
      windowMinutes: 5,
    });

    if (!detection.triggered) {
      return NextResponse.json({
        triggered: false,
        score: detection.score,
        reason: detection.reason,
        llmVerified: detection.llmVerified,
      });
    }

    // ── 6. mediation 메시지 생성 ─────────────────────────────
    if (!hasOpenAIConfig("primary")) {
      return NextResponse.json({
        triggered: false,
        reason: "openai_not_configured",
      });
    }

    const mediationDigest = createHash("sha256")
      .update(coupleId)
      .update("\0")
      .update(
        rawMessages
          .map((message) => String(message.id))
          .sort()
          .join(","),
      )
      .digest("hex");
    durableClaim = {
      coupleId,
      requestKey: `mediation:${mediationDigest}`,
      userId: user.id,
      visibility: "shared",
    };
    const claim = await claimChatRequest(durableClaim, admin);
    if (claim.action === "completed") {
      return NextResponse.json({ triggered: false, reason: "already_completed" });
    }
    if (claim.action === "in_progress") {
      return NextResponse.json({ triggered: false, reason: "in_progress" }, { status: 409 });
    }
    if (claim.action === "conflict") {
      return NextResponse.json({ triggered: false, reason: "request_conflict" }, { status: 409 });
    }

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
    const { data: summariesRaw } = await admin
      .from("chat_summaries")
      .select("summary")
      .eq("couple_id", coupleId)
      .eq("visibility", "shared")
      .order("created_at", { ascending: false })
      .limit(3);
    const chatSummaries = (summariesRaw ?? []).map((s) => s.summary as string);

    // 6-c. pastDecisions / pastConflicts 요약 풀어주기
    const { data: decisionsRaw } = await admin
      .from("decision_nodes")
      .select("category, decision_type, title, chosen_value, reasoning, confidence, source, created_at")
      .eq("couple_id", coupleId)
      .eq("visibility", "shared")
      .order("created_at", { ascending: false })
      .limit(30);
    const pastDecisions = (decisionsRaw ?? []).map((d) => ({
      category: d.category as string,
      decisionType: d.decision_type as string,
      title: d.title as string,
      value: ((d.chosen_value as { value?: string } | null)?.value) ?? null,
      reasoning: (d.reasoning as string | null) ?? null,
      confidence: (d.confidence as number | null) ?? 0.5,
      source: d.source as string,
      createdAt: d.created_at as string,
    }));

    const { data: conflictsForPromptRaw } = await admin
      .from("decision_nodes")
      .select("title, chosen_value, reasoning, stage_tag, created_at")
      .eq("couple_id", coupleId)
      .eq("category", "conflict_resolution")
      .eq("visibility", "shared")
      .order("created_at", { ascending: false })
      .limit(5);
    const pastConflictsForPrompt = (conflictsForPromptRaw ?? []).map((c) => ({
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

    // 6-f. OpenAI 호출 (non-streaming, 고위험 중재는 Terra)
    // 실제 LLM 호출 직전 원자 예약 — 앞단 읽기전용 체크와 달리 여기서 턴 1회를
    // 소모 확정한다 (동시 요청 상한 초과 방지, 감사 2.3 H1).
    const reserved = await reserveAmoraTurn(admin, {
      coupleId,
      isAdmin: profile?.is_admin === true,
    });
    if (!reserved.allowed) {
      await failChatRequest({ ...durableClaim, failureCode: "COST_GUARD_REJECTED" }, admin)
        .catch((error) => console.error("[check-couple-conflict] claim release failed", error));
      durableClaim = null;
      return NextResponse.json({ triggered: false, reason: "cost_guard" });
    }

    const completion = await createOpenAIResponseWithAudit({
      modelRole: "primary",
      maxOutputTokens: 800,
      instructions: systemPrompt,
      input: messageList,
      audit: {
        userId: user.id,
        coupleId,
        interactionType: "chat_turn",
        specialistType: "general",
        userInput: null,
        metadata: { source: "auto_conflict_detection", score: detection.score },
      },
    });

    const fullText = completion.text;

    const { cleanText, mediation } = extractMediation(fullText);
    if (!cleanText.trim()) {
      await failChatRequest({ ...durableClaim, failureCode: "EMPTY_RESPONSE" }, admin)
        .catch((error) => console.error("[check-couple-conflict] claim failure marker failed", error));
      durableClaim = null;
      return NextResponse.json({ triggered: false, reason: "empty_response" });
    }

    // ── 7. 결과 INSERT — race 방어 위해 마지막 cooldown 한 번 더 체크 ─
    const { data: secondCheck } = await admin
      .from("chat_messages")
      .select("id, metadata")
      .eq("couple_id", coupleId)
      .eq("sender_type", "ai")
      .eq("visibility", "shared")
      .gte("created_at", cooldownCutoff)
      .order("created_at", { ascending: false })
      .limit(5);
    const lateMediationFound =
      (secondCheck ?? []).some((m) => {
        const md = m.metadata as { kind?: string; mediation?: unknown } | null;
        return md?.kind === "mediation" || Boolean(md?.mediation);
      });
    if (lateMediationFound) {
      // 다른 클라이언트가 먼저 mediation INSERT — 우리는 abort
      await failChatRequest({ ...durableClaim, failureCode: "COOLDOWN_RACE_LOST" }, admin)
        .catch((error) => console.error("[check-couple-conflict] claim release failed", error));
      durableClaim = null;
      return NextResponse.json({ triggered: false, reason: "race_lost" });
    }

    const { data: inserted, error: insertError } = await admin
      .from("chat_messages")
      .insert({
        couple_id: coupleId,
        sender_id: null,
        sender_type: "ai",
        role: "assistant",
        content: cleanText,
        visibility: "shared",
        metadata: {
          kind: "mediation",
          ...(mediation ? { mediation } : {}),
          source: "auto_conflict_detection",
          score: detection.score,
          llmVerified: detection.llmVerified,
          client_request_id: durableClaim.requestKey,
        },
      })
      .select("id")
      .single();

    if (insertError || !inserted?.id) {
      if (insertError?.code === "23505") {
        const { data: existing } = await admin
          .from("chat_messages")
          .select("id")
          .eq("couple_id", coupleId)
          .eq("metadata->>client_request_id", durableClaim.requestKey)
          .eq("sender_type", "ai")
          .eq("role", "assistant")
          .eq("visibility", "shared")
          .limit(1);
        if (existing?.[0]?.id) {
          await completeChatRequest(
            { ...durableClaim, messageId: existing[0].id as string },
            admin,
          );
          durableClaim = null;
          return NextResponse.json({ triggered: false, reason: "race_lost" });
        }
      }
      console.error("[check-couple-conflict] mediation persistence failed", insertError);
      await failChatRequest({ ...durableClaim, failureCode: "PERSISTENCE_FAILED" }, admin)
        .catch((error) => console.error("[check-couple-conflict] claim failure marker failed", error));
      durableClaim = null;
      return NextResponse.json(
        { triggered: false, reason: "persistence_failed" },
        { status: 503 },
      );
    }

    await completeChatRequest({ ...durableClaim, messageId: inserted.id }, admin);
    durableClaim = null;

    return NextResponse.json({
      triggered: true,
      messageId: inserted.id,
      score: detection.score,
      reason: detection.reason,
      llmVerified: detection.llmVerified,
    });
  } catch (err) {
    console.error("check-couple-conflict 에러:", err);
    if (durableClaim) {
      await failChatRequest({ ...durableClaim, failureCode: "MEDIATION_FAILED" }, getAdminClient())
        .catch((claimError) => console.error("[check-couple-conflict] claim failure marker failed", claimError));
    }
    return NextResponse.json(
      {
        triggered: false,
        reason: "internal_error",
      },
      { status: 500 },
    );
  }
}
