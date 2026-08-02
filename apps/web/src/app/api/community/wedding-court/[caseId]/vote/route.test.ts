// @vitest-environment node

import { NextRequest } from "next/server";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const AUTH_USER_ID = "11111111-1111-4111-8111-111111111111";
const BODY_USER_ID = "99999999-9999-4999-8999-999999999999";
const CASE_ID = "22222222-2222-4222-8222-222222222902";
const originalWeddingCourtFlag = process.env.WEDDING_COURT_ENABLED;

const mocks = vi.hoisted(() => ({
  createClientFromRequest: vi.fn(),
  checkCommunityWriteAccess: vi.fn(),
  castWeddingCourtVote: vi.fn(),
  checkRateLimit: vi.fn(),
  rateLimitKey: vi.fn(() => "court-test"),
}));

vi.mock("@/utils/trustedMutation", () => ({
  isTrustedMutationRequest: vi.fn(() => true),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClientFromRequest: mocks.createClientFromRequest,
}));

vi.mock("@/lib/community/writeAccess", () => ({
  checkCommunityWriteAccess: mocks.checkCommunityWriteAccess,
}));

vi.mock("@/lib/weddingCourt/repository", () => ({
  castWeddingCourtVote: mocks.castWeddingCourtVote,
  WeddingCourtRepositoryError: class WeddingCourtRepositoryError extends Error {
    constructor(public readonly code: string) {
      super(code);
    }
  },
}));

vi.mock("@/utils/rateLimit", () => ({
  checkRateLimit: mocks.checkRateLimit,
  rateLimitKey: mocks.rateLimitKey,
}));

import { POST } from "./route";

function request(body: object) {
  return new NextRequest(
    `http://localhost/api/community/wedding-court/${CASE_ID}/vote`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

function context(caseId = CASE_ID) {
  return { params: Promise.resolve({ caseId }) };
}

describe("POST /api/community/wedding-court/[caseId]/vote", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.WEDDING_COURT_ENABLED = "true";
    mocks.createClientFromRequest.mockResolvedValue({
      auth: {
        getUser: vi.fn(async () => ({
          data: { user: { id: AUTH_USER_ID } },
        })),
      },
    });
    mocks.checkCommunityWriteAccess.mockResolvedValue({ allowed: true });
    mocks.checkRateLimit.mockReturnValue(null);
    mocks.castWeddingCourtVote.mockResolvedValue({
      action: "created",
      courtCase: { id: CASE_ID, stage: "appeal_vote" },
    });
  });

  afterAll(() => {
    if (originalWeddingCourtFlag === undefined) {
      delete process.env.WEDDING_COURT_ENABLED;
    } else {
      process.env.WEDDING_COURT_ENABLED = originalWeddingCourtFlag;
    }
  });

  it("returns not found before params, auth, rate limits, or writes when disabled", async () => {
    process.env.WEDDING_COURT_ENABLED = "false";
    let paramsRead = false;
    const disabledContext = {
      get params() {
        paramsRead = true;
        return Promise.resolve({ caseId: CASE_ID });
      },
    };

    const response = await POST(
      request({
        round: 1,
        choice: "a",
        reason_chip: "guest_comfort",
        predicted_majority: "a",
      }),
      disabledContext,
    );

    expect(response.status).toBe(404);
    expect(paramsRead).toBe(false);
    expect(mocks.createClientFromRequest).not.toHaveBeenCalled();
    expect(mocks.checkRateLimit).not.toHaveBeenCalled();
    expect(mocks.checkCommunityWriteAccess).not.toHaveBeenCalled();
    expect(mocks.castWeddingCourtVote).not.toHaveBeenCalled();
  });

  it("ignores a body user_id and writes with the authenticated user", async () => {
    const response = await POST(
      request({
        user_id: BODY_USER_ID,
        round: 1,
        choice: "a",
        reason_chip: "guest_comfort",
        predicted_majority: "b",
      }),
      context(),
    );

    expect(response.status).toBe(200);
    expect(mocks.castWeddingCourtVote).toHaveBeenCalledWith(
      AUTH_USER_ID,
      CASE_ID,
      {
        round: 1,
        choice: "a",
        reasonChip: "guest_comfort",
        predictedMajority: "b",
      },
    );
    expect(
      JSON.stringify(mocks.castWeddingCourtVote.mock.calls),
    ).not.toContain(BODY_USER_ID);
  });

  it.each([
    [
      "unknown choice",
      {
        round: 1,
        choice: "team_bride",
        reason_chip: "guest_comfort",
        predicted_majority: "a",
      },
    ],
    [
      "free-text reason",
      {
        round: 1,
        choice: "a",
        reason_chip: "전화번호는 010-1234-5678",
        predicted_majority: "a",
      },
    ],
    [
      "missing prediction",
      {
        round: 1,
        choice: "a",
        reason_chip: "guest_comfort",
      },
    ],
    [
      "second-round prediction",
      {
        round: 2,
        choice: "b",
        reason_chip: "guest_comfort",
        predicted_majority: "a",
      },
    ],
  ])("rejects %s before any write", async (_label, body) => {
    const response = await POST(request(body), context());

    expect(response.status).toBe(400);
    expect(mocks.castWeddingCourtVote).not.toHaveBeenCalled();
  });

  it("rejects an oversized body before parsing or writing", async () => {
    const response = await POST(
      request({
        round: 1,
        choice: "a",
        reason_chip: "a".repeat(2_100),
        predicted_majority: "a",
      }),
      context(),
    );

    expect(response.status).toBe(413);
    expect(mocks.castWeddingCourtVote).not.toHaveBeenCalled();
  });

  it("requires authentication before reading the request body", async () => {
    mocks.createClientFromRequest.mockResolvedValue({
      auth: {
        getUser: vi.fn(async () => ({ data: { user: null } })),
      },
    });

    const response = await POST(
      request({
        round: 1,
        choice: "a",
        reason_chip: "guest_comfort",
        predicted_majority: "a",
      }),
      context(),
    );

    expect(response.status).toBe(401);
    expect(mocks.castWeddingCourtVote).not.toHaveBeenCalled();
  });
});
