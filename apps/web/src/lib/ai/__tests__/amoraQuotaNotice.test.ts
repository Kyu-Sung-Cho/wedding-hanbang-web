import { describe, expect, it } from "vitest";
import { formatAmoraQuotaNotice, getAmoraQuotaWarning } from "@hanbang/shared";

describe("Amora quota notice contract", () => {
  it("emits an explicitly daily notice when the lifetime cap is disabled", () => {
    expect(getAmoraQuotaWarning({ allowed: true, dailyRemaining: 1 }))
      .toEqual({ type: "quota", remaining: 1, period: "daily" });
    expect(formatAmoraQuotaNotice(1, "daily")).toContain("오늘 상담이 약 1회");
    expect(formatAmoraQuotaNotice(1, "daily")).toContain("대화 정리");
  });

  it("keeps the lifetime notice compatible and chooses the nearer limit", () => {
    expect(getAmoraQuotaWarning({ allowed: true, remaining: 2, dailyRemaining: 5 }))
      .toEqual({ type: "quota", remaining: 2 });
    expect(getAmoraQuotaWarning({ allowed: true, remaining: 8, dailyRemaining: 1 }))
      .toEqual({ type: "quota", remaining: 1, period: "daily" });
    expect(formatAmoraQuotaNotice(2)).toBe("무료 상담이 2회 남았어요. 소진돼도 예산·일정 기록은 그대로 보관돼요.");
    expect(formatAmoraQuotaNotice(0)).toBe("무료 상담을 모두 사용했어요. 예산·일정 기록은 그대로 보관돼요.");
    expect(formatAmoraQuotaNotice(0, "daily")).toContain("내일");
  });

  it("does not imply quota for failed, exempt, distant or invalid counts", () => {
    for (const reservation of [
      { allowed: false, dailyRemaining: 0 },
      { allowed: true },
      { allowed: true, remaining: 16, dailyRemaining: 16 },
      { allowed: true, remaining: Number.NaN, dailyRemaining: Infinity },
      { allowed: true, remaining: -1, dailyRemaining: 0.5 },
    ]) expect(getAmoraQuotaWarning(reservation)).toBeNull();
    expect(getAmoraQuotaWarning({ allowed: true, dailyRemaining: 0 }))
      .toEqual({ type: "quota", remaining: 0, period: "daily" });
  });
});
