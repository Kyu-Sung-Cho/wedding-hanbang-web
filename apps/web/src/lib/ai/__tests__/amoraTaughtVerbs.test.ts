import { describe, expect, it } from "vitest";
import {
  classifyAmoraQuestionScope,
  filterAmoraToolsByQuestionScope,
} from "@/lib/ai/amoraQuestionScope";
import { BETA_SAFE_TOOLS } from "@/lib/ai/tools";

/**
 * 아모라가 가르친 말을 아모라가 알아듣는가.
 *
 * `amoraVoice.ts:51`이 사용자에게 이렇게 말한다:
 *   "일정에는 아직 저장되지 않았어요. 날짜가 빠져 있어서,
 *    8월 10일처럼 날짜만 알려주시면 바로 **넣을게요**."
 *
 * 그런데 사용자가 그대로 "8월 10일 일정에 넣어줘"라고 답하면
 * `CANONICAL_SCHEDULE_MUTATION_PATTERN`에 `넣어`가 없어 W4로 떨어졌다.
 * 도구 0개 — 되묻기 고리와 같은 결말이다.
 *
 * 예산도 방향이 한쪽만 있었다: `줄여`는 있고 `늘려`는 없었다.
 */

describe("아모라가 가르친 동사를 알아듣는다", () => {
  it.each([
    "8월 10일 일정에 넣어줘",
    "내일 오후 2시 일정 넣어줘",
    "다음 주 화요일 일정에 넣어줘",
  ])("일정: %s", (userText) => {
    const c = classifyAmoraQuestionScope({ userText });
    expect(c.scope).toBe("W0_wedding_core");
    expect(
      filterAmoraToolsByQuestionScope(BETA_SAFE_TOOLS, c).length,
    ).toBeGreaterThan(0);
  });

  // 예산은 줄이는 것만 결혼 준비이고 늘리는 것은 아니라는 비대칭이 있었다.
  it.each([
    ["예산 좀 늘려줘", "W0_wedding_core"],
    ["예산을 조금 올려줘", "W0_wedding_core"],
    ["예산 좀 줄여줘", "W0_wedding_core"],
  ] as const)("예산 방향이 대칭이다: %s", (userText, expected) => {
    expect(classifyAmoraQuestionScope({ userText }).scope).toBe(expected);
  });
});

describe("다른 영역의 일정·예산은 그대로 막힌다", () => {
  it.each([
    "회사 일정에 내일 회의 넣어줘",
    "병원 예약 일정 내일로 넣어줘",
    "여행 예산 늘려줘",
    "회사 예산 올려달라고 했어",
    "적금을 좀 늘려볼까",
    "운동 시간을 늘려야겠어",
    "다음 주 일정이 너무 빡빡해",
    "내일 일정 중에 뭘 빼야 할지 모르겠어",
  ])("%s", (userText) => {
    expect(classifyAmoraQuestionScope({ userText }).scope)
      .not.toBe("W0_wedding_core");
  });

  // 두 쌍의 결론이 갈린다.
  //
  //   이사 — 이 앱에서 `이사`·`전세`·`가전` 은 **신혼집 준비**의 말이다. 결혼 밖으로
  //          보내면 "전세 계약 일정 알려줘" 가 끊긴다(적대적 검토가 잡았다).
  //          그래서 W0 으로 둔다. origin/main 과 같다.
  //   면접 — 취업 이야기다. 정본 분기에 결혼 밖 가드를 넣으면서 막혔다.
  //
  // 이 테스트가 지키려던 것은 **두 동사가 같은 판정을 받는다**는 대칭이므로 그것을
  // 그대로 두고, 쌍마다 기대값을 적는다.
  it.each([
    ["이사 일정 내일로 넣어줘", "이사 일정 내일로 추가해줘", true],
    ["면접 일정 다음 주로 넣어줘", "면접 일정 다음 주로 등록해줘", false],
  ] as const)(
    "새 동사와 기존 동사가 같은 판정을 받는다: %s",
    (withNewVerb, withShippedVerb, weddingCore) => {
      const shipped = classifyAmoraQuestionScope({ userText: withShippedVerb }).scope;
      if (weddingCore) {
        expect(shipped).toBe("W0_wedding_core");
      } else {
        expect(shipped).not.toBe("W0_wedding_core");
      }
      expect(classifyAmoraQuestionScope({ userText: withNewVerb }).scope)
        .toBe(shipped);
    },
  );
});

describe("알면서 남긴 것", () => {
  // 날짜가 없으면 여전히 막힌다. 이건 동사 구멍이 아니라 이 분기가 일정·동사·
  // 날짜 셋을 모두 요구하기 때문이고, 그 요구는 과잉 발동을 막는 의도된 설계다.
  // 되묻기 연속성이 붙은 지금은 아모라가 "언제로 넣을까요?"라고 물은 뒤
  // 사용자가 날짜만 답해도 이어진다.
  it.each(["일정에 넣어줘", "일정에 추가해줘", "일정 잡아줘"])(
    "날짜가 없으면 아직 막힌다: %s",
    (userText) => {
      expect(classifyAmoraQuestionScope({ userText }).scope)
        .toBe("W4_out_of_scope");
    },
  );
});
