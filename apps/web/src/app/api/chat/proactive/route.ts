import { createClientFromRequest } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";

const CATEGORY_LABELS: Record<string, string> = {
  meeting: "상견례",
  venue: "예식장",
  studio: "스튜디오",
  dress: "드레스/턱시도",
  makeup: "메이크업",
  ring: "예물(반지)",
  hanbok: "한복",
  yedan: "예단",
  honeymoon: "신혼여행",
  houseware: "혼수(가전/가구)",
  housing: "신혼집",
  invitation: "청첩장",
  snap: "본식스냅/영상",
  shoes: "웨딩구두",
  bouquet: "부케/꽃장식",
  gift: "답례품",
  mc: "사회/축가",
  ham: "함",
  pyebaek: "폐백",
};

// D-day 기준 우선순위 일정
const TIMELINE_THRESHOLDS = [
  { dDay: 360, items: ["meeting", "venue"] },
  { dDay: 300, items: ["studio", "dress", "makeup", "ring"] },
  { dDay: 180, items: ["hanbok", "yedan", "honeymoon", "houseware", "housing"] },
  { dDay: 120, items: ["invitation", "snap"] },
  { dDay: 90, items: ["shoes", "bouquet", "gift", "mc", "ham", "pyebaek"] },
];

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

    // 최근 메시지 확인 (중복 알림 방지)
    const { data: recentMessages } = await admin
      .from("chat_messages")
      .select("id, created_at, sender_type")
      .eq("couple_id", profile.couple_id)
      .eq("sender_type", "ai")
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

    // 프로액티브 조건 체크
    const progress = (journey.progress as Record<string, { status: string }>) ?? {};
    let proactiveMessage = "";

    // 조건 1: 예산 미설정
    if (!journey.total_budget || journey.total_budget === 0) {
      proactiveMessage =
        "아직 결혼 예산이 설정되지 않았어요! 예산을 설정하면 카테고리별 배분과 진행 상황을 더 정확하게 관리할 수 있어요. 예산을 설정해 드릴까요?";
    }
    // 조건 2: 결혼 날짜 미설정
    else if (!journey.wedding_date) {
      proactiveMessage =
        "결혼 예정일이 아직 설정되지 않았어요. 날짜가 정해지면 D-day 기준으로 준비 일정을 안내해 드릴 수 있어요. 날짜를 알려주시겠어요?";
    }
    // 조건 3: D-day 기준 해야할 일이 남아있을 때
    else {
      const weddingDate = new Date(journey.wedding_date);
      const dDay = Math.ceil(
        (weddingDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24)
      );

      if (dDay > 0) {
        for (const threshold of TIMELINE_THRESHOLDS) {
          if (dDay <= threshold.dDay) {
            const overdue = threshold.items.filter(
              (item) =>
                !progress[item] || progress[item].status === "not_started"
            );

            if (overdue.length > 0) {
              const labels = overdue
                .map((k) => CATEGORY_LABELS[k] || k)
                .join(", ");
              proactiveMessage = `D-${dDay}이에요! ${labels} 준비가 아직 시작되지 않았어요. 지금 시작하면 여유롭게 준비할 수 있어요. 어떤 항목부터 시작할까요?`;
              break;
            }
          }
        }
      }
    }

    if (!proactiveMessage) {
      return NextResponse.json({ triggered: false });
    }

    // 프로액티브 메시지 저장
    const { data: inserted } = await admin
      .from("chat_messages")
      .insert({
        couple_id: profile.couple_id,
        sender_id: null,
        sender_type: "ai",
        role: "assistant",
        content: proactiveMessage,
        metadata: {
          suggestions: ["예산 설정하기", "일정 확인하기", "준비 현황 보기"],
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
