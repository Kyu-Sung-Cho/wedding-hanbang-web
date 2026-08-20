import { describe, expect, it } from "vitest";

import {
  buildNeutralPreparationSpaceSubmission,
  parseNeutralPreparationSpaceCapability,
  resolveNeutralPreparationSpaceRedirect,
} from "./neutralPreparationSpace";

describe("web neutral preparation-space onboarding", () => {
  it("accepts only the server's exact enabled capability", () => {
    expect(parseNeutralPreparationSpaceCapability({
      neutralPreparationSpace: true,
    })).toBe(true);
    expect(parseNeutralPreparationSpaceCapability({
      neutralPreparationSpace: false,
    })).toBe(false);
    expect(parseNeutralPreparationSpaceCapability({
      neutralPreparationSpace: "true",
    })).toBe(false);
    expect(parseNeutralPreparationSpaceCapability(null)).toBe(false);
  });

  it("creates a roleless empty preparation space without hidden personal inputs", () => {
    expect(buildNeutralPreparationSpaceSubmission({
      coupleAction: "create",
      partnerInviteCode: "",
    })).toEqual({
      membershipMode: "neutral_preparation_space",
      coupleAction: "create",
      weddingDate: null,
      venue: null,
      totalBudget: null,
      progress: {},
    });
  });

  it("normalizes only a valid join code and never adds a compatibility role", () => {
    expect(buildNeutralPreparationSpaceSubmission({
      coupleAction: "join",
      partnerInviteCode: " wh-ab12cd ",
    })).toEqual({
      membershipMode: "neutral_preparation_space",
      coupleAction: "join",
      partnerInviteCode: "WH-AB12CD",
      weddingDate: null,
      venue: null,
      totalBudget: null,
      progress: {},
    });
    expect(() => buildNeutralPreparationSpaceSubmission({
      coupleAction: "join",
      partnerInviteCode: "invalid",
    })).toThrow("INVALID_NEUTRAL_PREPARATION_INVITE_CODE");
  });

  it("opens Amora by default while preserving an explicit safe destination", () => {
    expect(resolveNeutralPreparationSpaceRedirect({
      search: "",
      origin: "https://hanbang.ai",
    })).toBe("/wedding/chat?source=neutral_onboarding");
    expect(resolveNeutralPreparationSpaceRedirect({
      search: "?redirect=%2Fwedding%2Fbudget",
      origin: "https://hanbang.ai",
    })).toBe("/wedding/budget");
    expect(resolveNeutralPreparationSpaceRedirect({
      search: "?redirect=https%3A%2F%2Fevil.example",
      origin: "https://hanbang.ai",
    })).toBe("/wedding/chat?source=neutral_onboarding");
  });
});
