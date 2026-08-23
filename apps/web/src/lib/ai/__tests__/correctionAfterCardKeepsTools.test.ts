import { describe, expect, it } from "vitest";

import { resolveAmoraWeddingClarificationContinuity } from "@/lib/ai/amoraClarificationContinuity";

/**
 * 카드를 보고 숫자를 고치는 것은 승낙이 아니다.
 *
 * 확인 카드가 떠 있던 턴 뒤의 **승낙**은 버튼(action_id)으로만 받는다 — 자유
 * 문장이 확인을 대신하면 서버가 검증하지 않은 값이 저장될 수 있다. 그 계약은
 * 그대로 둔다.
 *
 * 그런데 사람은 카드를 보고 숫자를 고치기도 한다.
 *
 *     아모라: 총 예산 5,000만 원으로 바꿀까요?  ← 카드
 *     사용자: 아니 4천으로 해줘                ← 승낙이 아니라 새 지시
 *
 * 이것까지 막으면 연속성이 끊겨 도구가 0개가 되고, 아모라가 "결혼 준비와 무슨
 * 관련인지" 되묻는 엉뚱한 답을 한다(2026-08-24 감사에서 확인).
 *
 * 연속성이 주는 것은 **범위와 도구뿐**이다. 실제 적용은 여전히
 * `confirmedActionId` + 적용 리스를 거친다. 그래서 정정을 통과시켜도 자유
 * 문장이 확인을 대신하게 되지는 않는다.
 */

const USER_ID = "11111111-2222-4333-8444-555555555555";
const PRIOR_ID = "aaaaaaaa-1111-4111-8111-111111111111";
const ASSISTANT_ID = "bbbbbbbb-2222-4222-8222-222222222222";
const CURRENT_ID = "cccccccc-3333-4333-8333-333333333333";

const PENDING_ACTION = {
  version: 2,
  actionId: "dddddddd-4444-4444-8444-444444444444",
  tool: "update_budget",
  input: { total_budget: 50_000_000 },
};

function resolve(currentText: string, withCard: boolean) {
  return resolveAmoraWeddingClarificationContinuity({
    rawOldestFirstRows: [
      {
        id: PRIOR_ID,
        sender_id: USER_ID,
        sender_type: "groom",
        role: "user",
        content: "총 예산 5000만원으로 바꿔줘",
        metadata: null,
        visibility: "shared",
      },
      {
        id: ASSISTANT_ID,
        sender_id: null,
        sender_type: "ai",
        role: "assistant",
        content: "총 예산을 5,000만 원으로 바꿀까요?",
        metadata: {
          in_reply_to_user_message_id: PRIOR_ID,
          question_scope: "W0_wedding_core",
          memory_eligible: true,
          ...(withCard ? { pending_amora_action: PENDING_ACTION } : {}),
        },
        visibility: "shared",
      },
      {
        id: CURRENT_ID,
        sender_id: USER_ID,
        sender_type: "groom",
        role: "user",
        content: currentText,
        metadata: null,
        visibility: "shared",
      },
    ],
    requesterUserId: USER_ID,
    currentUserMessageId: CURRENT_ID,
    currentUserText: currentText,
  });
}

describe("카드가 떠 있어도 정정은 이어진다", () => {
  it.each([
    "아니 4천으로 해줘",
    "4천만원으로 바꿔줘",
    "아니 그거 말고 3500으로",
    "다시 4천으로 수정해줘",
  ])("정정이면 연속성이 살아 있다: %s", (text) => {
    expect(resolve(text, true)).not.toBeNull();
  });

  it.each([
    "응",
    "응 넣어줘",
    "네 그렇게 적용해줘",
    "그래 그렇게 해줘",
    "오케이",
  ])("맨 승낙은 여전히 버튼으로만 받는다: %s", (text) => {
    // 자유 문장이 확인을 대신하면 안 된다는 계약은 그대로다.
    expect(resolve(text, true)).toBeNull();
  });

  it("카드가 없던 턴은 승낙이어도 원래대로 이어진다", () => {
    expect(resolve("응 그렇게 해줘", false)).not.toBeNull();
  });
});
