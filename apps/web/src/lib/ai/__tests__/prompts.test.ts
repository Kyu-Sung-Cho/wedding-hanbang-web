import { describe, expect, it } from "vitest";
import { getWeddingPlannerSystemPrompt } from "../prompts";

const baseContext = {
  weddingDate: null,
  budget: 0,
  venue: null,
  progress: {},
  brideName: null,
  groomName: null,
  senderName: "민이",
  scheduleEvents: [],
  chatSummaries: [],
};

describe("getWeddingPlannerSystemPrompt", () => {
  it("includes actual booking cost and extra cost when outcome data exists", () => {
    const prompt = getWeddingPlannerSystemPrompt({
      ...baseContext,
      bookings: [
        {
          vendorName: "한방웨딩홀",
          category: "venue",
          date: "2026-11-28",
          time: "13:00",
          status: "completed",
          amount: 2_500_000,
          contractedAmount: 2_500_000,
          actualAmount: 3_000_000,
        },
      ],
    });

    expect(prompt).toContain("한방웨딩홀");
    expect(prompt).toContain("✅완료");
    expect(prompt).toContain("실결제: 300만원");
    expect(prompt).toContain("계약/견적: 250만원");
    expect(prompt).toContain("추가금: 50만원");
  });

  it("keeps the original booking amount when no actual cost is recorded", () => {
    const prompt = getWeddingPlannerSystemPrompt({
      ...baseContext,
      bookings: [
        {
          vendorName: "한방스튜디오",
          category: "studio",
          date: "2026-08-10",
          time: "11:00",
          status: "confirmed",
          amount: 500_000,
        },
      ],
    });

    expect(prompt).toContain("한방스튜디오");
    expect(prompt).toContain("✅확정");
    expect(prompt).toContain("예약금액: 50만원");
  });
});
