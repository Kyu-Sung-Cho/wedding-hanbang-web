import { createClientFromRequest } from "@/lib/supabase/server";
import { buildAmoraLifecyclePlan } from "@/lib/amora/lifecycle";
import { buildDueMomentCells } from "@/lib/amora/momentLoop";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import {
  claimChatRequest,
  completeChatRequest,
  failChatRequest,
} from "@/lib/ai/chatRequestClaim";
import { createHash } from "node:crypto";

export async function GET(req: NextRequest) {
  try {
    const supabase = await createClientFromRequest(req);
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ triggered: false });
    }

    const admin = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

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
      .select("*")
      .eq("couple_id", profile.couple_id)
      .single();

    if (!journey) {
      return NextResponse.json({ triggered: false });
    }

    // 1순위: 모멘트 루프 (D-3 챙김 / D-1 출발 전 / D+1 안부) — 친언니의 본체.
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
      const { data: inserted, error: insertError } = await admin
        .from("chat_messages")
        .insert({
          couple_id: profile.couple_id,
          sender_id: null,
          sender_type: "ai",
          role: "assistant",
          content: nextCell.message,
          visibility: "shared",
          metadata: {
            client_request_id: `moment:${nextCell.dedupeKey}`,
            moment: {
              dedupeKey: nextCell.dedupeKey,
              momentType: nextCell.momentType,
              cellKind: nextCell.cellKind,
              momentDate: nextCell.momentDate,
              memoryKeys: nextCell.memoryKeys,
            },
          },
        })
        .select()
        .single();

      // 23505 = 유니크 위반: 동시 요청이 먼저 발화함 — 중복 없이 조용히 종료
      if (insertError) {
        if (insertError.code === "23505") {
          return NextResponse.json({ triggered: false });
        }
        console.error("모멘트 발화 insert 실패:", insertError);
        return NextResponse.json(
          { triggered: false, reason: "persistence_failed" },
          { status: 503 },
        );
      }

      return NextResponse.json({
        triggered: true,
        kind: "moment",
        messageId: inserted?.id,
      });
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

    if (plan.riskLevel === "calm" || plan.primaryAction.severity === "celebrate") {
      return NextResponse.json({ triggered: false });
    }

    const proactiveMessage = [
      plan.primaryAction.title,
      plan.primaryAction.body,
      "",
      `지금은 '${plan.stageLabel}' 단계예요. ${plan.stageSummary}`,
    ].join("\n");

    const lifecycleBucket = Math.floor(Date.now() / (6 * 60 * 60 * 1000));
    const lifecycleDigest = createHash("sha256")
      .update(profile.couple_id)
      .update("\0")
      .update(plan.primaryAction.id)
      .update("\0")
      .update(String(lifecycleBucket))
      .digest("hex");
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
    const { data: inserted, error: insertError } = await admin
      .from("chat_messages")
      .insert({
        couple_id: profile.couple_id,
        sender_id: null,
        sender_type: "ai",
        role: "assistant",
        content: proactiveMessage,
        visibility: "shared",
        metadata: {
          client_request_id: claimParams.requestKey,
          suggestions: plan.guardrails.slice(0, 3).map((item) => item.cta),
          lifecycle: {
            stage: plan.stage,
            riskLevel: plan.riskLevel,
            riskScore: plan.riskScore,
            primaryActionId: plan.primaryAction.id,
            href: plan.primaryAction.href,
          },
        },
      })
      .select()
      .single();

    if (insertError || !inserted?.id) {
      console.error("[chat/proactive] lifecycle persistence failed", insertError);
      await failChatRequest({ ...claimParams, failureCode: "PERSISTENCE_FAILED" }, admin)
        .catch((error) => console.error("[chat/proactive] claim failure marker failed", error));
      return NextResponse.json(
        { triggered: false, reason: "persistence_failed" },
        { status: 503 },
      );
    }

    try {
      await completeChatRequest({ ...claimParams, messageId: inserted.id }, admin);
    } catch (error) {
      console.error("[chat/proactive] lifecycle claim completion failed", error);
      await failChatRequest({ ...claimParams, failureCode: "CLAIM_COMPLETION_FAILED" }, admin)
        .catch((claimError) => console.error("[chat/proactive] claim failure marker failed", claimError));
      return NextResponse.json(
        { triggered: false, reason: "persistence_failed" },
        { status: 503 },
      );
    }

    return NextResponse.json({
      triggered: true,
      kind: "lifecycle",
      messageId: inserted.id,
    });
  } catch (err) {
    console.error("프로액티브 체크 에러:", err);
    return NextResponse.json(
      { triggered: false, reason: "internal_error" },
      { status: 500 },
    );
  }
}
