import { ChatContext } from "@/types/chat.types";

export function buildSystemPrompt(context?: ChatContext): string {
  let prompt = `당신은 '웨딩한방'의 AI 웨딩 플래너입니다.

## 역할
- 한국 결혼 준비에 특화된 전문 상담사
- 친근하고 따뜻한 말투 (존댓말 사용)
- 실용적이고 구체적인 조언 제공
- 이모지를 적절히 사용하여 친근감 표현

## 전문 분야
1. 웨딩홀/스드메(스튜디오, 드레스, 메이크업) 추천
2. 결혼 예산 계획 및 관리
3. 결혼 준비 일정 관리
4. 상견례/예절 가이드
5. 업체 비교 및 추천
6. 한복, 예물, 예단 가이드
7. 청첩장, 주례, 축가 안내
8. 신혼집, 가전, 가구 준비
9. 신혼여행 추천
10. 본식 당일 준비

## 응답 규칙
- 항상 한국어로 답변
- 금액은 만원 단위로 표시 (예: 300만원, 1억 2000만원)
- 불확실한 정보는 확인을 권유
- 업체 추천 시 가격대, 지역, 스타일을 고려
- 체크리스트나 단계별 가이드를 활용하여 구조적으로 안내

## 응답 형식
일반 텍스트로 답변합니다.
중요한 정보는 볼드(**텍스트**)로 강조합니다.
목록은 번호나 불릿으로 정리합니다.`;

  // 컨텍스트 추가
  if (context) {
    prompt += "\n\n## 현재 사용자 컨텍스트";

    if (context.weddingDate) {
      const daysLeft = Math.ceil(
        (new Date(context.weddingDate).getTime() - Date.now()) /
          (1000 * 60 * 60 * 24)
      );
      prompt += `\n- 결혼식 날짜: ${context.weddingDate} (D-${daysLeft > 0 ? daysLeft : 0})`;
    }

    if (context.role) {
      prompt += `\n- 역할: ${context.role === "bride" ? "신부" : "신랑"}`;
    }

    if (context.budget) {
      if (context.budget.total) {
        prompt += `\n- 총 예산: ${context.budget.total}만원`;
      }
      if (context.budget.spent) {
        prompt += `\n- 사용 금액: ${context.budget.spent}만원`;
      }
      if (context.budget.remaining) {
        prompt += `\n- 남은 예산: ${context.budget.remaining}만원`;
      }
    }

    if (context.completedCategories && context.completedCategories.length > 0) {
      prompt += `\n- 완료된 항목: ${context.completedCategories.join(", ")}`;
    }

    if (context.inProgressCategories && context.inProgressCategories.length > 0) {
      prompt += `\n- 진행 중인 항목: ${context.inProgressCategories.join(", ")}`;
    }
  }

  return prompt;
}

export function classifyQuery(
  message: string
): "simple" | "complex" | "vendor" | "budget" | "schedule" {
  const lower = message.toLowerCase();

  if (
    lower.includes("업체") ||
    lower.includes("추천") ||
    lower.includes("스튜디오") ||
    lower.includes("드레스") ||
    lower.includes("메이크업") ||
    lower.includes("웨딩홀")
  ) {
    return "vendor";
  }

  if (
    lower.includes("예산") ||
    lower.includes("비용") ||
    lower.includes("가격") ||
    lower.includes("얼마")
  ) {
    return "budget";
  }

  if (
    lower.includes("일정") ||
    lower.includes("스케줄") ||
    lower.includes("언제") ||
    lower.includes("날짜")
  ) {
    return "schedule";
  }

  if (message.length > 100 || lower.includes("비교") || lower.includes("차이")) {
    return "complex";
  }

  return "simple";
}
