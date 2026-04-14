import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createClientFromRequest } from "@/lib/supabase/server";
import { checkRateLimit, rateLimitKey } from "@/utils/rateLimit";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
});

// 카테고리별 시장 평균가 참고 데이터 (기재부 2024.11 결혼비용 조사 기준, 만원)
const CATEGORY_CONTEXT: Record<string, string> = {
  studio: "스튜디오 촬영: 평균 기본금 120~180만원, 추가금(앨범·원판·보정) 50~100만원",
  dress: "웨딩드레스: 대여 평균 100~200만원, 추가금(악세서리·속옷·글러브) 20~50만원",
  makeup: "메이크업: 평균 80~150만원, 리허설+본식 포함. 추가금(어머니 메이크업, 하객용) 20~50만원",
  venue: "예식장: 식대 1인 5~8만원, 대관료 100~300만원, 꽃장식 100~200만원 별도",
  hanbok: "한복: 대여 평균 30~80만원, 맞춤 100~300만원",
  honeymoon: "신혼여행: 평균 300~500만원 (동남아 기준), 유럽 500~800만원",
  jewelry: "예물(반지 등): 평균 200~500만원",
  gift: "예단/예물: 평균 200~400만원",
  invitation: "청첩장: 평균 20~50만원 (200장 기준)",
  video: "웨딩 영상: 평균 80~200만원 (하이라이트+본식 기준)",
  flower: "부케·꽃장식: 부케 15~40만원, 본식 꽃장식 100~300만원",
  mc: "사회자(MC): 평균 30~60만원",
  pyebaek: "폐백음식: 평균 30~60만원",
  default:
    "스드메(스튜디오+드레스+메이크업) 기본금 평균 346만원, 추가금 평균 174만원. 전체 결혼 비용 평균 3,034만원 (기재부 2024.11)",
};

const SYSTEM_PROMPT = `당신은 한국 웨딩 비용 전문 분석가 '아모라'입니다.
사용자가 업체로부터 받은 견적서 내용을 분석해주세요.

## 분석 기준
- 기재부 2024년 11월 결혼비용 실태조사 데이터
- 전국 평균 결혼 비용: 3,034만원
- 스드메 기본금 평균: 346만원, 추가금 평균: 174만원
- 예식장 식대 1인 평균: 5~8만원
- 전체 추가금 비율: 기본금의 약 50%

## 응답 규칙
1. 견적서에서 항목별 가격을 추출하세요
2. 각 항목을 시장 평균과 비교하세요
3. 숨겨진 비용(추가금, 별도 청구 가능 항목)을 식별하세요
4. 전체 견적에 대한 종합 판정을 내리세요
5. 실용적인 협상 팁을 제공하세요

## 출력 형식 (반드시 아래 JSON 형식만 출력)
{
  "items": [
    {
      "name": "항목명",
      "price": 금액(만원 단위 숫자),
      "market_avg": "시장 평균 범위 (예: '120~180만원')",
      "verdict": "적정" | "비싼 편" | "저렴한 편" | "확인 필요"
    }
  ],
  "total": 총 견적금액(만원 단위 숫자),
  "market_total": "시장 평균 총액 범위 (예: '400~600만원')",
  "overall_verdict": "적정" | "비싼 편" | "저렴한 편",
  "tips": ["협상/절약 팁 문자열 배열"],
  "hidden_costs": ["숨겨진 비용 또는 추가 발생 가능 비용 문자열 배열"]
}

중요: JSON 외에 다른 텍스트를 출력하지 마세요.`;

// 응답 타입
interface QuoteItem {
  name: string;
  price: number;
  market_avg: string;
  verdict: "적정" | "비싼 편" | "저렴한 편" | "확인 필요";
}

interface QuoteAnalysis {
  items: QuoteItem[];
  total: number;
  market_total: string;
  overall_verdict: "적정" | "비싼 편" | "저렴한 편";
  tips: string[];
  hidden_costs: string[];
}

export async function POST(req: NextRequest) {
  try {
    // 1. 인증 확인
    const supabase = await createClientFromRequest(req);
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { error: "로그인이 필요합니다." },
        { status: 401 },
      );
    }

    // 2. Rate limit: 시간당 10회
    const rlKey = rateLimitKey("analyze-quote", req, user.id);
    const rlResult = checkRateLimit(rlKey, {
      maxRequests: 10,
      windowMs: 60 * 60 * 1000, // 1시간
    });
    if (rlResult) return rlResult;

    // 3. 요청 바디 파싱
    const body = await req.json();
    const { quote_text, category } = body as {
      quote_text?: string;
      category?: string;
    };

    if (!quote_text || typeof quote_text !== "string" || !quote_text.trim()) {
      return NextResponse.json(
        { error: "quote_text는 필수입니다." },
        { status: 400 },
      );
    }

    if (quote_text.length > 5000) {
      return NextResponse.json(
        { error: "견적서 텍스트는 5,000자 이내로 입력해주세요." },
        { status: 400 },
      );
    }

    // 4. 카테고리별 참고 데이터 구성
    const categoryRef =
      CATEGORY_CONTEXT[category ?? ""] ?? CATEGORY_CONTEXT.default;

    const userContent = `## 카테고리
${category ?? "미지정"}

## 카테고리별 시장 참고가
${categoryRef}

## 견적서 내용
${quote_text.trim()}`;

    // 5. Claude Haiku 호출
    const message = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1500,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userContent }],
    });

    const firstBlock = message.content[0];
    const responseText =
      firstBlock && firstBlock.type === "text" ? firstBlock.text : "";

    // 6. JSON 파싱
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error("AI 응답 JSON 파싱 실패:", responseText);
      return NextResponse.json(
        { error: "AI 분석 결과를 파싱하지 못했습니다. 다시 시도해주세요." },
        { status: 502 },
      );
    }

    const analysis: QuoteAnalysis = JSON.parse(jsonMatch[0]);

    // 7. 기본 유효성 검증
    if (!Array.isArray(analysis.items) || !analysis.overall_verdict) {
      return NextResponse.json(
        { error: "AI 분석 결과 형식이 올바르지 않습니다." },
        { status: 502 },
      );
    }

    return NextResponse.json({
      analysis,
      analyzed_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error("견적 분석 API 오류:", err);
    return NextResponse.json(
      { error: "견적 분석 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요." },
      { status: 500 },
    );
  }
}
