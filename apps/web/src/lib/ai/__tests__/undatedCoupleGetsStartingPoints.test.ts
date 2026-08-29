/**
 * 결혼일이 없어도 "뭐부터" 에 답이 있다.
 *
 * 예전에는 `preparationOrderSection` 이 `if (!context.weddingDate) return ""` 로
 * 끊겨서, 날짜를 아직 안 정한 커플이 시작점을 물으면 아모라가 아무 안내도 받지
 * 못했다. 팀 테스트(2026-08-29 리포트)의 커플이 정확히 그 상태였다 — 예식일 미설정,
 * 일정 0건, 예산 미설정.
 *
 * 화면과 같은 세 가지를 쓴다. `/start-here` 의 날짜 없음 흐름도 아모라에게
 * "날짜를 잡기 전에 둘이 먼저 맞춰볼 기준"을 묻고, `EARLY_STARTING_POINTS` 는
 * 두 곳이 같은 말을 하라고 공유해 둔 상수다.
 */
import { describe, expect, it } from "vitest";

import { EARLY_STARTING_POINTS } from "@/lib/marketing/preparationPriorities";
import { getWeddingPlannerSystemPrompt } from "@/lib/ai/prompts";

function ctx(over: Record<string, unknown>) {
  return {
    weddingDate: null, budget: 0, venue: null, progress: {},
    preparationStatus: null, brideName: "신부", groomName: "신랑",
    senderName: "신부", bookings: [], scheduleEvents: [],
    chatSummaries: [], pastConflicts: [], pastDecisions: [],
    ...over,
  } as never;
}

describe("날짜 없는 커플이 시작점을 물으면", () => {
  const asked = getWeddingPlannerSystemPrompt(ctx({ startingPointAsked: true }));

  it("화면과 같은 세 가지가 실린다", () => {
    for (const point of EARLY_STARTING_POINTS) {
      expect(asked, point.title).toContain(point.title);
      expect(asked, point.body).toContain(point.body);
    }
  });

  it("왜 그것이 먼저인지 말하게 한다", () => {
    // 리포트의 "왜 그 순서인지 설명이 부족" 이 이 줄이 없어서 났다.
    expect(asked).toContain("왜 그것이 먼저인지 한 줄로");
  });

  it("날짜부터 정하라고 몰지 않는다", () => {
    expect(asked).toContain("날짜부터 정하라고 몰지 마세요");
  });

  it("묻지 않은 턴에는 한 글자도 싣지 않는다", () => {
    // 프롬프트 상한이 빠듯하다. 이 목록은 물을 때만 실린다.
    const notAsked = getWeddingPlannerSystemPrompt(ctx({}));
    expect(notAsked).not.toContain(EARLY_STARTING_POINTS[0].title);
    expect(notAsked).not.toContain("날짜를 정하기 전에 먼저 맞출 기준");
  });

  it("날짜가 있는 커플에게는 이 문단이 안 간다", () => {
    // 대조군. 날짜가 있으면 원래의 준비 순서 목록을 받아야 한다.
    const dated = getWeddingPlannerSystemPrompt(
      ctx({ weddingDate: "2027-06-20", startingPointAsked: true }),
    );
    expect(dated).not.toContain("날짜를 정하기 전에 먼저 맞출 기준");
    expect(dated).toMatch(/## (?:지금 확인할 준비 3가지|아직 이르면 먼저 맞출 기준 3가지)/u);
  });
});
