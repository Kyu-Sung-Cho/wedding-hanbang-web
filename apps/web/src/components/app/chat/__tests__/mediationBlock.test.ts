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
      origin: undefined,
      evidenceScope: undefined,
      schemaVersion: undefined,
      proposalVersion: undefined,
      rosterFingerprint: undefined,
    });

    expect(normalizeMediationBlock({ resolution: "가".repeat(501) })).toBeNull();
    expect(normalizeMediationBlock(null)).toBeNull();
    expect(normalizeMediationBlock([])).toBeNull();
  });

  it("opens confirmation only for a complete requester-summary v2 proposal", () => {
    expect(getExpectedMediationRevision({
      resolution: "초안 내용은 표시해요",
      proposalVersion: "123e4567-e89b-42d3-a456-426614174000",
      rosterFingerprint: "0123456789abcdef0123456789abcdef",
    })).toBeNull();
    expect(getExpectedMediationRevision({
      empathy: "요청자가 답답함을 느꼈다고 전했어요.",
      translation: "요청자가 예산 기준을 먼저 정하고 싶다고 전했어요.",
      data: "상대방의 예산 상한은 아직 확인되지 않았어요.",
      resolution: "같이 검토할 선택안이에요.",
      origin: "user_requested",
      evidenceScope: "requester_summary_only",
      schemaVersion: 2,
      proposalVersion: "123e4567-e89b-42d3-a456-426614174000",
      rosterFingerprint: "0123456789abcdef0123456789abcdef",
    })).toEqual({
      expectedProposalVersion: "123e4567-e89b-42d3-a456-426614174000",
      expectedRosterFingerprint: "0123456789abcdef0123456789abcdef",
    });
  });

  it.each([
    ["forged requester-summary v2", {
      empathy: "요청자가 답답하다고 전했어요.",
      translation: "신랑은 이기적이고 신부의 요구가 더 타당해요.",
      data: "상대방의 생각은 확인되지 않았어요.",
      resolution: "신랑이 먼저 사과하고 양보하는 게 좋겠어요.",
      origin: "user_requested",
      evidenceScope: "requester_summary_only",
      schemaVersion: 2,
      proposalVersion: "123e4567-e89b-42d3-a456-426614174000",
      rosterFingerprint: "0123456789abcdef0123456789abcdef",
    }],
    ["legacy stored card", {
      empathy: "신부가 답답하다고 했어요.",
      translation: "신부는 신랑을 통제하려고 일부러 결정을 미루는 거예요.",
      resolution: "신부가 먼저 양보하세요.",
    }],
  ])("fails closed instead of returning unsafe stored text from %s", (_label, stored) => {
    const normalized = normalizeMediationBlock(stored);

    expect(normalized).toEqual({ renderSafetyFallback: true });
    expect(JSON.stringify(normalized)).not.toContain("이기적");
    expect(JSON.stringify(normalized)).not.toContain("통제하려고");
    expect(getExpectedMediationRevision(normalized!)).toBeNull();
  });
});
