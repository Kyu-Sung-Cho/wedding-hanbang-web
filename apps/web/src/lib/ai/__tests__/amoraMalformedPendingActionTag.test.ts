import { describe, expect, it } from "vitest";
import { extractAmoraPendingAction } from "@/lib/ai/amoraPendingAction";
import {
  SERVER_OWNED_UNVERIFIED_NOTICE,
  composeAmoraPersistenceTerminal,
} from "@/lib/ai/amoraPersistenceClaims";
import { BETA_SAFE_TOOLS } from "@/lib/ai/tools";
import { isMutatingTool } from "@/lib/ai/mutationTools";
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

  it("이력에만 쓰는 내부 표시를 모델이 베껴 써도 화면에 남지 않는다", () => {
    // 2026-09-04 스테이징 실측: 답변 본문에 "[미확인 제안 — 저장된 값 아님]" 이
    // 그대로 나갔다. 서버가 프로바이더 이력에만 붙이는 표시인데 모델이 이력에서
    // 배워 자기 답변에 썼다. 사용자에게는 뜻도 모를 말이고, 카드도 없는 턴이라
    // 누를 것도 없었다.
    const copied = "먼저 9월 10일 일정을 등록할까요?\n\n[미확인 제안 — 저장된 값 아님]";
    const result = extract(copied);

    expect(result.cleanText).toBe("먼저 9월 10일 일정을 등록할까요?");
    expect(result.pendingAction).toBeNull();
    // 이력 표시를 지운 것은 표식을 낸 것이 아니다.
    expect(result.hadPendingActionTag).toBe(false);
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

/**
 * **대괄호를 아예 안 쓴 원시 페이로드**가 사용자 화면으로 새지 않는다.
 *
 * 2026-09-04 스테이징 X3 실측: 모델이 답변 끝에 표식 없이
 * `{"tool":"add_amora_action","input":{…}}` 만 적었고, 위의 제거기들은 전부
 * 대괄호를 보므로 아무것도 못 잡았다. 사용자는 내부 계약 모양을 그대로 읽었고
 * 카드도 없었다.
 *
 * 여기서 잠그는 것은 셋이다.
 *  1. 허용된 도구 이름을 담은 `{"tool":…,"input":{…}}` 는 지운다.
 *  2. 다른 JSON 은 한 글자도 바뀌지 않는다(오탐 코퍼스 10문장).
 *  3. 지웠으면 `hadPendingActionTag` 가 켜져 라우트가 이미 쓰던 안내를 붙인다.
 */
describe("태그 없는 원시 페이로드", () => {
  /** 운영이 실제로 쓰는 변경 도구 목록. 손으로 지으면 이름이 운영과 달라진다. */
  const PROPOSABLE_TOOLS = BETA_SAFE_TOOLS.filter((tool) => isMutatingTool(tool.name));

  function extractWithRealTools(text: string) {
    return extractAmoraPendingAction({
      text,
      allowedTools: PROPOSABLE_TOOLS,
      now: NOW,
      createActionId: () => ACTION_ID,
    });
  }

  it("라이브에서 새어 나온 그 모양을 지운다", () => {
    // X3 답변의 꼬리를 그대로 옮긴 모양이다(값만 짧게 줄였다).
    const leaked = [
      "말일까지 신혼여행 항공권 예약하는 거, 이렇게 정리해 볼게요.",
      '{"tool":"add_amora_action","input":{"title":"신혼여행 항공권 예약","due_date":"2026-09-30"}}',
    ].join("\n\n");

    const result = extractWithRealTools(leaked);

    expect(result.cleanText).not.toContain("add_amora_action");
    expect(result.cleanText).not.toContain('"tool"');
    expect(result.cleanText).not.toContain('"input"');
    // 지운 자리에 카드를 만들지는 않는다 — 지우는 쪽만 넓혔다.
    expect(result.pendingAction).toBeNull();
    // 그래도 모델이 변경을 의도했다는 사실은 라우트에 알린다.
    expect(result.hadPendingActionTag).toBe(true);
  });

  it("문장 가운데에 있어도, 값에 중괄호가 들어 있어도 지운다", () => {
    const inline = '알겠어요. {"tool":"update_budget","input":{"total_budget":50000000}} 확인해 주세요.';
    const result = extract(inline);
    expect(result.cleanText).toBe("알겠어요. 확인해 주세요.");
    expect(result.hadPendingActionTag).toBe(true);

    // 문자열 값 안의 닫는 중괄호에서 끝을 잘못 잡으면 꼬리가 남는다.
    const braceInValue = '정리했어요. {"tool":"update_budget","input":{"total_budget":50000000,"memo":"} 로 끝나는 메모"}} 끝.';
    const withBrace = extract(braceInValue);
    expect(withBrace.cleanText).toBe("정리했어요. 끝.");
    expect(withBrace.hadPendingActionTag).toBe(true);

    // 값 안에 **닫는 중괄호 두 개**가 들어 있으면, 끝을 게으르게 찾는 구현은
    // 여기서 잘라 JSON 파싱에 실패하고 페이로드를 통째로 남긴다. 균형을 세는
    // 구현만 통과한다 — 이 줄이 없으면 변형 사례가 초록으로 지나간다(실제로 그랬다).
    const doubleBraceInValue = '정리했어요. {"tool":"update_budget","input":{"total_budget":50000000,"memo":"괄호 }} 두 개"}} 끝.';
    const withDoubleBrace = extract(doubleBraceInValue);
    expect(withDoubleBrace.cleanText).toBe("정리했어요. 끝.");
    expect(withDoubleBrace.hadPendingActionTag).toBe(true);
  });

  it("지웠으면 라우트가 이미 쓰던 안내가 붙는다", () => {
    const leaked = '정리해 볼게요.\n\n{"tool":"update_budget","input":{"total_budget":50000000}}';
    const result = extract(leaked);
    expect(result.pendingAction).toBeNull();

    // 라우트가 하는 그대로 — `hadPendingActionTag && pendingAction === null`.
    const terminal = composeAmoraPersistenceTerminal({
      text: result.cleanText,
      toolResults: [],
      hasPendingAction: false,
      persistenceMode: "durable",
      userRequestedChange: true,
      droppedPendingActionTag:
        result.hadPendingActionTag && result.pendingAction === null,
    });
    expect(terminal.text).toContain(SERVER_OWNED_UNVERIFIED_NOTICE);
  });

  /**
   * 오탐 코퍼스 10문장. 코드블록·마크다운 링크·일반 중괄호·사용자가 붙여 넣은
   * JSON 이며, **한 글자도** 바뀌면 안 된다. 앞 넷은 일부러 가까운 모양으로 뒀다
   * (도구 이름이 목록 밖 / input 없음 / 키가 셋 / 따옴표 없는 JS 객체).
   */
  const untaggedFalsePositiveCorpus = [
    // 도구 이름이 목록 밖이면 우리 계약이 아니다 — 모양은 똑같아도 그대로 둔다.
    '견적서 메모예요: {"tool":"보정 포함","input":{"vendor":"A스튜디오","price":1500000}}',
    '이런 모양이면 안 되나요? {"tool":"add_amora_action"} 만 적어도 되는지 궁금해요.',
    '{"tool":"update_budget","input":{"total_budget":50000000},"note":"참고용"} 이건 제가 메모해 둔 거예요.',
    "```js\nconst payload = {tool: \"update_budget\", input: {total_budget: 50000000}};\n```",
    "자세한 내용은 [예식장 비교](https://example.com/venues) 에서 볼 수 있어요.",
    "표에 {식대} 항목은 1인 기준으로 계산해요.",
    "빈 중괄호 { } 만 있는 줄도 그대로 둬요.",
    '{"input":{"total_budget":50000000}} 처럼 앞부분이 빠지면 무슨 뜻인지 모르겠어요.',
    "```json\n{\"budget\": 50000000, \"spent\": 12000000}\n```",
    "계약서에 {계약금 10%} 라고 적힌 부분을 확인해 주세요.",
  ];

  it("다른 JSON 10문장은 그대로 둔다", () => {
    expect(untaggedFalsePositiveCorpus).toHaveLength(10);
    for (const sentence of untaggedFalsePositiveCorpus) {
      const result = extractWithRealTools(sentence);
      expect(result.cleanText, sentence).toBe(sentence);
      expect(result.hadPendingActionTag, sentence).toBe(false);
      expect(result.pendingAction, sentence).toBeNull();
    }
  });

  it("같은 입력에 같은 결과", () => {
    const leaked = '정리해 볼게요. {"tool":"update_budget","input":{"total_budget":50000000}}';
    const first = extract(leaked);
    const second = extract(leaked);
    expect(second.cleanText).toBe(first.cleanText);
    expect(second.hadPendingActionTag).toBe(first.hadPendingActionTag);
  });
});
