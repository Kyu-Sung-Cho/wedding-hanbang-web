import { describe, expect, it } from "vitest";
import { parseJourneyScalarPatch } from "../journeyScalarPatch";

describe("parseJourneyScalarPatch", () => {
  it("accepts only the three journey scalar fields", () => {
    expect(parseJourneyScalarPatch({
      wedding_date: "2027-05-08",
      total_budget: 10_000_000_000,
      venue: "  서울 예식장  ",
    })).toEqual({
      wedding_date: "2027-05-08",
      total_budget: 10_000_000_000,
      venue: "서울 예식장",
    });
  });

  it.each([
    { progress: {} },
    { progress_patch: { venue: {} } },
    { progress_remove_keys: ["__events"] },
    { __preferences: {} },
    { couple_id: "other-couple" },
    { wedding_date: "2027-05-08", progress: {} },
  ])("rejects broad or unknown mutation fields: %o", (body) => {
    expect(parseJourneyScalarPatch(body)).toBeNull();
  });

  it.each([
    {},
    { wedding_date: "2027-02-29" },
    { total_budget: "1000000" },
    { total_budget: 10_000_000_001 },
    { venue: 123 },
    { venue: "x".repeat(121) },
  ])("rejects empty or ambiguous scalar changes: %o", (body) => {
    expect(parseJourneyScalarPatch(body)).toBeNull();
  });

  it("allows explicit clearing without treating invalid values as clears", () => {
    expect(parseJourneyScalarPatch({ wedding_date: null, venue: null })).toEqual({
      wedding_date: null,
      venue: null,
    });
  });
});
