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
 *     b. Claude API 호출하여 [MEDIATION_REQUEST] 응답 생성
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
import { getWeddingPlannerSystemPrompt } from "@/lib/ai/prompts";
import { checkRateLimit, rateLimitKey } from "@/utils/rateLimit";
import { checkAmoraCostGuard } from "@/lib/ai/costGuard";
import { createAnthropicMessageWithAudit } from "@/lib/ai/auditedAnthropic";

const MEDIATION_MODEL = "claude-sonnet-4-6";
const MEDIATION_COOLDOWN_MIN = 10;
const RECENT_MESSAGE_LIMIT = 20;

function getAdminClient() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

export async function POST(req: NextRequest) {
  try {
    // ── 1. 인증 + 커플 확인 ───────────────────────────────────
    const supabase = await createClientFromRequest(req);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ triggered: false, reason: "unauthenticated" }, { status: 401 });
    }

    // Rate limit — 이 라우트는 mediation 시 LLM(Sonnet)을 호출하므로, 메인 채팅과
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
      .select("content, sender_type, sender_id, created_at, visibility, metadata")
      .eq("couple_id", coupleId)
      .eq("visibility", "shared")
      .order("created_at", { ascending: false })
      .limit(RECENT_MESSAGE_LIMIT);

    if (!rawMessages || rawMessages.length < 2) {
      return NextResponse.json({ triggered: false, reason: "insufficient_messages" });
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
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json({
        triggered: false,
        reason: "ANTHROPIC_API_KEY 없음",
      });
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
    const systemPrompt = getWeddingPlannerSystemPrompt({
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
      feedbackLessons: [],
      pastDecisions,
      pastConflicts: pastConflictsForPrompt,
    });

    // 6-e. Claude API 호출용 메시지 — recent 메시지에 [MEDIATION_REQUEST] 추가
    const messageList = recentMessages.map((m) => {
      if (m.senderRole === "ai") {
        return { role: "assistant" as const, content: m.content };
      }
      const roleLabel = m.senderRole === "bride" ? "신부" : "신랑";
      const target = m.metadata?.target;
      const prefix = target === "partner" ? `[${roleLabel}→상대방]` : `[${roleLabel}]`;
      return { role: "user" as const, content: `${prefix} ${m.content}` };
    });

    const triggerRoleLabel =
      profile?.role === "bride" ? "신부" : profile?.role === "groom" ? "신랑" : "사용자";
    messageList.push({
      role: "user" as const,
      content: `[${triggerRoleLabel}] [MEDIATION_REQUEST] 위 커플 대화에서 갈등이 감지되었습니다. 아모라가 중립적으로 중재해주세요. 최근 갈등 맥락: ${detection.conflictContext}`,
    });

    // 6-f. Claude 호출 (non-streaming)
    const completion = await createAnthropicMessageWithAudit({
      params: {
        model: MEDIATION_MODEL,
        max_tokens: 800,
        system: systemPrompt,
        messages: messageList,
        temperature: 0.6,
      },
      audit: {
        userId: user.id,
        coupleId,
        interactionType: "chat_turn",
        specialistType: "general",
        userInput: detection.conflictContext ?? "",
        metadata: { source: "auto_conflict_detection", score: detection.score },
      },
    });

    const fullText = completion.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("");

    const { cleanText, mediation } = extractMediation(fullText);
    if (!cleanText.trim()) {
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
      return NextResponse.json({ triggered: false, reason: "race_lost" });
    }

    const { data: inserted } = await admin
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
        },
      })
      .select("id")
      .single();

    return NextResponse.json({
      triggered: true,
      messageId: inserted?.id ?? null,
      score: detection.score,
      reason: detection.reason,
      llmVerified: detection.llmVerified,
    });
  } catch (err) {
    console.error("check-couple-conflict 에러:", err);
    return NextResponse.json(
      {
        triggered: false,
        reason: `error: ${err instanceof Error ? err.message : "unknown"}`,
      },
      { status: 500 },
    );
  }
}
