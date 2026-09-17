import { describe, expect, it } from "vitest";

import {
  selectAmoraPendingProposalTools,
  type AmoraProposalContinuityAnchor,
} from "@/lib/ai/amoraToolPolicy";
import { isMutatingTool } from "@/lib/ai/mutationTools";
import {
  matchedSpecialistByKeyword,
  routeSpecialist,
} from "@/lib/ai/stage-router";
import { BETA_SAFE_TOOLS } from "@/lib/ai/tools";
import type { StageTag } from "@/types/moat.types";

/**
 * 짧은 답이 **앞 요청이 자기 턴에서 받았던 확인 카드 도구**를 이어받는가.
 *
 * 2026-09-17 라이브 재현(세 단계 모두 같았다):
 *
 *   사용자: U1 (아래) — 배분표를 짜 달라는 요청      → 예산 카드 도구 4개
 *   아모라: (배분표)
 *   사용자: "응, 이대로 실제 예산에 반영해줘."        → 같은 4개
 *   아모라: "… 적용할까요?"                          ← 글로만 되물음
 *   사용자: "응 적용해줘"                            → **0개**
 *
 * 라우트는 연속성이 증명된 턴에서 U1 과 답을 이어 붙여 선택기에 넘기는데, 전문분야는
 * 답만 보고 정한다. 답에는 키워드가 없어 관문 해제가 꺼지고, 이어 붙인 문장의 가드가
 * **U1 자신의 "알려줘"** 에 걸렸다. 카드 계약이 빠지자 아모라는 기능이 없다며 직접
 * 입력하라고 답했다.
 *
 * 입력은 라우트가 만드는 모양 그대로다 — 답의 라우팅은 답만으로, 닻의 라우팅은
 * 앞 요청만으로 계산한다.
 */

const PENDING_ACTION_TOOLS = BETA_SAFE_TOOLS.filter((tool) => isMutatingTool(tool.name));
const STAGES: readonly StageTag[] = ["planning_0", "preparation_1", "execution_2"];
const BUDGET_CARD_TOOLS = [
  "update_budget",
  "update_category_budget",
  "apply_budget_plan",
  "add_custom_category",
] as const;

const U1 =
  "우리 조건 다시 정리할게. 총예산 3,500만원, 신혼집·가전·가구는 예산에서 제외하고, 하객은 90명 정도야. 이 기준으로 항목별 예산 배분을 표로 짜주고, 왜 그렇게 나눴는지도 알려줘.";

/** 자기 턴에서 키워드로 배분 경로에 들어가 예산 카드 도구를 받는 계획 요청. */
const PLANNING_ANCHORS = [
  U1,
  "총예산 5천만원 기준으로 항목별 예산 배분 추천해줘",
  "하객 150명이면 식대 예산 얼마로 잡는 게 좋을까",
  "식대 예산 얼마 정도가 적당한지 알려줘",
] as const;

/** 앞 요청을 그대로 잇는 동의·정정. */
const CONTINUING_REPLIES = [
  "응",
  "응 적용해줘",
  "네 반영해줘",
  "이대로 적용해줘",
  "좋아, 이대로 적용해줘",
  "그렇게 해줘",
  "아니 4천으로 해줘",
  "아니 식대는 1200만원으로 해줘",
] as const;

/** 답 자신이 무르는 말 — 앞 요청의 카드 도구를 이어받지 않는다. */
const CLOSING_REPLIES = [
  "응 농담이야",
  "아니 아직 정하지 않았어",
  "음 고민 중이야",
  "응 근데 추천해줘",
  "응 ㅋㅋ",
] as const;

/**
 * 앞 요청을 **거절하는** 답 (2026-09-18 검토).
 *
 * 위 `CLOSING_REPLIES` 는 값이 덜 정해졌거나 우리 말이 아닌 경우였다. 그냥 "하지
 * 마" 라고 거절한 답은 그 셋 중 어디에도 없어서, 앞 요청의 카드 도구를 그대로
 * 이어받았다 — 누르지 않으면 아무것도 저장되지 않지만, 거절한 답에 카드를 내미는
 * 것 자체가 틀렸다. `없던 일로 해줘` 만 `RETRACTION` 에 걸려 이미 닫혀 있었다.
 */
