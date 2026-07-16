// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
  getExpectedMediationRevision,
  normalizeMediationBlock,
} from "../mediationBlock";

describe("normalizeMediationBlock", () => {
  it("preserves the exact server revision needed for informed confirmation", () => {
    expect(normalizeMediationBlock({
      resolution: "  예산 상한선을 같이 확인해 봐요  ",
      proposalVersion: "123E4567-E89B-42D3-A456-426614174000",
      rosterFingerprint: "0123456789abcdef0123456789abcdef",
    })).toEqual({
      empathy: undefined,
      translation: undefined,
      data: undefined,
      resolution: "예산 상한선을 같이 확인해 봐요",
      proposalVersion: "123e4567-e89b-42d3-a456-426614174000",
      rosterFingerprint: "0123456789abcdef0123456789abcdef",
    });
  });

  it("keeps safe text and removes malformed JSONB fields before rendering", () => {
    expect(normalizeMediationBlock({
      empathy: "  속상했겠어요  ",
      translation: { unsafe: true },
      data: ["화면에 나오면 안 돼요"],
      resolution: 42,
      proposalVersion: "not-a-uuid",
      rosterFingerprint: "not-a-fingerprint",
      ignored: "화면에 나오면 안 돼요",
    })).toStrictEqual({
      empathy: "속상했겠어요",
      translation: undefined,
      data: undefined,
      resolution: undefined,
      proposalVersion: undefined,
      rosterFingerprint: undefined,
    });

    expect(normalizeMediationBlock({ resolution: "가".repeat(501) })).toBeNull();
    expect(normalizeMediationBlock(null)).toBeNull();
    expect(normalizeMediationBlock([])).toBeNull();
  });

  it("fails closed unless both exact revision fields are valid", () => {
    expect(getExpectedMediationRevision({
      resolution: "초안 내용은 표시해요",
      proposalVersion: "123e4567-e89b-42d3-a456-426614174000",
    })).toBeNull();
    expect(getExpectedMediationRevision({
      resolution: "초안 내용은 표시해요",
      proposalVersion: "123e4567-e89b-42d3-a456-426614174000",
      rosterFingerprint: "0123456789abcdef0123456789abcdef",
    })).toEqual({
      expectedProposalVersion: "123e4567-e89b-42d3-a456-426614174000",
      expectedRosterFingerprint: "0123456789abcdef0123456789abcdef",
    });
  });
});
