import { createClientFromRequest } from "@/lib/supabase/server";
import { buildAmoraLifecyclePlan } from "@/lib/amora/lifecycle";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";

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

    // 최근 메시지 확인 (중복 알림 방지) — shared 채널 cooldown만 의미 있음
    const { data: recentMessages } = await admin
      .from("chat_messages")
      .select("id, created_at, sender_type")
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

    // 프로액티브 메시지 저장 — shared 채널로만 발송 (양쪽 모두 봄)
    const { data: inserted } = await admin
      .from("chat_messages")
      .insert({
        couple_id: profile.couple_id,
        sender_id: null,
        sender_type: "ai",
        role: "assistant",
        content: proactiveMessage,
        visibility: "shared",
        metadata: {
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

    return NextResponse.json({
      triggered: true,
      messageId: inserted?.id,
    });
  } catch (err) {
    console.error("프로액티브 체크 에러:", err);
    return NextResponse.json({ triggered: false });
  }
}