const REFUSING_REPLIES = [
  // 검토가 적어 온 다섯 문장.
  "아니 됐어",
  "아니 하지 마",
  "나중에 할래",
  "취소해줘",
  "안 할래",
  // 같은 말의 다른 모양.
  "됐어",
  "하지 마",
  "아냐 됐어",
  "아니요 괜찮아요",
  "아니 지금은 안 할래",
  "안 해도 돼",
  "필요 없어",
  "관둬",
  "관둘래",
  "그만",
  "그만하자",
  "아니 취소",
  "취소할래",
  "아니 그냥 놔둬",
  "반영하지 마",
  "저장하지 마",
  "적용하지 말아줘",
  "지금은 하지 말아줘",
  "일단 하지 마",
  "다시 생각해볼게",
  "좀 더 생각해볼게",
  "나중에 하자",
  // 항목을 말하지만 거절이다. "새 값을 말하면 정정" 예외를 넣었다가 이 줄 때문에 뺐다 —
  // 무엇을 미루는지 적은 거절이 정정으로 읽혔다.
  "드레스는 나중에 할래",
  // 이 갈래는 `RETRACTION` 이 이미 닫고 있었다. 회귀 여부를 같이 본다.
  "없던 일로 해줘",
] as const;

/**
 * 거절인데 **자기 문장이 금액을 품어** 이어 붙인 문장만으로 예산 경로가 열리는 답.
 *
 * "300만원" 이 키워드로 배분 경로를 열어 `pendingProposalToolNames` 의 관문 해제가
 * 켜지므로, 이 턴은 닻이 없어도 예산 카드 도구가 나온다 — 803831b6 이전과 같은 경로다.
 * 여기서 고정하는 것은 **닻이 아무것도 더하지 않는다**는 것이다.
 */
const REFUSING_REPLIES_WITH_OWN_VALUE = ["300만원은 필요 없어"] as const;

/**
 * 거절처럼 생겼지만 **새 값을 주는** 답 — 정정이라 계속 이어받는다.
 *
 * "아니" 와 "하지 마" 만 보면 아래 문장들도 거절로 읽힌다. 금액·날짜·항목 이름이
 * 있으면 무엇으로 바꾸라는 말이므로 거절로 보지 않는다.
 */
const CORRECTING_REPLIES = [
  "아니 3천으로 바꿔줘",
  "아니 10월 18일로 해줘",
  "아니 다음 주 화요일로 옮겨줘",
  "아니 그건 하지 말고 식대는 1200만원으로 올려줘",
  "아니 드레스는 하지 말고 스튜디오로 해줘",
  // 무엇을 취소하라는 말은 정당한 변경 요청이다(`pendingProposalToolNames` 주석).
  "드레스 투어 일정 취소해줘",
  "예약 취소해줘",
] as const;

/** 거절 낱말을 품었지만 거절이 아닌 말 — 오탐이면 위 D1 결함이 되살아난다. */
const NOT_REFUSING_REPLIES = [
  "잘 됐어",
  "거의 다 됐어",
  "안 됐어",
  "그만큼이면 충분해",
  // 사양이 아니라 되묻는 말 — "그건 괜찮아?" 는 그 항목이 괜찮은지 묻는 것이다.
  "그건 괜찮아?",
] as const;

/** 금액·날짜를 스스로 품은 직접 변경 요청. 이어 붙인 문장만으로도 도구가 나온다. */
const DIRECT_CHANGE_ANCHORS = [
  "결혼식장 예산 1800만원으로 다시 바꿔줘",
  "10월 17일 오후 2시에 드레스 투어 일정 넣어줘",
] as const;

/** 자기 턴에서도 카드 도구가 없던 앞 요청 — 이어받을 것이 없다. */
const NO_OFFER_ANCHORS = [
  // 남에게 들은 말.
  "친구는 드레스에 300만원 썼대",
  // 키워드 없이 단계 기본값으로 떨어진 상담 질문(dd2f127b 계약).
  "드레스 투어 언제 하는 게 좋을까",
] as const;

function anchorFor(prior: string, reply: string, stage: StageTag): AmoraProposalContinuityAnchor {
  return {
    priorUserText: prior,
    priorSpecialistType: routeSpecialist(prior, stage),
    priorSpecialistMatchedByKeyword: matchedSpecialistByKeyword(prior),
    replyText: reply,
  };
}

/** 라우트의 후속 턴 호출. `withAnchor=false` 는 이 수리 전과 같은 입력이다. */
function offeredOnFollowUp(
  prior: string,
  reply: string,
  stage: StageTag,
  withAnchor = true,
): string[] {
  return selectAmoraPendingProposalTools({
    availableTools: PENDING_ACTION_TOOLS,
    userText: `${prior}\n${reply}`,
    specialistType: routeSpecialist(reply, stage),
    specialistMatchedByKeyword: matchedSpecialistByKeyword(reply),
    attachmentKind: "none",
    ...(withAnchor ? { continuityAnchor: anchorFor(prior, reply, stage) } : {}),
  }).map((tool) => tool.name);
}

