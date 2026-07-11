import { describe, expect, it } from "vitest";
import { dateLikeToYmdInKst, ddayInKst, kstMidnightFromYmd } from "../kstDate";

describe("KST date-only contract", () => {
  it("uses Korean calendar midnight on UTC servers", () => {
    expect(ddayInKst("2026-07-11", new Date("2026-07-10T14:59:59.000Z"))).toBe(1);
    expect(ddayInKst("2026-07-11", new Date("2026-07-10T15:00:00.000Z"))).toBe(0);
    expect(ddayInKst("2026-07-11", new Date("2026-07-11T15:00:00.000Z"))).toBe(-1);
  });

  it("rejects rollover and invalid values", () => {
    expect(ddayInKst("2026-02-30")).toBeNull();
    expect(dateLikeToYmdInKst("not-a-date")).toBeNull();
    expect(kstMidnightFromYmd("2026-02-30").getTime()).toBeNaN();
  });

  it("normalizes timestamp inputs to their KST date", () => {
    expect(dateLikeToYmdInKst("2026-07-10T15:00:00.000Z")).toBe("2026-07-11");
  });
});
