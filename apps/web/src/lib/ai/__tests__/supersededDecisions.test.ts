import { describe, expect, it } from "vitest";
import {
  dropSupersededDecisions,
  isSupersededDecision,
  type CurrentJourneyFacts,
} from "@/lib/ai/supersededDecisions";

// 파운더 질문: "예산을 다시 입력하면 예전 기록은 다 지워지고, 다시는 예전 정보로
// 정보를 주는 게 아닌 거지?"
//
// 값 자체는 깨끗하게 대체된다. 새지 않는 것도 확인했다. 새는 곳은 결정 영수증이다 —
// `superseded_at`을 세우는 코드가 없어서 예전 판본이 계속 살아 있고, 프롬프트가 2주 지난
// 결정을 "혹시 아직도..." 톤으로 회상하라고 지시한다.

const NO_FACTS: CurrentJourneyFacts = { venue: null, events: [] };

describe("예식장", () => {
  it("바꾼 뒤에는 예전 식장 기록을 현재처럼 보여주지 않는다", () => {
    // 온보딩 기록은 제목 자체가 식장 이름이다(api/onboarding/route.ts).
    expect(isSupersededDecision(
      { category: "venue", title: "강남 A홀", chosenValue: { venue: "강남 A홀" } },
      { venue: "B홀", events: [] },
    )).toBe(true);
  });

  it("아직 정한 곳이 없으면 고려하던 곳을 지우지 않는다", () => {
    expect(isSupersededDecision(
      { category: "venue", title: "강남 A홀", chosenValue: { venue: "강남 A홀" } },
      NO_FACTS,
    )).toBe(false);
  });

  it("지금 정한 그 식장 기록은 그대로 남긴다", () => {
    expect(isSupersededDecision(
      { category: "venue", title: "강남 A홀", chosenValue: null },
      { venue: "  강남   A홀 ", events: [] },
    )).toBe(false);
  });
});

describe("일정", () => {
  const receipt = (date: string, title: string) => ({
    category: "schedule",
    title,
    chosenValue: { eventId: "evt-1", after: { date, title } },
  });

  it("날짜를 옮기면 예전 날짜 영수증은 현재에서 빠진다", () => {
    // 3/20 → 3/27로 옮겨도 두 영수증이 다 살아 있었다.
    expect(isSupersededDecision(
      receipt("2027-03-20", "드레스 투어"),
      { venue: null, events: [{ id: "evt-1", date: "2027-03-27", title: "드레스 투어" }] },
    )).toBe(true);
  });

  it("현재와 같은 판본의 영수증은 남긴다", () => {
    expect(isSupersededDecision(
      receipt("2027-03-27", "드레스 투어"),
      { venue: null, events: [{ id: "evt-1", date: "2027-03-27", title: "드레스 투어" }] },
    )).toBe(false);
  });

  it("제목만 바뀐 경우도 지나간 판본으로 본다", () => {
    expect(isSupersededDecision(
      receipt("2027-03-27", "드레스 투어"),
      { venue: null, events: [{ id: "evt-1", date: "2027-03-27", title: "드레스 가봉" }] },
    )).toBe(true);
  });

  it("일정이 사라졌으면 그 영수증도 현재가 아니다", () => {
    expect(isSupersededDecision(receipt("2027-03-20", "드레스 투어"), NO_FACTS)).toBe(true);
  });
});

describe("모르면 지우지 않는다", () => {
  it("판단 근거가 없는 결정은 남긴다", () => {
    // 사용자가 실제로 한 결정을 지우는 쪽이, 오래된 결정을 한 번 더 보여주는 쪽보다 나쁘다.
    for (const decision of [
      { category: "preference", title: "밝은 톤이 좋아요", chosenValue: null },
      { category: "budget", title: "예산 정리", chosenValue: { value: "3000만원" } },
      { category: "venue", title: "", chosenValue: null },
    ]) {
      expect(isSupersededDecision(decision, { venue: "B홀", events: [] })).toBe(false);
    }
  });

  it("적대적인 모양에도 던지지 않는다", () => {
    for (const hostile of [null, undefined, 42, "decision", []]) {
      expect(() => isSupersededDecision(hostile as never, NO_FACTS)).not.toThrow();
    }
    expect(isSupersededDecision(
      { category: "schedule", title: "x", chosenValue: { eventId: 42, after: null } as never },
      NO_FACTS,
    )).toBe(false);
  });
});

describe("dropSupersededDecisions", () => {
  it("지나간 판본만 걷어내고 순서를 지킨다", () => {
    const decisions = [
      { category: "venue", title: "강남 A홀", chosenValue: null },
      { category: "preference", title: "밝은 톤", chosenValue: null },
      { category: "venue", title: "B홀", chosenValue: null },
    ];

    expect(dropSupersededDecisions(decisions, { venue: "B홀", events: [] })).toEqual([
      { category: "preference", title: "밝은 톤", chosenValue: null },
      { category: "venue", title: "B홀", chosenValue: null },
    ]);
  });
});
