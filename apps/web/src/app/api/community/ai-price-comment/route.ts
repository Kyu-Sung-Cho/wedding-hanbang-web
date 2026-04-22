import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import type { PriceData, AiComment } from "@/types/community.types";
import { logAIInteraction, startLatencyClock, elapsedMs } from "@/lib/compliance/ai-log";
import { createClientFromRequest } from "@/lib/supabase/server";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
});

const SYSTEM_PROMPT = `You are the wedding hanbang AI 아모라 price analyzer. Given a vendor price, compare to Korean wedding industry averages and write a SHORT 1-2 sentence Korean comment.

References (기재부 2024.11):
- 스튜디오/드레스/메이크업 기본금 평균: 346만원
- 평균 추가금: 174만원

Output JSON only:
{
  "text": "1-2문장 한국어 코멘트",
  "comparison": "below|average|above",
  "percentage": <int 평균 대비 %>,
  "reference": "기재부 2024.11 기준 평균 346만원"
}`;

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { priceData: PriceData };
    const { priceData } = body;

    if (!priceData || typeof priceData.base_price !== "number") {
      return NextResponse.json({ error: "priceData 누락" }, { status: 400 });
    }

    // best-effort 인증: 쿠키로 세션이 있으면 userId 캡처 (없으면 null)
    let loggingUserId: string | null = null;
    try {
      const supabase = await createClientFromRequest(req);
      const { data: { user } } = await supabase.auth.getUser();
      loggingUserId = user?.id ?? null;
    } catch {
      // 세션 없으면 익명 호출 — 로깅만 null로 진행
    }

    const userContent = `카테고리: ${priceData.vendor_category}
기본금: ${priceData.base_price}만원
추가금: ${priceData.extra_price ?? 0}만원
업체명: ${priceData.vendor_name ?? "미상"}
지역: ${priceData.region ?? "미상"}
상세: ${priceData.details ?? "없음"}`;

    const startedAt = startLatencyClock();
    const model = "claude-haiku-4-5-20251001";
    const message = await anthropic.messages.create({
      model,
      max_tokens: 300,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userContent }],
    });

    const firstBlock = message.content[0];
    const text = firstBlock && firstBlock.type === "text" ? firstBlock.text : "";

    // D1: 호출 로깅 (fire-and-forget)
    // userId는 요청자(글 draft 중인 유저) — best-effort로 캡처.
    void logAIInteraction({
      userId: loggingUserId,
      interactionType: "community_amora_comment",
      specialistType: "budget_optimizer",
      userInput: userContent,
      aiOutput: text,
      latencyMs: elapsedMs(startedAt),
      success: true,
      model,
      tokensInput: message.usage?.input_tokens,
      tokensOutput: message.usage?.output_tokens,
      metadata: {
        endpoint: "ai-price-comment",
        vendor_category: priceData.vendor_category ?? null,
        region: priceData.region ?? null,
        comment_position: "top_level",
      },
    });

    // JSON 추출
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("JSON 응답 파싱 실패");
    }
    const parsed = JSON.parse(jsonMatch[0]) as Omit<AiComment, "generated_at">;

    const aiComment: AiComment = {
      text: parsed.text,
      comparison: parsed.comparison,
      percentage: parsed.percentage,
      reference: parsed.reference,
      generated_at: new Date().toISOString(),
    };

    return NextResponse.json({ aiComment });
  } catch (err) {
    console.error("AI price comment error:", err);
    void logAIInteraction({
      interactionType: "community_amora_comment",
      success: false,
      errorMessage: err instanceof Error ? err.message : String(err),
      metadata: { endpoint: "ai-price-comment" },
    });
    return NextResponse.json(
      { error: "AI 코멘트 생성 실패" },
      { status: 500 }
    );
  }
}
