import { createClientFromRequest } from "@/lib/supabase/server";
import { buildAmoraLifecyclePlan } from "@/lib/amora/lifecycle";
import { buildDueMomentCells } from "@/lib/amora/momentLoop";
import { createAdminClient } from "@/lib/supabase/admin";
import { NextRequest, NextResponse } from "next/server";
import {
  claimChatRequest,
  completeChatRequest,
  failChatRequest,
} from "@/lib/ai/chatRequestClaim";
import { shouldRecallSavedNotes } from "@/lib/amora/savedNotesRecall";
import { checkRateLimitPersistent, rateLimitKey } from "@/utils/rateLimit";
import { isAmoraProactiveChatEnabled } from "@/lib/features/amoraCareFlags";
import { buildLifecycleCareDigest } from "@/lib/amora/careMessageIdentity";
import { log } from "@/utils/log";

const MUTATION_RESPONSE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  Vary: "Origin, Sec-Fetch-Site",
};

type MomentCareInsertResult =
  | { state: "inserted"; messageId: string }
  | { state: "source_stale" | "consent_required" };

function parseMomentCareInsertResult(value: unknown): MomentCareInsertResult | null {
  if (!value || typeof value !== "object" || !("state" in value)) return null;
  const state = (value as { state?: unknown }).state;
  if (state === "source_stale" || state === "consent_required") {
    return { state };
  }
  const messageId = (value as { message_id?: unknown }).message_id;
  if (state === "inserted" && typeof messageId === "string") {
    return { state, messageId };
  }
  return null;
}

export async function GET() {
  return NextResponse.json(
    { triggered: false, reason: "method_not_allowed" },
    {
      status: 405,
      headers: {
        ...MUTATION_RESPONSE_HEADERS,
        Allow: "POST",
      },
    },
  );
}

export async function POST(req: NextRequest) {
  if (!isSameOriginMutation(req)) {
    return NextResponse.json(
      { triggered: false, reason: "invalid_origin" },
      { status: 403, headers: MUTATION_RESPONSE_HEADERS },
    );
  }
  const response = await handleProactiveRequest(req);
  for (const [name, value] of Object.entries(MUTATION_RESPONSE_HEADERS)) {
    response.headers.set(name, value);
  }
  return response;
}

function isSameOriginMutation(req: NextRequest): boolean {
  const fetchSite = req.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin") return false;

  const origin = req.headers.get("origin");
  if (origin) {
    try {
      return new URL(origin).origin === req.nextUrl.origin;
    } catch {
      return false;
    }
  }

  // Browsers supply Sec-Fetch-Site for fetch requests even when an older
  // user agent or intermediary omits Origin. Requests with neither proof fail closed.
  return fetchSite === "same-origin";
}

