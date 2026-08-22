import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { extractAmoraPendingAction } from "@/lib/ai/amoraPendingAction";
import type { AiToolDefinition } from "@/lib/ai/toolDefinition";

/**
 * 2026-08-22 스테이징 라이브에서 나온 두 가지.
 *
 * 1) **표식 괄호 변형이 원문을 노출한다.** 모델이 `[ pending_action ]`(괄호 안 공백)을
 *    내면 정확 일치 정규식이 못 잡아 `{"tool":"update_budget","input":{…}}` 가 사용자
 *    화면에 그대로 보였다. 내부 계약이 사용자에게 새는 것이라 카드가 안 나오는 것보다
 *    나쁘다.
 *
 * 2) **모델이 서버 확인문을 흉내 낸다.** 진짜 카드가 나오기 시작하자 모델이
 *    "다음 변경을 적용할까요? - 변경: … - 총 예산: …" 를 **표식 없이** 그대로 쓴다.
 *    누를 버튼이 없는 가짜 카드다. 게다가 그 턴이 이력에 쌓이면 계속 재생산돼
 *    **진짜 카드를 막는다** — 이 세션에서 실제로 시험을 세 번 막았다.
 *
 * 두 경우 모두 "사용자에게 무엇이 보이는가"가 계약이다. 프롬프트 지시로는 안 된다 —
 * 계약문에 "보이는 확인 문장은 서버가 만듭니다"가 이미 있는데도 이 일이 벌어졌다.
 */

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
    now: Date.now(),
    createActionId: randomUUID,
  });
}

const VALID_PAYLOAD = '{"tool":"update_budget","input":{"total_budget":30000000}}';

describe("표식이 어떤 모양이든 사용자에게 새지 않는다", () => {
  it.each([
    ["괄호 안 공백", `총 예산을 반영할게요.\n[ pending_action ]${VALID_PAYLOAD}[ /pending_action ]`],
    ["여는 쪽만 공백", `총 예산을 반영할게요.\n[ pending_action ]${VALID_PAYLOAD}[/pending_action]`],
    ["대문자 섞임", `총 예산을 반영할게요.\n[Pending_Action]${VALID_PAYLOAD}[/Pending_Action]`],
    ["닫는 태그 없음", `총 예산을 반영할게요.\n[pending_action]${VALID_PAYLOAD}`],
    ["닫는 태그만 공백", `총 예산을 반영할게요.\n[pending_action]${VALID_PAYLOAD}[ /pending_action ]`],
  ])("%s", (_label, text) => {
    const result = extract(text);
    expect(result.cleanText, "표식 이름이 사용자에게 보인다").not.toMatch(/pending_action/i);
    expect(result.cleanText, "도구 이름이 사용자에게 보인다").not.toContain('"tool"');
    expect(result.cleanText, "입력 JSON 이 사용자에게 보인다").not.toContain('"input"');
    expect(result.cleanText, "원문 숫자가 그대로 보인다").not.toContain("30000000");
  });

  it("정상 표식은 여전히 카드가 된다", () => {
    const result = extract(`총 예산을 반영할게요.\n[pending_action]${VALID_PAYLOAD}[/pending_action]`);
    expect(result.pendingAction).not.toBeNull();
    expect(result.pendingAction?.tool).toBe("update_budget");
    // 보이는 문장은 서버가 만든 확인문이다.
    expect(result.cleanText).toContain("다음 변경을 적용할까요?");
  });

  it("공백 변형도 카드가 된다 — 관대해진 만큼 실제로 살려낸다", () => {
    const result = extract(`총 예산을 반영할게요.\n[ pending_action ]${VALID_PAYLOAD}[ /pending_action ]`);
    expect(result.hadPendingActionTag).toBe(true);
    expect(result.pendingAction, "변형 표식이 버려졌다").not.toBeNull();
  });
});

