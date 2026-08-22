import { describe, expect, it } from "vitest";

import { selectAmoraPendingProposalTools } from "@/lib/ai/amoraToolPolicy";
import { isMutatingTool } from "@/lib/ai/mutationTools";
import { BETA_SAFE_TOOLS } from "@/lib/ai/tools";

/**
 * 자연스러운 한국어 변경 요청에 확인 카드를 낼 수 있는가.
 *
 * 2026-08-22 실측: 실제로 쓸 법한 변경 요청 12개 중 **7개가 도구 0개**였다.
 * 원인은 안전 분류가 아니라 선택기의 좁은 어형이었다 —
 * `DIRECT_CATEGORY_BUDGET_DECLARATION` 의 종결어가
 * `이야|야|썼어|결제했어|정했어|할게` 뿐이라 **"잡아줘·해줘·늘려줘"가 빠져 있었고**,
 * `스드메` 는 예산 카테고리 목록에 아예 없었다.
 *
 * 이 선택기는 쓰기 권한이 아니라 "확인 카드를 낼 수 있는가"만 정한다. 그래도
 * 넓히면 원치 않는 카드가 뜨므로, 카테고리(또는 스드메) + 금액 + 변경 동사가
 * 함께 있을 때만 인정한다.
 */

const PENDING_ACTION_TOOLS = BETA_SAFE_TOOLS.filter((tool) => isMutatingTool(tool.name));

function offeredFor(userText: string): string[] {
  return selectAmoraPendingProposalTools({
    availableTools: PENDING_ACTION_TOOLS,
    userText,
    specialistType: "general",
    attachmentKind: "none",
  }).map((tool) => tool.name);
}

describe("변경 요청에 카드를 낼 수 있어야 한다", () => {
  it.each([
    "드레스에 300만원 잡아줘",
    "스드메 400만원으로 맞춰줘",
    "신혼여행 500만원 더 늘려줘",
    "예식장 예산 200만원 줄여줘",
    "한복 예산 150만원으로 책정해줘",
  ])("예산 도구를 낸다: %s", (userText) => {
    const offered = offeredFor(userText);
    expect(offered.length).toBeGreaterThan(0);
    expect(offered).toContain("update_category_budget");
  });

  it("이미 되던 것은 그대로 된다", () => {
    expect(offeredFor("총 예산을 6000만원으로 바꿔줘")).toContain("update_budget");
    expect(offeredFor("예식장을 그랜드호텔로 정했어")).toContain("update_venue");
  });

  /**
   * 이 수리 중 내가 낸 회귀. 남의 이야기·가정을 막으려고 붙인 가드가
   * `NON_EXECUTABLE_DECLARATION` 이었는데 거기 `취소` 가 들어 있어서, 정당한
   * 취소 요청의 도구가 7개에서 0개가 됐다.
   */
  it("취소 요청은 막히지 않는다", () => {
    expect(offeredFor("본식 스냅은 취소하자").length).toBeGreaterThan(0);
    expect(offeredFor("예식장 방문 일정 취소해줘").length).toBeGreaterThan(0);
  });
});

describe("카드를 내면 안 되는 말", () => {
  it.each([
    // 금액이 없다 — 무엇을 얼마로 바꿀지 정해진 게 없다.
    "드레스 예쁜 거 추천해줘",
    // 남의 이야기다.
    "친구는 드레스에 300만원 썼대",
    // 가정이다.
    "드레스에 300만원 잡으면 어떨까",
    // 질문이다.
    "드레스 300만원이면 비싼 편인가요",
  ])("도구를 내지 않는다: %s", (userText) => {
    expect(offeredFor(userText)).toEqual([]);
  });
});

/**
 * 가정 질문에는 카드를 열지 않는다. 뒤따르는 "그럼 식대 6만원으로 잡아줘" 는
 * **별개 턴**이라 자기 어휘로 열리므로 흐름이 막히지 않는다.
 *
 * 단 서버가 배분·일정 전문 경로로 보낸 턴은 예외다 — 거기서는 "예산 어떻게
 * 나누면 좋을까?" 가 바로 방아쇠이고, 아모라가 배분안을 내고 사용자가 확인하는
 * 것이 설계된 흐름이다(`amoraToolPolicy.test.ts` 가 이 계약을 고정하고 있다).
 */
describe("가정 질문과 전문 경로", () => {
  it("그냥 던진 가정 질문에는 열지 않는다", () => {
    expect(offeredFor("하객 200명이면 식대가 얼마나 나올까")).toEqual([]);
    expect(offeredFor("총예산 6천만원으로 늘리면 감당 될까?")).toEqual([]);
  });

  it("배분 전문 경로에서는 같은 모양이 방아쇠다", () => {
    const planning = selectAmoraPendingProposalTools({
      availableTools: PENDING_ACTION_TOOLS,
      userText: "예산을 어떻게 나누면 좋을까?",
      specialistType: "budget_optimizer",
      attachmentKind: "none",
    }).map((tool) => tool.name);
    expect(planning).toContain("apply_budget_plan");
  });
});

/**
 * 2026-08-22 이 수리 중 내가 만든 버그의 회귀 테스트.
 *
 * 카테고리 어휘를 `BUDGET_CATEGORY_WORDS` 로 빼내 이어 붙였는데 **묶지 않았다.**
 * 교대(`A|B|C`)를 그대로 이으면 `A` 또는 `B` 또는 `C…뒤에오는것` 으로 갈라져,
 * 카테고리 **한 단어만으로** 매치됐다. "드레스" 한 마디에 예산 도구 4개가 열렸다.
 */
describe("카테고리 한 단어로는 열리지 않는다", () => {
  it.each(["드레스", "한복", "신혼여행", "부케"])("%s", (userText) => {
    expect(offeredFor(userText)).toEqual([]);
  });
});