async function handleProactiveRequest(req: NextRequest) {
  // 2026-07-24 스위치 분리: 이 경로는 사용자가 앱을 열었을 때 채팅 안에
  // 케어 메시지를 넣는 인앱 선제 발화다(외부 발송 0). 이메일 아웃바운드
  // (AMORA_CARE_OUTBOUND_ENABLED, cron/care-moments)와 별개 스위치로 게이트해
  // "먼저 챙기는 언니"를 이메일 격리와 독립적으로 켤 수 있게 한다.
  // Fail closed before authentication, service-role construction, or user reads.
  if (!isAmoraProactiveChatEnabled()) {
    return NextResponse.json({ triggered: false, reason: "proactive_chat_disabled" });
  }
  try {
    const supabase = await createClientFromRequest(req);
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ triggered: false });
    }

    const limited = await checkRateLimitPersistent(
      rateLimitKey("chat:proactive", req, user.id),
      { maxRequests: 6, windowMs: 10 * 60 * 1000 },
      { failClosed: true },
    );
    if (limited) return limited;

    const admin = createAdminClient();

    // 프로필 + 커플 조회
    const { data: profile } = await admin
      .from("profiles")
      .select("couple_id, name")
      .eq("id", user.id)
      .single();

    if (!profile?.couple_id) {
      return NextResponse.json({ triggered: false });
    }

    // 여정 조회
    const { data: journey } = await admin
      .from("wedding_journeys")
      .select("wedding_date, venue, total_budget, progress, state_revision")
      .eq("couple_id", profile.couple_id)
      .single();

    if (!journey) {
      return NextResponse.json({ triggered: false });
    }

    // 1순위: 모멘트 루프 (D-3 확인 / D-1 출발 전 / D+1 안부).
    // 일반 6시간 쿨다운의 예외지만, 같은 셀은 한 번만 발화한다.
    // 중복 방지는 "due 셀의 키를 직접 조회"(윈도우 밀림 없음) + 기존 유니크 인덱스
    // chat_messages_client_request_id_unique(couple_id, metadata->>client_request_id)로
    // 동시 요청 레이스까지 차단.
    const dueCells = buildDueMomentCells({
      weddingDate: journey.wedding_date,
      progress: journey.progress,
    });

    let nextCell = null;
    if (dueCells.length > 0) {
      const dueKeys = dueCells.map((cell) => `moment:${cell.dedupeKey}`);
      const { data: sentRows } = await admin
        .from("chat_messages")
        .select("metadata")
        .eq("couple_id", profile.couple_id)
        .eq("sender_type", "ai")
        .in("metadata->>client_request_id", dueKeys);

      const sentKeys = new Set(
        (sentRows ?? [])
          .map((row) => (row.metadata as { client_request_id?: string } | null)?.client_request_id)
          .filter(Boolean) as string[]
      );
      nextCell = dueCells.find((cell) => !sentKeys.has(`moment:${cell.dedupeKey}`)) ?? null;
    }

    if (nextCell) {
      if (
        typeof journey.state_revision !== "number"
        || !Number.isSafeInteger(journey.state_revision)
        || journey.state_revision < 0
      ) {
        return NextResponse.json(
          { triggered: false, reason: "source_revision_unavailable" },
          { status: 503 },
        );
      }

      const { data: insertResultValue, error: insertError } = await admin.rpc(
        "insert_amora_moment_care_message",
        {
          p_couple_id: profile.couple_id,
          p_expected_journey_revision: journey.state_revision,
          p_content: nextCell.message,
          p_metadata: {
            client_request_id: `moment:${nextCell.dedupeKey}`,
            moment: {
              dedupeKey: nextCell.dedupeKey,
              momentType: nextCell.momentType,
              cellKind: nextCell.cellKind,
              momentDate: nextCell.momentDate,
              memoryKeys: nextCell.memoryKeys,
              sourceRevision: journey.state_revision,
            },
          },
        },
      );

      // 23505 = 유니크 위반: 동시 요청이 먼저 발화함 — 중복 없이 조용히 종료
      if (insertError) {
        if (insertError.code === "23505") {
          return NextResponse.json({ triggered: false });
        }
        log.error("모멘트 발화 insert 실패:", insertError);
        return NextResponse.json(
          { triggered: false, reason: "persistence_failed" },
          { status: 503 },
        );
      }

      const insertResult = parseMomentCareInsertResult(insertResultValue);
      if (!insertResult) {
        return NextResponse.json(
          { triggered: false, reason: "persistence_failed" },
          { status: 503 },
        );
      }
      if (insertResult.state !== "inserted") {
        return NextResponse.json({ triggered: false, reason: insertResult.state });
      }

      return NextResponse.json({
        triggered: true,
        kind: "moment",
        messageId: insertResult.messageId,
      });
    }

    // 1.5순위: 저장해 둔 이야기 회수.
    //
    // 저장 버튼은 만들었는데 저장본이 스스로 찾아오지 않으면 아무도 다시 안 본다.
    // 위약금·확인할 것을 저장해 두는 시점은 대개 알아보는 중이고, 정작 필요한 건
    // 계약이 몰리는 예식 두 달 전이다. 그날 한 번만 조용히 알린다.
    //
    // 내용은 언급하지 않는다 — 저장본은 커플의 것이고, 우리가 요약하면 그것도 해석이다.
    const { count: savedNoteCount } = await admin
      .from("amora_saved_notes")
      .select("id", { count: "exact", head: true })
      .eq("couple_id", profile.couple_id);
    const savedRecall = shouldRecallSavedNotes({
      weddingDate: journey.wedding_date,
      savedCount: savedNoteCount ?? 0,
    });
    if (savedRecall) {
      const { data: recallMessageId, error: recallError } = await admin.rpc(
        "insert_amora_care_message",
        {
          p_couple_id: profile.couple_id,
          p_content: savedRecall.message,
          p_metadata: { client_request_id: savedRecall.requestId },
        },
      );
      // 23505 = 동시 요청이 먼저 발화 — 중복 없이 조용히 종료
      if (recallError && recallError.code !== "23505") {
        log.error("저장본 회수 발화 실패:", recallError);
      } else if (typeof recallMessageId === "string") {
        return NextResponse.json({
          triggered: true,
          kind: "saved_notes_recall",
          messageId: recallMessageId,
        });
      }
    }

    // 2순위: lifecycle 가드레일 — 기존 동작 유지 (6시간 쿨다운 적용)
    const { data: recentMessages } = await admin
      .from("chat_messages")
      .select("id, created_at")
      .eq("couple_id", profile.couple_id)
      .eq("sender_type", "ai")
      .eq("visibility", "shared")
      .order("created_at", { ascending: false })
      .limit(1);

    const lastAiMessage = recentMessages?.[0];
    if (lastAiMessage) {
      const hoursSince =
        (Date.now() - new Date(lastAiMessage.created_at).getTime()) /
        (1000 * 60 * 60);
      // 마지막 AI 메시지가 6시간 이내면 프로액티브 안함
      if (hoursSince < 6) {
        return NextResponse.json({ triggered: false });
      }
    }

    const plan = buildAmoraLifecyclePlan({
      weddingDate: journey.wedding_date,
      venue: journey.venue,
      totalBudget: journey.total_budget,
      progress: journey.progress,
    });

    if (
      plan.primaryAction.severity !== "critical"
      && plan.primaryAction.severity !== "warning"
    ) {
      return NextResponse.json({ triggered: false });
    }

    const proactiveMessage = [
      plan.primaryAction.title,
      plan.primaryAction.body,
      "",
      `지금은 '${plan.stageLabel}' 단계예요. ${plan.stageSummary}`,
    ].join("\n");

    // 예전에는 여기에 6시간 버킷이 들어 있어서, 내용이 한 글자도 바뀌지 않았는데
    // 6시간마다 새 키가 되어 같은 메시지가 무기한 다시 나갔다. 상태가 바뀔 때만
    // 다시 말한다 — 그 상태는 `primaryAction.id`가 담는다.
    const lifecycleDigest = buildLifecycleCareDigest(
      profile.couple_id,
      plan.primaryAction.id,
    );
    const claimParams = {
      coupleId: profile.couple_id,
      requestKey: `lifecycle:${lifecycleDigest}`,
      userId: user.id,
      visibility: "shared" as const,
    };
    const claim = await claimChatRequest(claimParams, admin);
    if (claim.action !== "acquired") {
      return NextResponse.json({
        triggered: false,
        reason: claim.action === "completed" ? "already_completed" : claim.action,
      });
    }

    // 프로액티브 메시지 저장 — shared 채널로만 발송 (양쪽 모두 봄)
    const { data: rpcMessageId, error: insertError } = await admin.rpc(
      "insert_amora_care_message",
      {
        p_couple_id: profile.couple_id,
        p_content: proactiveMessage,
        p_metadata: {
          client_request_id: claimParams.requestKey,
          suggestions: plan.guardrails.slice(0, 3).map((item) => item.cta),
          lifecycle: {
            stage: plan.stage,
            severity: plan.primaryAction.severity,
            primaryActionId: plan.primaryAction.id,
            href: plan.primaryAction.href,
          },
        },
      },
    );
    let insertedMessageId = typeof rpcMessageId === "string" ? rpcMessageId : null;
    let persistenceError = insertError;
    let duplicateWithoutMessage = false;
    if (insertError?.code === "23505") {
      // A concurrent request may have persisted the same idempotency key after
      // this request acquired its claim. Complete only after reading that real row.
      const { data: existing, error: existingError } = await admin
        .from("chat_messages")
        .select("id")
        .eq("couple_id", profile.couple_id)
        .eq("metadata->>client_request_id", claimParams.requestKey)
        .maybeSingle();
      insertedMessageId = typeof existing?.id === "string" ? existing.id : null;
      persistenceError = existingError;
      duplicateWithoutMessage = !existingError && !insertedMessageId;
    }

    if (persistenceError || duplicateWithoutMessage || typeof insertedMessageId !== "string") {
      log.error("[chat/proactive] lifecycle persistence failed", persistenceError);
      const failureCode = persistenceError || duplicateWithoutMessage
        ? "PERSISTENCE_FAILED"
        : "CONSENT_REQUIRED";
      await failChatRequest({ ...claimParams, failureCode }, admin)
        .catch((error) => log.error("[chat/proactive] claim failure marker failed", error));
      if (!persistenceError && !duplicateWithoutMessage) {
        return NextResponse.json({ triggered: false, reason: "consent_required" });
      }
      return NextResponse.json(
        { triggered: false, reason: "persistence_failed" },
        { status: 503 },
      );
    }

    try {
      await completeChatRequest({ ...claimParams, messageId: insertedMessageId }, admin);
    } catch (error) {
      log.error("[chat/proactive] lifecycle claim completion failed", error);
      await failChatRequest({ ...claimParams, failureCode: "CLAIM_COMPLETION_FAILED" }, admin)
        .catch((claimError) => log.error("[chat/proactive] claim failure marker failed", claimError));
      return NextResponse.json(
        { triggered: false, reason: "persistence_failed" },
        { status: 503 },
      );
    }

    return NextResponse.json({
      triggered: true,
      kind: "lifecycle",
      messageId: insertedMessageId,
    });
  } catch (err) {
    log.error("프로액티브 체크 에러:", err);
    return NextResponse.json(
      { triggered: false, reason: "internal_error" },
      { status: 500 },
    );
  }
}