describe("서버 확인문을 흉내 낸 가짜 카드는 사용자에게 가지 않는다", () => {
  const forged = [
    "다음 변경을 적용할까요?\n- 변경: 총 결혼 예산 변경\n- 총 예산: 1억 원",
    "네, 정리했어요.\n\n다음 변경을 적용할까요?\n- 변경: 결혼식 날짜 변경\n- 결혼식 날짜: \"2027-05-22\"",
  ];

  it.each(forged.map((text, index) => [`사례 ${index + 1}`, text] as const))(
    "%s — 표식 없이 확인문만 있으면 그 문장이 남지 않는다",
    (_label, text) => {
      const result = extract(text);
      expect(result.pendingAction).toBeNull();
      expect(result.cleanText).not.toContain("다음 변경을 적용할까요?");
      // 침묵도 답이 아니다. 사용자가 다음에 뭘 할지 알 수 있어야 한다.
      expect(result.cleanText.trim().length).toBeGreaterThan(0);
    },
  );

  it("진짜 카드가 있을 때의 확인문은 그대로 둔다", () => {
    const result = extract(`[pending_action]${VALID_PAYLOAD}[/pending_action]`);
    expect(result.pendingAction).not.toBeNull();
    expect(result.cleanText).toContain("다음 변경을 적용할까요?");
  });

  it.each([
    "예식장 계약 전에 확인할 것들을 정리해 드릴게요.",
    "총 예산은 아직 정하지 않으셨어요. 얼마로 잡을지 먼저 알려주시겠어요?",
    "적용할까요? 라고 여쭤보기 전에 값부터 확인할게요.",
  ])("평범한 문장은 건드리지 않는다: %s", (text) => {
    const result = extract(text);
    expect(result.cleanText).toBe(text);
  });
});

/**
 * 2026-08-22 두 번째 관측. 모델은 서버 문장을 **베끼지 않고** 제 말로 확인을
 * 약속하기도 한다 — "총 예산을 7,000만 원으로 바꾸는 것으로 이해했어요.
 * 확인해 주시면 적용할게요." 표식이 없으니 사용자가 "확인"이라고 답해도 실행할
 * action_id 가 없다.
 *
 * 이것을 걷어내야 하는 두 번째 이유는 이력이다. 같은 프롬프트로 이력만 바꿔
 * 10회씩 측정:
 *
 *     12턴 모두 표식 있음        표식 10/10
 *     마지막 1턴만 표식 없음      표식  8/10
 *     마지막 2턴                표식  4/10
 *     마지막 3턴                표식  0/10
 *
 * 연속 세 번이면 그 대화는 끝난다. 실패한 턴을 확인 문장 모양으로 남겨 두면
 * 다음 실패를 부른다.
 */
