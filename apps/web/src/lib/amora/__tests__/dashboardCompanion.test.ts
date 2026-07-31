import { describe, expect, it } from "vitest";

import {
  buildJoinedDashboardRedirect,
  getDashboardCompanionCopy,
  hasJoinedDashboardMarker,
  removeJoinedDashboardMarker,
} from "../dashboardCompanion";

describe("Amora dashboard companion flow", () => {
  it("gives a solo planner one next action without treating the plan as incomplete", () => {
    const copy = getDashboardCompanionCopy(false);

    expect(copy.loungeLabel).toBe("나의 웨딩 라운지");
    expect(copy.statusHeading).toBe("혼자 준비 중");
    expect(copy.description).toContain("나중에");
    expect(copy.amoraPrompt).toContain("한 가지만");
    expect(copy.amoraPrompt).not.toContain("담당자");
  });

  it("gives connected partners a joint check and divisible work without assigning owners", () => {
    const copy = getDashboardCompanionCopy(true);

    expect(copy.loungeLabel).toBe("우리 둘의 웨딩 라운지");
    expect(copy.statusHeading).toBe("함께 준비 중");
    expect(copy.amoraPrompt).toContain("같이 확인할 한 가지");
    expect(copy.amoraPrompt).toContain("나눠 할 수 있는 일 한 가지");
    expect(copy.amoraPrompt).toContain("담당자는 정하지 말고");
  });

  it("uses an exact, removable join marker without storing it", () => {
    expect(buildJoinedDashboardRedirect()).toBe("/wedding/lounge?joined=1");
    expect(hasJoinedDashboardMarker("?joined=1")).toBe(true);
    expect(hasJoinedDashboardMarker("?joined=true")).toBe(false);
    expect(hasJoinedDashboardMarker("?joined=2")).toBe(false);
    expect(removeJoinedDashboardMarker(
      "/wedding/lounge",
      "?joined=1&from=invite",
      "#today",
    )).toBe("/wedding/lounge?from=invite#today");
  });
});
