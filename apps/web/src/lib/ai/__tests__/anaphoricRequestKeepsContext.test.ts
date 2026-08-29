/**
 * 직전 대화를 가리키며 부탁하는 말도 그 한 쌍을 받는다.
 *
 * 팀 테스트 Turn 10:
 *
 *     (Turn 9)  우리는 예단이랑 폐백은 생략하고 싶어. 두 사람 의견은 같아.
 *     (Turn 10) 그걸 부모님께 어떻게 말해야 덜 부딪힐까? 실제로 보낼 말까지 써줘.
 *     (아모라)  어떤 내용을 부모님께 말씀드리려는지 아직 몰라서…
 *
 * 기존 단서들은 문장이 지시대명사로 **끝날** 것을 요구해서 이 문장은 아무것도
 * 못 받았다. W4 턴은 provider 에게 현재 메시지 하나만 간다.
 *
 * 이 관문은 권한을 늘리지 않는다 — 통과해도 나오는 것은 context-only 계약이고
 * 도구는 그대로 0개다.
 */
import { describe, expect, it } from "vitest";

import {
  canAttemptAmoraBoundedContinuity,
} from "@/lib/ai/amoraBoundedContinuity";
import { classifyAmoraQuestionScope } from "@/lib/ai/amoraQuestionScope";

describe("가리키며 부탁하는 말이 직전 한 쌍을 받는다", () => {
  it("팀 테스트의 그 문장이 통과한다", () => {
    expect(canAttemptAmoraBoundedContinuity(
      "그걸 부모님께 어떻게 말해야 덜 부딪힐까? 실제로 보낼 말까지 써줘.",
    )).toBe(true);
  });

  it.each([
    "그거 부모님께 어떻게 전하면 좋을까?",
    "그 얘기를 양가에 어떻게 꺼내지?",
    "그 내용 좀 정리해서 문자로 보낼 수 있게 써줘",
  ])("%s", (userText) => {
    expect(canAttemptAmoraBoundedContinuity(userText)).toBe(true);
  });

  it("도구는 늘어나지 않는다", () => {
    // 이 관문은 문맥만 준다. 범위 판정은 그대로 W4 여야 한다 —
    // 여기서 W0 이 되면 권한을 늘린 것이고, 그건 다른 계약의 일이다.
    const classification = classifyAmoraQuestionScope({
      userText: "그걸 부모님께 어떻게 말해야 덜 부딪힐까? 실제로 보낼 말까지 써줘.",
    });
    expect(classification.scope).toBe("W4_out_of_scope");
  });

  it("주제를 끊겠다고 말하면 잇지 않는다", () => {
    for (const userText of [
      "그거 말고 다른 얘기인데, 부모님께 어떻게 말하지?",
      "그건 상관 없이 부모님께 뭐라고 하지?",
    ]) {
      expect(canAttemptAmoraBoundedContinuity(userText), userText).toBe(false);
    }
  });

  it("지시대명사로 시작하지 않으면 잇지 않는다", () => {
    // 대조군. 이게 없으면 위 검사들은 "무엇이든 통과한다"와 구별되지 않는다.
    for (const userText of [
      "부모님께 어떻게 말해야 덜 부딪힐까?",
      "실제로 보낼 말까지 써줘",
      "오늘 날씨 어때?",
    ]) {
      expect(canAttemptAmoraBoundedContinuity(userText), userText).toBe(false);
    }
  });

  it("너무 긴 말은 잇지 않는다", () => {
    // 240자 상한은 그대로다.
    expect(canAttemptAmoraBoundedContinuity(`그걸 부모님께 ${"어떻게".repeat(120)}`)).toBe(false);
  });
});
