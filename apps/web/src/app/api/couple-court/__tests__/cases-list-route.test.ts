import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClientFromRequest: vi.fn(),
  createCourtCaseForUser: vi.fn(),
  listCourtCasesForUser: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClientFromRequest: mocks.createClientFromRequest,
}));

vi.mock("@/lib/coupleCourt/repository", () => ({
  createCourtCaseForUser: mocks.createCourtCaseForUser,
  listCourtCasesForUser: mocks.listCourtCasesForUser,
}));

import { encodeCourtCursor } from "../_shared";
import { GET } from "../cases/route";

const USER_ID = "00000000-0000-4000-8000-000000000001";
const CASE_ID = "00000000-0000-4000-8000-000000000002";
const CURSOR = {
  at: "2026-07-14T01:02:03.123456+00:00",
  id: "00000000-0000-4000-8000-000000000003",
};

describe("GET /api/couple-court/cases", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("COUPLE_COURT_ENABLED", "true");
    mocks.createClientFromRequest.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: USER_ID } } }),
      },
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses the service-side keyset page and exposes only an opaque next cursor", async () => {
    const courtCase = { id: CASE_ID, workflow_status: "statement_collecting" };
    mocks.listCourtCasesForUser.mockResolvedValue({
      items: [courtCase],
      nextCursor: CURSOR,
    });
    const encoded = encodeCourtCursor("cases", CURSOR);
    const response = await GET(new Request(
      `https://hanbang.ai/api/couple-court/cases?cursor=${encoded}`,
    ));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      cases: [courtCase],
      nextCursor: encoded,
    });
    expect(mocks.listCourtCasesForUser).toHaveBeenCalledWith(USER_ID, 20, CURSOR);
  });

  it("rejects an invalid cursor before the repository boundary", async () => {
    const response = await GET(new Request(
      "https://hanbang.ai/api/couple-court/cases?cursor=invalid",
    ));

    expect(response.status).toBe(400);
    expect(mocks.listCourtCasesForUser).not.toHaveBeenCalled();
  });
});
