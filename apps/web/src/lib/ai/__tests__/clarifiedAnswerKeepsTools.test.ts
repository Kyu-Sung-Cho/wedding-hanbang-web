import { describe, expect, it } from "vitest";

import {
  isAmoraClarificationAnswerShaped,
  isAmoraToolIntentAnswerShaped,
  resolveAmoraWeddingClarificationContinuity,
} from "@/lib/ai/amoraClarificationContinuity";
import { selectAmoraTools } from "@/lib/ai/amoraToolPolicy";
import { BETA_SAFE_TOOLS } from "@/lib/ai/tools";
import { isMutatingTool } from "@/lib/ai/mutationTools";

/**
 * 아모라가 자기가 물어 놓고, 답을 받고, 기능이 없다고 말했다.
 *
 * 2026-08-25 운영 실측 — 네 흐름 중 셋이 깨졌다:
 *
 *   "할 일 하나 추가해줘"        → "어떤 할 일을 추가할지 내용이 필요해요."
 *   "청첩장 시안 고르기"          → "이 대화에서는 할 일을 실제로 저장하는
 *                                  도구가 없어 아직 반영되지 않았어요."
 *
 *   "체크리스트 하나 완료 처리해줘" → "어떤 항목을 완료 처리할지 알려주세요."
 *   "청첩장 문구 정하기"          → "이 대화에서는 체크리스트 상태를 변경하는
 *                                  도구가 없어 아직 반영되지 않았어요."
 *
 * 두 답 모두 **W0으로 잘 판정된다.** 범위는 멀쩡하다. 깨지는 것은 도구
 * 선택기다 — 그건 어휘로 의도를 고르는데, 되묻기의 답에는 항목 이름만 있고
 * 의도 어휘가 없다.
 *
 * 기존 연속성 장치는 답이 **범위 밖으로 보일 때만**(W4/low/needsClarification)
 * 걸린다. 그래서 이 자리를 지나쳤다.
 *
 * 첫 사용자에게는 제품에 그 기능이 없는 것으로 보인다.
 */

const WRITE_TOOLS = BETA_SAFE_TOOLS.filter((t) => isMutatingTool(t.name));

function toolNamesFor(userText: string): string[] {
  return selectAmoraTools({
    availableTools: BETA_SAFE_TOOLS,
    userText,
    specialistType: undefined as never,
    checklistLabels: [],
  }).map((t) => t.name);
}