/** 앞 요청이 자기 턴에서 받았던 제안 도구. */
function offeredOnOwnTurn(prior: string, stage: StageTag): string[] {
  return selectAmoraPendingProposalTools({
    availableTools: PENDING_ACTION_TOOLS,
    userText: prior,
    specialistType: routeSpecialist(prior, stage),
    specialistMatchedByKeyword: matchedSpecialistByKeyword(prior),
    attachmentKind: "none",
  }).map((tool) => tool.name);
}

describe("짧은 답은 앞 요청이 받았던 확인 카드 도구를 이어받는다", () => {
  it.each(STAGES)("라이브 재현: U1 뒤의 \"응 적용해줘\" 가 예산 카드 도구를 받는다 (%s)", (stage) => {
    const reply = "응 적용해줘";
    // 라우트가 답만으로 고른 라우팅 — 세 단계 모두 키워드 일치가 없다.
    expect(matchedSpecialistByKeyword(reply)).toBe(false);
    expect(routeSpecialist(reply, stage)).toBe({
      planning_0: "sangkyeonrye_advisor",
      preparation_1: "budget_optimizer",
      execution_2: "ceremony_coordinator",
    }[stage as "planning_0" | "preparation_1" | "execution_2"]);
    // 닻의 라우팅은 U1 자신의 것이다.
    expect(routeSpecialist(U1, stage)).toBe("budget_optimizer");
    expect(matchedSpecialistByKeyword(U1)).toBe(true);

    // 닻이 없으면 이 수리 전과 같다 — 이어 붙인 문장의 가드가 U1 의 "알려줘" 에 걸린다.
    expect(offeredOnFollowUp(U1, reply, stage, false)).toEqual([]);
    expect([...offeredOnFollowUp(U1, reply, stage)].sort()).toEqual([...BUDGET_CARD_TOOLS].sort());
  });

  describe.each(PLANNING_ANCHORS)("앞 요청: %s", (prior) => {
    it.each(STAGES)("자기 턴에서 예산 카드 도구를 받는다 (%s)", (stage) => {
      expect(offeredOnOwnTurn(prior, stage)).toEqual(expect.arrayContaining([...BUDGET_CARD_TOOLS]));
    });

    it.each(CONTINUING_REPLIES)("잇는 답 \"%s\" 는 그 도구를 받는다", (reply) => {
      for (const stage of STAGES) {
        const offered = offeredOnFollowUp(prior, reply, stage);
        expect(offered, stage).toEqual(expect.arrayContaining([...BUDGET_CARD_TOOLS]));
        expect(offered, stage).toEqual(expect.arrayContaining(offeredOnOwnTurn(prior, stage)));
      }
    });
  });

  it.each(CLOSING_REPLIES)("무르는 답 \"%s\" 는 U1 뒤에서도 카드 도구를 받지 않는다", (reply) => {
    for (const stage of STAGES) {
      expect(offeredOnFollowUp(U1, reply, stage), stage).toEqual([]);
      expect(offeredOnFollowUp(U1, reply, stage, false), stage).toEqual([]);
    }
  });

  describe.each(NO_OFFER_ANCHORS)("자기 턴에도 카드가 없던 앞 요청: %s", (prior) => {
    it.each(STAGES)("자기 턴의 제안 도구가 없다 (%s)", (stage) => {
      expect(offeredOnOwnTurn(prior, stage)).toEqual([]);
    });

    it.each([...CONTINUING_REPLIES, ...CLOSING_REPLIES])("답 \"%s\" 뒤에서 새로 열리는 것이 없다", (reply) => {
      for (const stage of STAGES) {
        expect(offeredOnFollowUp(prior, reply, stage), stage)
          .toEqual(offeredOnFollowUp(prior, reply, stage, false));
      }
    });

    // 금액을 스스로 담은 정정("식대는 1200만원으로 해줘")은 답 자체가 변경 요청이라 오늘도
    // 열린다. 그 외의 답은 앞 요청 없이 아무것도 가리키지 않는다.
    it.each([...CONTINUING_REPLIES.filter((reply) => reply !== "아니 식대는 1200만원으로 해줘"), ...CLOSING_REPLIES])(
      "답 \"%s\" 는 카드 도구를 받지 않는다",
      (reply) => {
        for (const stage of STAGES) {
          expect(offeredOnFollowUp(prior, reply, stage), stage).toEqual([]);
        }
      },
    );
  });

  it.each(["응 농담이야", "음 고민 중이야", "응 근데 추천해줘"])(
    "직접 변경 요청 뒤에서도 무르는 답 \"%s\" 는 오늘처럼 닫혀 있다",
    (reply) => {
      const prior = DIRECT_CHANGE_ANCHORS[0];
      for (const stage of STAGES) {
        expect(offeredOnOwnTurn(prior, stage).length, stage).toBeGreaterThan(0);
        expect(offeredOnFollowUp(prior, reply, stage), stage).toEqual([]);
        expect(offeredOnFollowUp(prior, reply, stage, false), stage).toEqual([]);
      }
    },
  );

  describe("거절한 답은 앞 요청의 카드 도구를 이어받지 않는다", () => {
    it.each(REFUSING_REPLIES)("거절 \"%s\" 는 U1 뒤에서 카드 도구를 받지 않는다", (reply) => {
      for (const stage of STAGES) {
        expect(offeredOnFollowUp(U1, reply, stage), stage).toEqual([]);
      }
    });

    // 계획 요청 뒤가 아니라 **직접 변경 요청** 뒤의 거절이다. 이어 붙인 문장 자신이
    // 금액·날짜를 품고 있어 그 경로로는 오늘도 도구가 나온다(이 수리 전과 같다).
    // 여기서 고정하는 것은 **닻이 아무것도 더하지 않는다**는 것뿐이다.
    it.each([...REFUSING_REPLIES, ...REFUSING_REPLIES_WITH_OWN_VALUE])(
      "거절 \"%s\" 뒤에서 닻은 아무것도 더하지 않는다",
      (reply) => {
        for (const prior of [...PLANNING_ANCHORS, ...DIRECT_CHANGE_ANCHORS]) {
          for (const stage of STAGES) {
            const label = `${prior} / ${stage}`;
            expect(offeredOnFollowUp(prior, reply, stage), label)
              .toEqual(offeredOnFollowUp(prior, reply, stage, false));
          }
        }
      },
    );

    it.each(CORRECTING_REPLIES)("값을 주는 정정 \"%s\" 는 계속 이어받는다", (reply) => {
      for (const prior of PLANNING_ANCHORS) {
        for (const stage of STAGES) {
          expect(offeredOnFollowUp(prior, reply, stage), `${prior} / ${stage}`)
            .toEqual(expect.arrayContaining([...BUDGET_CARD_TOOLS]));
        }
      }
    });

    it.each(NOT_REFUSING_REPLIES)("거절이 아닌 \"%s\" 는 계속 이어받는다", (reply) => {
      for (const prior of PLANNING_ANCHORS) {
        for (const stage of STAGES) {
          expect(offeredOnFollowUp(prior, reply, stage), `${prior} / ${stage}`)
            .toEqual(expect.arrayContaining([...BUDGET_CARD_TOOLS]));
        }
      }
    });
  });

  it("더해지는 것은 앞 요청이 이미 받았던 것뿐이고, 오늘 받던 것은 줄지 않는다", () => {
    const anchors = [
      ...PLANNING_ANCHORS,
      ...NO_OFFER_ANCHORS,
      ...DIRECT_CHANGE_ANCHORS,
      "드레스 예산을 450만 원으로 늘리면 남은 예산이 어떻게 돼?",
    ];
    const replies = [
      ...CONTINUING_REPLIES,
      ...CLOSING_REPLIES,
      ...REFUSING_REPLIES,
      ...REFUSING_REPLIES_WITH_OWN_VALUE,
      ...CORRECTING_REPLIES,
      ...NOT_REFUSING_REPLIES,
      "응 알겠어",
      "응 고마워",
      "사진 촬영만",
      "2026년으로 넣어줘",
    ];
    let widened = 0;
    for (const prior of anchors) {
      for (const reply of replies) {
        for (const stage of STAGES) {
          const label = `${prior} / ${reply} / ${stage}`;
          const before = offeredOnFollowUp(prior, reply, stage, false);
          const after = offeredOnFollowUp(prior, reply, stage);
          const ceiling = new Set([...before, ...offeredOnOwnTurn(prior, stage)]);
          expect(after, label).toEqual(expect.arrayContaining(before));
          expect(after.filter((name) => !ceiling.has(name)), label).toEqual([]);
          if (after.length > before.length) widened += 1;
        }
      }
    }
    // 불변식이 공허하게 참이 아님을 확인한다 — 실제로 넓어지는 칸이 있어야 한다.
    expect(widened).toBeGreaterThan(0);
  });

  it("닻이 없으면 이어 붙인 문장만 본다(이 수리 전과 같은 입력)", () => {
    for (const stage of STAGES) {
      expect(offeredOnFollowUp(U1, "응", stage, false)).toEqual([]);
      expect(offeredOnFollowUp(U1, "네 반영해줘", stage, false)).toEqual([]);
    }
  });
});