describe("제 말로 지어낸 확인 약속", () => {
  it.each([
    "총 예산을 **7,000만 원**으로 바꾸는 것으로 이해했어요. 확인해 주시면 적용할게요.",
    "총 예산을 6,900만 원으로 변경할까요? 확인해 주시면 바로 반영할게요.",
  ])("표식이 없으면 걷어낸다: %s", (text) => {
    const result = extract(text);
    expect(result.pendingAction).toBeNull();
    expect(result.cleanText).not.toContain("확인해 주시면");
    expect(result.cleanText.trim().length).toBeGreaterThan(0);
  });

  it("앞에 붙은 진짜 답변은 남긴다", () => {
    const result = extract(
      "웨딩홀 대관료는 지역마다 크게 달라요.\n확인해 주시면 적용할게요.",
    );
    expect(result.cleanText).toContain("웨딩홀 대관료는 지역마다 크게 달라요.");
    expect(result.cleanText).not.toContain("확인해 주시면");
  });

  it("표식이 있으면 서버 확인문이 그대로 간다", () => {
    const result = extract(
      `확인해 주시면 적용할게요.[pending_action]${VALID_PAYLOAD}[/pending_action]`,
    );
    expect(result.pendingAction).not.toBeNull();
    expect(result.cleanText).toContain("다음 변경을 적용할까요?");
  });

  it.each([
    "어느 카테고리를 말씀하시는 걸까요? 알려주시면 함께 살펴볼게요.",
    "계약서를 확인해 보시면 위약금 조항이 이미 반영돼 있을 거예요.",
    "예식장 방문 일정을 확인하고 싶으시면 일정 화면에서 보실 수 있어요.",
    "두 분이 확인해 주시면 좋겠어요. 서로 생각이 다를 수 있으니까요.",
  ])("정상적인 되묻기·안내는 건드리지 않는다: %s", (text) => {
    const result = extract(text);
    expect(result.cleanText).toBe(text);
  });

  /**
   * 첫 판이 놓친 형태들. 적대적 검토가 실제로 재현해 냈다.
   *
   * 원인은 사이를 벌린 `[^.\n]{0,24}` 가 `?`·`!`·`,` 를 통과시켜 **정규식이
   * 문장 경계를 넘은 것**이었다. 위 음성 사례 네 개가 전부 마침표로 끝나서
   * 이 구멍을 보지 못했다. 그래서 여기 있는 문장은 하나도 마침표로 안 끊긴다.
   */
  it.each([
    // 확인 요청과 "변경할" 이 서로 다른 문장이다.
    "제가 이해한 게 맞는지 확인해 주시겠어요? 일정 변경할 부분이 있으면 알려주세요.",
    // 쉼표 뒤의 "변경할" 은 명사를 꾸미는 말이지 약속이 아니다.
    "어느 쪽을 말씀하시는지 확인해 주세요, 그래야 예산 변경할 항목을 정확히 짚을 수 있어요.",
    "예식장 후보 세 곳을 정리했어요. 어느 곳이 마음에 드는지 확인해 주시겠어요? 일정 변경할 수도 있으니 알려주세요.",
    // 아모라가 아니라 업체에게 확인을 받으라는 안내다.
    "업체에 “확인”이라고 답장하시면 예약이 잡혀요.",
    // 지금은 **의도적으로 놓친다.** 위 문장과 모양이 같아, 확인을 받을 상대가
    // 아모라인지 업체인지 가를 신호가 문장 안에 없다. 상대를 추측하는 규칙을
    // 덧붙이면 이 파일이 처음에 만든 것과 같은 종류의 오탐이 다시 생긴다.
    "총 결혼 예산을 6,200만 원으로 바꾸는 게 맞다면 “확인”이라고 답해주세요.",
    // 숫자·주소 안의 마침표가 문장 끝으로 오인되면 안 된다.
    "대관료는 3.5억이 아니라 3,500만 원이에요. https://example.com/a.b 에서 확인하실 수 있어요.",
  ])("문장 경계를 넘어 잡지 않는다: %s", (text) => {
    const result = extract(text);
    expect(result.cleanText).toBe(text);
  });

  it("중재 블록 안은 건드리지 않는다 — 지우면 중재 카드가 조용히 사라진다", () => {
    const text = [
      "두 분 이야기를 들어보니 서로 아끼는 마음은 같았어요.",
      "[mediation]",
      "공감: 두 분 다 서두르고 싶지 않으셨어요.",
      "합의안: 다음 주에 다시 이야기하기로 하고, 확인해 주시면 반영할게요.",
      "[/mediation]",
    ].join("\n");
    const result = extract(text);
    expect(result.cleanText).toContain("[mediation]");
    expect(result.cleanText).toContain("[/mediation]");
    expect(result.cleanText).toContain("합의안");
  });

  it("지운 자리에는 다음 걸음을 남긴다 — 막다른 길로 두지 않는다", () => {
    const result = extract(
      "총 예산을 7,000만 원으로 바꾸는 것으로 이해했어요. 확인해 주시면 적용할게요.",
    );
    expect(result.cleanText).toContain("이해했어요");
    expect(result.cleanText).not.toContain("확인해 주시면");
    expect(result.cleanText).toContain("다시 보내주시겠어요?");
  });

  /**
   * 문장 분할이 숫자·주소 안의 마침표를 문장 끝으로 보면, 한 문장이 둘로 쪼개져
   * 확인 요청과 약속이 갈라지고 **지어낸 확인이 그대로 통과한다.** 그래서 마침표는
   * 뒤에 공백이나 끝이 올 때만 문장 끝으로 본다.
   */
  it.each([
    "확인해 주시면 3.5억으로 반영할게요.",
    "확인해 주시면 https://example.com/a 자료를 저장할게요.",
  ])("소수점·주소가 문장을 쪼개 탐지를 빠져나가지 않는다: %s", (text) => {
    const result = extract(text);
    expect(result.cleanText).not.toContain("확인해 주시면");
  });

  it("뒤따르는 정상 답변까지 지우지 않는다", () => {
    const result = extract(
      "확인해 주시면 적용할게요. 그리고 예식장 방문은 주말이 붐빈다는 점도 참고하세요.",
    );
    expect(result.cleanText).toContain("주말이 붐빈다는 점도 참고하세요");
    expect(result.cleanText).not.toContain("확인해 주시면");
  });
});
