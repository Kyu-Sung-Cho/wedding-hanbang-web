export type DissatisfactionResult = {
  detected: true;
  signal: "correction" | "retry" | "frustration" | "negative" | "confusion" | "disengagement";
};

export function detectDissatisfaction(
  userMessage: string,
  previousAiMessage?: string
): DissatisfactionResult | null {
  const msg = userMessage.trim();

  // 수정 시그널: "아니", "아닌데", "그게 아니라", "아 그게 아니고"
  if (/^아니[요.]?$|아닌데|그게\s*아니라|아\s*그게\s*아니고|아니거든/.test(msg)) {
    return { detected: true, signal: "correction" };
  }

  // 재시도 시그널: "다시", "다시 해줘", "다시 말해줘"
  if (/다시\s*(해|말해|알려|설명|해줘|해봐|말해줘)/.test(msg) || /^다시$/.test(msg)) {
    return { detected: true, signal: "retry" };
  }

  // 좌절 시그널: "이해를 못하네", "말을 못 알아듣네"
  if (/이해를?\s*못\s*(하|알아듣)|말을?\s*못\s*알아듣|알아듣지?\s*못/.test(msg)) {
    return { detected: true, signal: "frustration" };
  }

  // 부정 시그널: "쓸모없", "도움이 안", "별로"
  if (/쓸모\s*없|도움이?\s*안\s*(되|됨|돼)|별로|소용\s*없/.test(msg)) {
    return { detected: true, signal: "negative" };
  }

  // 혼란 시그널: 이전 AI 응답이 길었는데(100자+) 사용자가 "?"만 보낸 경우
  if (msg === "?" && previousAiMessage && previousAiMessage.length > 100) {
    return { detected: true, signal: "confusion" };
  }

  // 이탈 시그널: AI가 상세 답변(200자+) 했는데 매우 짧은 응답("ㅇㅇ", "ㅋ", "아" 등)
  const shortDisengagePatterns = /^(ㅇㅇ|ㅋ+|ㅎ+|아|응|넵|네|음|흠|그래|ok|ㅇ|아하)$/i;
  if (
    shortDisengagePatterns.test(msg) &&
    previousAiMessage &&
    previousAiMessage.length > 200
  ) {
    return { detected: true, signal: "disengagement" };
  }

  return null;
}
