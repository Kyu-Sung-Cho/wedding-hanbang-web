import { describe, expect, it, vi } from "vitest";

import {
  detectCoupleConflict,
  type CoupleMessage,
} from "../conflict-detector";

function message(
  senderRole: "bride" | "groom",
  content: string,
  secondsAgo: number,
): CoupleMessage {
  return {
    senderRole,
    content,
    createdAt: new Date(Date.now() - secondsAgo * 1_000).toISOString(),
    visibility: "shared",
    metadata: null,
  };
}

describe("detectCoupleConflict safety gates", () => {
  it("can hard-trigger only after both people show conflict evidence", async () => {
    const runProviderCall = vi.fn();
    const result = await detectCoupleConflict({
      recentSharedMessages: [
        message("bride", "너는 맨날 내 말을 안 들어서 너무 서운해.", 20),
        message("groom", "난 절대 반대야. 그건 동의 못 해.", 10),
      ],
      pastConflicts: [],
      runProviderCall,
    });

    expect(result).toMatchObject({
      triggered: true,
      llmVerified: false,
    });
    expect(result.score).toBeGreaterThanOrEqual(10);
    expect(runProviderCall).not.toHaveBeenCalled();
  });

  it("rejects one person's repeated conflict language even when the partner replied", async () => {
    const runProviderCall = vi.fn();
    const result = await detectCoupleConflict({
      recentSharedMessages: [
        message("bride", "너는 맨날 내 말을 안 들어. 너무 답답해.", 30),
        message("groom", "알겠어. 저녁에 이야기하자.", 20),
        message("bride", "진짜 화가 나고 너무 서운해.", 10),
      ],
      pastConflicts: [],
      runProviderCall,
    });

    expect(result.triggered).toBe(false);
    expect(result.reason).toContain("양측 갈등 발화 부족");
    expect(runProviderCall).not.toHaveBeenCalled();
  });

  it("rejects third-party narratives from both roles without provider verification", async () => {
    const runProviderCall = vi.fn();
    const result = await detectCoupleConflict({
      recentSharedMessages: [
        message("bride", "친구가 남자친구가 말을 안 들어서 너무 화가 났대.", 20),
        message("groom", "엄마가 그 업체는 절대 안 된다고 반대래.", 10),
      ],
      pastConflicts: [],
      runProviderCall,
    });

    expect(result.triggered).toBe(false);
    expect(result.score).toBe(0);
    expect(result.reason).toContain("양측 갈등 발화 부족");
    expect(runProviderCall).not.toHaveBeenCalled();
  });

  it("requires recent speech from both bride and groom before scoring", async () => {
    const result = await detectCoupleConflict({
      recentSharedMessages: [
        message("bride", "대화가 안 돼. 너는 맨날 내 말을 안 들어.", 20),
        message("bride", "결혼 취소하고 싶을 만큼 화가 나.", 10),
      ],
      pastConflicts: [],
    });

    expect(result).toEqual({
      triggered: false,
      score: 0,
      reason: "양측 발화 부족 — 신부와 신랑의 최근 발화가 모두 필요",
      conflictContext: "",
      llmVerified: false,
    });
  });
});
