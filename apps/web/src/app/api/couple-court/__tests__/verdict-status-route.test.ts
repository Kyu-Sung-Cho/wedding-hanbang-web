import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClientFromRequest: vi.fn(),
  getCourtVerdictStatusForUser: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClientFromRequest: mocks.createClientFromRequest,
}));

vi.mock("@/lib/coupleCourt/repository", () => ({
  getCourtVerdictStatusForUser: mocks.getCourtVerdictStatusForUser,
}));

import { GET } from "../cases/[caseId]/verdict/status/route";

const CASE_ID = "00000000-0000-4000-8000-000000000001";
const USER_ID = "00000000-0000-4000-8000-000000000002";
const context = { params: Promise.resolve({ caseId: CASE_ID }) };

function request() {
  return new Request(`https://hanbang.ai/api/couple-court/cases/${CASE_ID}/verdict/status`);
}

describe("GET /api/couple-court/cases/[caseId]/verdict/status", () => {
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

  it("returns only the pending state and bounded retry metadata", async () => {
    mocks.getCourtVerdictStatusForUser.mockResolvedValue({
      status: "judging",
      retryAfterSeconds: 17,
      recoveryAllowed: false,
    });

    const response = await GET(request(), context);

    expect(response.status).toBe(202);
    expect(response.headers.get("Retry-After")).toBe("17");
    await expect(response.json()).resolves.toEqual({
      status: "judging",
      retry_after_seconds: 17,
      recovery_allowed: false,
    });
    expect(mocks.getCourtVerdictStatusForUser).toHaveBeenCalledWith(CASE_ID, USER_ID);
  });

  it.each(["ready", "not_ready", "safety_redirect"] as const)(
    "returns the %s projection without verdict or case content",
    async (status) => {
      mocks.getCourtVerdictStatusForUser.mockResolvedValue({ status });

      const response = await GET(request(), context);

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ status });
    },
  );

  it("authenticates before reading status", async () => {
    mocks.createClientFromRequest.mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) },
    });

    const response = await GET(request(), context);

    expect(response.status).toBe(401);
    expect(mocks.getCourtVerdictStatusForUser).not.toHaveBeenCalled();
  });
});
