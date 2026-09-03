import { describe, expect, it } from "vitest";
import { extractAmoraPendingAction } from "@/lib/ai/amoraPendingAction";
import type { AiToolDefinition } from "@/lib/ai/toolDefinition";

/**
 * 표식을 **틀리게 쓴 토큰**이 사용자 화면으로 새지 않는다.
 *
 * 2026-09-03 실측: 모델이 `[pending_action]{…}[/pending_action]` 대신
 * `[ pending_action 필요 ]` 라고 쓰자 추출기가 못 잡아 카드가 0개가 됐고,
 * 잔여 제거기도 정확한 모양만 봐서 **그 내부 표식이 그대로 답변에 남았다.**
 *
 * 여기서 잠그는 것은 셋이다.
 *  1. 틀리게 쓴 토큰은 어떤 어형이든 출력에 남지 않는다.
 *  2. 정상 본문의 대괄호는 한 글자도 바뀌지 않는다(오탐 코퍼스 15문장).
 *  3. 추출 규칙은 넓어지지 않았다 — 근사 JSON 은 카드가 되지 않는다.
 */
const NOW = 1_789_000_000_000;
const ACTION_ID = "11111111-1111-4111-8111-111111111111";
const tools: AiToolDefinition[] = [
  {
    name: "update_budget",
    description: "test",
    input_schema: {
      type: "object",
      properties: { total_budget: { type: "number" } },
      required: ["total_budget"],
    },
  },
];

function extract(text: string) {
  return extractAmoraPendingAction({
    text,
    allowedTools: tools,
    now: NOW,
    createActionId: () => ACTION_ID,
  });
}

/** 표식 낱말이 출력 어디에도 남지 않았는가. */
function leaksMarkerWord(text: string): boolean {
  return /pending[\s_-]*action/iu.test(text);
}

describe("틀리게 쓴 pending_action 표식", () => {
  const malformedSamples = [
    // 2026-09-03 운영에서 실제로 나온 모양.
    "예산을 그렇게 바꾸려면 확인이 필요해요.\n[ pending_action 필요 ]\n확인해 주세요.",
    "[pending_action 표식 필요] 예산을 5,000만원으로 볼까요?",
    "예산 정리부터 해볼게요. [PENDING_ACTION: update_budget]",
    "[pending-action 을 여기에] 어느 쪽으로 할까요?",
    "[ pending action ] 금액을 알려주시면 이어갈게요.",
    "확인이 필요해요 [pending_action?] 다음 단계로 갈까요?",
  ];

  it.each(malformedSamples)("출력에 표식 낱말을 남기지 않는다: %s", (sample) => {
    const result = extract(sample);
    expect(leaksMarkerWord(result.cleanText)).toBe(false);
    expect(result.cleanText).not.toContain("[");
    expect(result.cleanText).not.toContain("]");
    // 카드는 나오지 않는다 — 유효 페이로드가 아니기 때문이다.
    expect(result.pendingAction).toBeNull();
    // 그래도 모델이 변경을 의도했다는 사실은 라우트에 알린다.
    expect(result.hadPendingActionTag).toBe(true);
  });

  it("본문은 남기고 토큰 자리만 정리한다", () => {
    const result = extract("예산 정리부터 해볼게요. [ pending_action 필요 ] 어느 쪽이 좋으세요?");
    expect(result.cleanText).toBe("예산 정리부터 해볼게요. 어느 쪽이 좋으세요?");
  });

  it("같은 입력에 같은 결과", () => {
    for (const sample of malformedSamples) {
      const first = extract(sample);
      const second = extract(sample);
      expect(second.cleanText).toBe(first.cleanText);
      expect(second.hadPendingActionTag).toBe(first.hadPendingActionTag);
      expect(second.pendingAction).toEqual(first.pendingAction);
    }
  });

  /**
   * 오탐 코퍼스. 제품 본문에 실제로 나오는 대괄호들이며 **한 글자도** 바뀌면 안 된다.
   */
  const normalBracketCorpus = [
    "[참고] 대관료는 지역마다 달라요.",
    "자세한 내용은 [예식장 비교](https://example.com/venues) 에서 볼 수 있어요.",
    "체크리스트 항목 [invitation_02] 은 아직 남아 있어요.",
    "예절 안내 [etiquette:4] 를 함께 보면 좋아요.",
    "[중요] 계약서 원본은 꼭 챙겨 두세요.",
    "배열 표기 [1, 2, 3] 처럼 쓰는 방법도 있어요.",
    "[신부] 라고 적힌 줄은 화면 표시용이에요.",
    "[TODO] 라고 적어두는 분도 많아요.",
    "가격표 [부가세 별도] 를 살펴보세요.",
    "링크 [여기](https://example.com) 를 눌러 주세요.",
    "메모에 [예약 메모] 라고 남겨두는 분도 있어요.",
    "[2026년 5월] 예식은 성수기예요.",
    "표에 [미정] 으로 남은 칸이 세 개 있어요.",
    "[식대] 항목은 1인 기준으로 계산해요.",
    "대괄호 [ ] 만 있는 줄도 그대로 둬요.",
  ];

  it("정상 대괄호 15문장은 그대로 둔다", () => {
    expect(normalBracketCorpus).toHaveLength(15);
    for (const sentence of normalBracketCorpus) {
      const result = extract(sentence);
      expect(result.cleanText).toBe(sentence);
      expect(result.hadPendingActionTag).toBe(false);
      expect(result.pendingAction).toBeNull();
    }
  });

  it("추출 규칙은 넓히지 않았다 — 근사 JSON 은 카드가 되지 않는다", () => {
    const nearJson = "[pending_action]{tool: update_budget, input: {total_budget: 50000000}}[/pending_action]";
    const result = extract(nearJson);
    expect(result.pendingAction).toBeNull();
    expect(leaksMarkerWord(result.cleanText)).toBe(false);
    expect(result.cleanText).not.toContain("update_budget");
  });

  it("정확한 표식은 예전과 똑같이 카드가 된다", () => {
    const valid = `앞뒤 문장.\n[pending_action]${JSON.stringify({
      tool: "update_budget",
      input: { total_budget: 50_000_000 },
      confirmation: "총 예산을 5,000만원으로 바꿀까요?",
    })}[/pending_action]`;
    const result = extract(valid);
    expect(result.pendingAction?.tool).toBe("update_budget");
    // 보이는 확인문은 서버가 만든다(모델 문장이 아니다). 여기서는 카드가 났고
    // 표식이 새지 않았다는 것만 잠근다.
    expect(result.cleanText).toContain("총 예산");
    expect(leaksMarkerWord(result.cleanText)).toBe(false);
    expect(result.hadPendingActionTag).toBe(true);
  });
});