describe("되묻기의 답이 도구를 잃지 않는다", () => {
  it.each([
    ["할 일 하나 추가해줘", "청첩장 시안 고르기", "add_amora_action"],
    ["체크리스트 하나 완료 처리해줘", "청첩장 문구 정하기", "toggle_checklist_item"],
  ])("'%s' → '%s' 에서 %s 가 살아난다", (anchor, answer, expectedTool) => {
    // 답만 보면 그 도구가 없다 — 이것이 운영에서 벌어진 일이다.
    expect(toolNamesFor(answer)).not.toContain(expectedTool);
    // 닻을 앞에 붙이면 살아난다.
    expect(toolNamesFor(`${anchor}\n${answer}`)).toContain(expectedTool);
  });

  it.each([
    ["청첩장 시안 고르기"],
    ["청첩장 문구 정하기"],
    ["드레스 실장님 성함이 김지연"],
  ])("'%s' 는 도구 의도를 이어받을 모양이다", (answer) => {
    expect(isAmoraToolIntentAnswerShaped(answer)).toBe(true);
    // 범위 구제 쪽은 여전히 거부한다 — 두 계약이 겹치지 않는다.
    expect(isAmoraClarificationAnswerShaped(answer)).toBe(false);
  });

  it.each([
    ["이거 어떻게 하면 돼?", "질문으로는 답하지 않는다"],
    ["파이썬으로 퀵소트 짜줘", "결혼 밖 발화는 이어받지 않는다"],
    ["남편이 어제 저를 밀쳤어요", "안전 신호는 이어받지 않는다"],
    ["세금 얼마나 나와?", "고위험 영역은 이어받지 않는다"],
  ])("'%s' 는 이어받지 않는다 (%s)", (text) => {
    expect(isAmoraToolIntentAnswerShaped(text)).toBe(false);
  });

  it("240자를 넘는 긴 글은 되묻기의 답이 아니다", () => {
    expect(isAmoraToolIntentAnswerShaped("청첩장 ".repeat(90))).toBe(false);
  });

  const rows = [
    { id: "u1", role: "user", sender_type: "human", sender_id: "me",
      visibility: "shared", content: "할 일 하나 추가해줘", metadata: {} },
    { id: "a1", role: "assistant", sender_type: "ai", sender_id: null,
      visibility: "shared", content: "어떤 할 일을 추가할지 내용이 필요해요.",
      metadata: { in_reply_to_user_message_id: "u1", question_scope: "W0_wedding_core" } },
    { id: "u2", role: "user", sender_type: "human", sender_id: "me",
      visibility: "shared", content: "청첩장 시안 고르기", metadata: {} },
  ] as never[];

  const resolve = (over: Record<string, unknown> = {}) =>
    resolveAmoraWeddingClarificationContinuity({
      rawOldestFirstRows: rows,
      requesterUserId: "me",
      currentUserMessageId: "u2",
      currentUserText: "청첩장 시안 고르기",
      answerShape: "tool_intent",
      ...over,
    } as never);

  it("서버가 W0으로 기록한 되묻기 쌍이면 닻을 돌려준다", () => {
    expect(resolve()?.priorUserText).toBe("할 일 하나 추가해줘");
  });

  it("기본값은 범위 구제라 이 쌍을 돌려주지 않는다", () => {
    // 기존 호출자가 새 동작을 얻으면 안 된다.
    expect(resolve({ answerShape: undefined })).toBeNull();
  });

  it("상대가 답한 것은 이어받지 않는다", () => {
    expect(resolve({ requesterUserId: "spouse" })).toBeNull();
  });

  it("아모라 턴이 W0으로 기록되지 않았으면 이어받지 않는다", () => {
    const other = structuredClone(rows) as never[];
    (other[1] as { metadata: Record<string, unknown> }).metadata.question_scope = "W2_high_risk_adjacent";
    expect(resolve({ rawOldestFirstRows: other })).toBeNull();
  });

  /**
   * 안전 경계는 **아모라 턴의 기록된 question_scope** 가 진다(바로 위 테스트).
   * 본문을 다시 읽는 `hasAmoraSafetySignal` 은 보조 검사이고 재현율이 낮다 —
   * 1인칭 피해 진술("남편이 저를 밀쳤어요")은 잡지만 아모라가 되짚는 말투
   * ("밀쳤다고 하셨죠", "맞았다고 하셨는데")는 못 잡는다(2026-08-25 실측).
   *
   * 아모라는 보통 되짚어 말하므로 실제로는 거의 안 걸린다. 그래서 이 테스트는
   * 배선이 살아 있는지만 확인하고, 경계 자체를 여기 맡기지 않는다.
   */
  it("아모라 본문이 안전 신호로 판정되면 이어받지 않는다", () => {
    const other = structuredClone(rows) as never[];
    (other[1] as { content: string }).content = "남편이 저를 밀쳤어요";
    expect(resolve({ rawOldestFirstRows: other })).toBeNull();
  });

  it("닻이 쓰기 도구를 실제로 받는 발화여야 뜻이 있다", () => {
    // 닻이 자기 턴에서 이미 받은 도구만 이어받는다는 안전 논리의 전제.
    const anchorTools = toolNamesFor("할 일 하나 추가해줘");
    expect(anchorTools).toContain("add_amora_action");
    expect(WRITE_TOOLS.map((t) => t.name)).toContain("add_amora_action");
  });
});
