import { describe, expect, it } from "vitest";

import {
  getCanonicalCategoryKeyForMoment,
  type ScheduleCareMomentType,
} from "@hanbang/shared/constants";

describe("schedule care moment category contract", () => {
  it.each([
    ["family_greeting", "meeting"],
    ["sanggyeonrye", "meeting"],
    ["venue_tour", "venue"],
    ["studio_shoot", "studio"],
    ["dress_tour", "dress"],
    ["dress_fitting", "dress"],
    ["invitation_meeting", "invitation"],
    ["first_holiday", "general"],
  ] satisfies Array<[ScheduleCareMomentType, string]>) (
    "maps %s to the same canonical schedule category used by every client",
    (momentType, expectedCategoryKey) => {
      expect(getCanonicalCategoryKeyForMoment(momentType)).toBe(expectedCategoryKey);
    },
  );

  it("does not invent a category for an unknown or missing moment", () => {
    expect(getCanonicalCategoryKeyForMoment("unknown_moment")).toBeNull();
    expect(getCanonicalCategoryKeyForMoment(null)).toBeNull();
  });
});
