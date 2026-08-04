import { describe, expect, it } from "vitest";

import { isAmoraCommunityBridgeSafetyScoped } from "../amoraCommunitySafety";

function message(overrides: Record<string, unknown> = {}) {
  return {
    sender_role: "bride",
    content: "웨딩 스튜디오 두 곳을 비교해줘",
    metadata: null,
    ...overrides,
  } as never;
}

describe("isAmoraCommunityBridgeSafetyScoped", () => {
  it.each([
    ["server W2 marker", message({
      sender_role: "ai",
      content: "안전하게 정리해볼게요",
      metadata: { question_scope: "W2_high_risk_adjacent" },
    })],
    ["server W5 marker", message({
      sender_role: "ai",
      content: "고정 안전 안내",
      metadata: { question_scope: "W5_safety_override" },
    })],
    ["pinned local safety card", message({
      sender_role: "ai",
      metadata: { pinned_safety_card: true },
    })],
    ["legacy legal W2 user", message({
      content: "이 웨딩 계약 조항이 법적으로 유효한지 판단해줘",
    })],
    ["legacy historical violence W2 user", message({
      content: "작년에 상대가 칼로 협박했는데 지금은 안전해",
    })],
    ["legacy immediate W5 user", message({
      content: "상대가 지금 칼을 들고 나를 죽이겠다고 해",
    })],
  ])("blocks %s", (_label, candidate) => {
    expect(isAmoraCommunityBridgeSafetyScoped(candidate)).toBe(true);
  });

  it("keeps an ordinary W0 wedding question eligible", () => {
    expect(isAmoraCommunityBridgeSafetyScoped(message())).toBe(false);
  });

  it("does not infer scope from untrusted assistant prose alone", () => {
    expect(isAmoraCommunityBridgeSafetyScoped(message({
      sender_role: "ai",
      content: "법률 상담은 전문가 확인이 필요해요",
      metadata: null,
    }))).toBe(false);
  });
});
