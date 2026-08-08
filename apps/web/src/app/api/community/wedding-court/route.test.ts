// @vitest-environment node

import { NextRequest } from "next/server";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const originalWeddingCourtFlag = process.env.WEDDING_COURT_ENABLED;

const mocks = vi.hoisted(() => ({
  createClientFromRequest: vi.fn(),
  loadWeddingCourtCasesForUser: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClientFromRequest: mocks.createClientFromRequest,
}));

vi.mock("@/lib/weddingCourt/repository", () => ({
  loadWeddingCourtCasesForUser: mocks.loadWeddingCourtCasesForUser,
  WeddingCourtRepositoryError: class WeddingCourtRepositoryError extends Error {
    constructor(public readonly code: string) {
      super(code);
    }
  },
}));

import { GET } from "./route";

describe("GET /api/community/wedding-court", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.WEDDING_COURT_ENABLED = "true";
  });

  afterAll(() => {
    if (originalWeddingCourtFlag === undefined) {
      delete process.env.WEDDING_COURT_ENABLED;
    } else {
      process.env.WEDDING_COURT_ENABLED = originalWeddingCourtFlag;
    }
  });

  it("returns not found before creating an auth or database client when disabled", async () => {
    process.env.WEDDING_COURT_ENABLED = "false";

    const response = await GET(
      new NextRequest("http://localhost/api/community/wedding-court"),
    );

    expect(response.status).toBe(404);
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(mocks.createClientFromRequest).not.toHaveBeenCalled();
    expect(mocks.loadWeddingCourtCasesForUser).not.toHaveBeenCalled();
  });

  it("does not read court data for an unauthenticated caller", async () => {
    mocks.createClientFromRequest.mockResolvedValue({
      auth: {
        getUser: vi.fn(async () => ({ data: { user: null } })),
      },
    });

    const response = await GET(
      new NextRequest("http://localhost/api/community/wedding-court"),
    );

    expect(response.status).toBe(401);
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(mocks.loadWeddingCourtCasesForUser).not.toHaveBeenCalled();
  });

  it("loads only the authenticated user's gated state", async () => {
    mocks.createClientFromRequest.mockResolvedValue({
      auth: {
        getUser: vi.fn(async () => ({
          data: {
            user: { id: "11111111-1111-4111-8111-111111111111" },
          },
        })),
      },
    });
    mocks.loadWeddingCourtCasesForUser.mockResolvedValue([
      { id: "case", stage: "first_vote" },
    ]);

    const response = await GET(
      new NextRequest("http://localhost/api/community/wedding-court"),
    );

    expect(response.status).toBe(200);
    expect(mocks.loadWeddingCourtCasesForUser).toHaveBeenCalledWith(
      "11111111-1111-4111-8111-111111111111",
    );
    await expect(response.json()).resolves.toEqual({
      cases: [{ id: "case", stage: "first_vote" }],
    });
  });
});
