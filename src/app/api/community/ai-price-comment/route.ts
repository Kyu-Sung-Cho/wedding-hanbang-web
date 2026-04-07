import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import type { PriceData, AiComment } from "@/types/community.types";

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

    const userContent = `카테고리: ${priceData.vendor_category}
기본금: ${priceData.base_price}만원
추가금: ${priceData.extra_price ?? 0}만원
업체명: ${priceData.vendor_name ?? "미상"}
지역: ${priceData.region ?? "미상"}
상세: ${priceData.details ?? "없음"}`;

    const message = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 300,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userContent }],
    });

    const firstBlock = message.content[0];
    const text = firstBlock && firstBlock.type === "text" ? firstBlock.text : "";

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
    return NextResponse.json(
      { error: "AI 코멘트 생성 실패" },
      { status: 500 }
    );
  }
}
