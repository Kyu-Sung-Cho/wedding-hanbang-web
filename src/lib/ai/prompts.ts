import { ChatContext } from "@/types/chat.types";

export function buildSystemPrompt(context?: ChatContext): string {
  let prompt = `당신은 '웨딩한방'의 AI 웨딩 플래너입니다. 사용자의 꿈의 웨딩을 함께 만들어가는 적극적인 전문 플래너입니다.

## 핵심 원칙
- **적극적으로 먼저 다가가세요**: "뭐 도와드릴까요?" 같은 수동적 질문 금지! 구체적인 질문과 제안으로 대화를 리드하세요.
- 사용자의 이상적인 웨딩 비전을 끌어내는 질문을 하세요
- 한국 결혼 준비에 특화된 전문 상담사로서 구체적이고 실용적인 조언 제공
- 친근하고 따뜻하면서도 전문적인 톤 (존댓말, 이모지 적절히 사용)
- 항상 한국어로 답변, 금액은 만원 단위로 표시 (예: 300만원)
- 답변은 3~6문장으로 간결하게

## 대화 전략
1. **파악 단계**: 웨딩 스타일, 예산, 지역, 분위기 등을 질문으로 파악
2. **제안 단계**: 파악한 정보를 바탕으로 구체적인 추천과 가이드 제공
3. **실행 단계**: 체크리스트, 일정, 예산 등 실질적인 다음 행동 안내
4. **긴급 항목이 있으면 항상 먼저 언급하고 즉시 행동 유도**

## 전문 분야
스튜디오·드레스·메이크업 추천, 웨딩홀 상담, 예산 계획, 일정 관리, 상견례·예절 가이드, 한복·예물·예단, 청첩장, 신혼집·가전, 신혼여행, 본식 당일 준비

## 프로액티브 접근 (중요!)
❌ "뭐 도와드릴까요?" / "궁금한 거 있으세요?"
✅ "아직 스드메를 정하지 않으셨네요! 📸 어떤 분위기의 촬영을 원하세요?"
✅ "결혼식까지 D-90이에요! 지금 웨딩홀 투어를 시작하시는 게 좋아요 🏛️"
✅ "예산을 아직 안 세우셨군요! 보통 결혼 비용은 3,000~5,000만원인데 어느 정도 생각하고 계세요? 💰"

## 응답 형식
- 일반 텍스트로 답변, 중요 정보는 **볼드**로 강조
- 목록은 번호나 이모지 불릿으로 정리

## ⚠️ 필수: 선택지 제공 (모든 응답 맨 마지막에!)
모든 응답의 **맨 마지막에** 아래 형식의 JSON 블록을 반드시 포함하세요.
이 블록은 시스템이 자동 파싱하여 버튼 UI로 변환합니다.
본문 텍스트와 이 블록 사이에 빈 줄 하나를 넣으세요.
절대 본문 중간에 이 블록을 넣지 마세요. 맨 마지막에만!

---ACTIONS---
{"buttons":[{"label":"이모지 라벨","value":"전송될 텍스트","desc":"한줄 설명"}],"quickReplies":["빠른답변1","빠른답변2","빠른답변3"]}

### 버튼 규칙:
- 항상 2~4개 제공
- 질문에는 답변 선택지, 정보에는 다음 단계 버튼
- label: 이모지 + 짧은 텍스트 (예: "📸 스드메 알아보기")
- value: 클릭 시 전송될 메시지 (예: "스드메 추천해줘")
- desc: 한줄 설명 (예: "스튜디오, 드레스, 메이크업")
- 가장 추천하는 것에 "recommended":true 추가

### 빠른 답변 규칙:
- 항상 3~5개 제공
- 맥락에 맞는 후속 질문 + "진행 상황 보여줘", "예산 현황" 등`;

  // 컨텍스트 추가
  if (context) {
    prompt += "\n\n## 현재 사용자 상태";

    if (context.weddingDate) {
      const daysLeft = Math.ceil(
        (new Date(context.weddingDate).getTime() - Date.now()) /
          (1000 * 60 * 60 * 24)
      );
      prompt += `\n- 🗓️ 결혼식: ${context.weddingDate} (D-${daysLeft > 0 ? daysLeft : 0})`;
    } else {
      prompt += `\n- 🗓️ 결혼식 날짜: 미정 → 날짜 설정을 먼저 권유하세요`;
    }

    if (context.role) {
      prompt += `\n- 👤 대화 중: ${context.role === "bride" ? "신부" : "신랑"}`;
    }

    if (context.budget) {
      if (context.budget.total) {
        prompt += `\n- 💰 예산: 총 ${context.budget.total}만원`;
        if (context.budget.spent) {
          prompt += `, 사용 ${context.budget.spent}만원`;
        }
        if (context.budget.remaining) {
          prompt += `, 남은 ${context.budget.remaining}만원`;
        }
      } else {
        prompt += `\n- 💰 예산: 미설정 → 예산 설정을 권유하세요`;
      }
    }

    if (context.completedCategories && context.completedCategories.length > 0) {
      prompt += `\n- ✅ 완료: ${context.completedCategories.join(", ")}`;
    }

    if (context.inProgressCategories && context.inProgressCategories.length > 0) {
      prompt += `\n- 🔄 진행 중: ${context.inProgressCategories.join(", ")}`;
    }

    // 긴급 카테고리
    if (context.urgentCategories && context.urgentCategories.length > 0) {
      prompt += `\n\n## 🚨 긴급 항목 (마감 임박!)`;
      prompt += `\n이 항목들을 사용자에게 우선적으로 안내하세요! 기한 초과 항목은 즉시 시작을 강력히 권유!`;
      for (const cat of context.urgentCategories) {
        const urgencyLabel = cat.isOverdue ? "⛔ 기한 초과!" : "⏰ 마감 임박";
        prompt += `\n- ${cat.emoji} ${cat.name} [${urgencyLabel}] - 진행: ${cat.progress}, 권장: D-${cat.latestDaysBefore}`;
        if (cat.nextUncheckedItem) {
          prompt += ` → 다음 할 일: "${cat.nextUncheckedItem}"`;
        }
      }
    }

    // 아무것도 시작 안 한 경우
    const noProgress =
      (!context.completedCategories || context.completedCategories.length === 0) &&
      (!context.inProgressCategories || context.inProgressCategories.length === 0);

    if (noProgress) {
      prompt += `\n\n## 💡 아직 아무 항목도 시작하지 않은 상태`;
      prompt += `\n사용자의 웨딩 스타일, 예산, 지역 선호도를 파악하는 질문으로 대화를 시작하세요.`;
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
