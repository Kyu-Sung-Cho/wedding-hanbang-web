import type { WeddingPlannerPromptContext } from "@/lib/ai/prompts";

type PastDecisions = NonNullable<WeddingPlannerPromptContext["pastDecisions"]>;

/**
 * 지시문을 길이 상한 너머까지 채우는 지난 결정 기록 30건. 2주 이전 기록이라 압축 줄(제목 300자, 값 500자)로
 * 실리고, 요약이 있던 자리 바로 뒤(`amoraProfileSection` 다음)에 놓여 꼬리부터 자르는 절단이 같은 곳에서 일어난다.
 *
 * 2026-11-20 D-87·09장 M5-1 부터 대화 묶음 요약(`chatSummaries`)은 지시문에 실리지 않는다. 요약으로 문맥을
 * 채우던 절단 시험은 더는 잘리지 않아 "길이 제한으로 생략됨" 전제에서 멈췄다. 지금도 지시문에 실리는 기억 칸으로
 * 채운다. `reasoning` 은 비운다(자동 기억의 이유는 대화 경로가 지시문 앞에서 지운다).
 */
export function saturatingDecisionHistory(text: string): PastDecisions {
  return Array.from({ length: 30 }, (_, index) => ({
    category: "venue",
    decisionType: "considering",
    title: `${text} ${index}. `.repeat(20),
    value: `${text} 메모 ${index}. `.repeat(40),
    reasoning: null,
    confidence: 0.5,
    source: "chat",
    createdAt: "2026-01-01T00:00:00.000Z",
  }));
}
