import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  archiveCourtCaseForUser: vi.fn(),
  checkRateLimitPersistent: vi.fn(),
  createClientFromRequest: vi.fn(),
  deleteCourtCaseForUser: vi.fn(),
  getCourtCaseForUser: vi.fn(),
  rateLimitKey: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClientFromRequest: mocks.createClientFromRequest,
}));

vi.mock("@/lib/coupleCourt/repository", () => ({
  archiveCourtCaseForUser: mocks.archiveCourtCaseForUser,
  deleteCourtCaseForUser: mocks.deleteCourtCaseForUser,
  getCourtCaseForUser: mocks.getCourtCaseForUser,
}));

vi.mock("@/utils/rateLimit", () => ({
  checkRateLimitPersistent: mocks.checkRateLimitPersistent,
  rateLimitKey: mocks.rateLimitKey,
}));

import { requireCourtUser } from "../_shared";
import { DELETE } from "../cases/[caseId]/route";

const CASE_ID = "00000000-0000-4000-8000-000000000001";
const USER_ID = "00000000-0000-4000-8000-000000000002";
const context = { params: Promise.resolve({ caseId: CASE_ID }) };

function request(body: Record<string, unknown>): Request {
  return new Request(`https://hanbang.ai/api/couple-court/cases/${CASE_ID}`, {
    method: "DELETE",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://hanbang.ai",
      "Sec-Fetch-Site": "same-origin",
    },
    body: JSON.stringify(body),
  });
}

function authenticate(userId: string | null): void {
  mocks.createClientFromRequest.mockResolvedValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: userId ? { id: userId } : null },
      }),
    },
  });
}

describe("Couple Court case route", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("COUPLE_COURT_ENABLED", "true");
    authenticate(USER_ID);
    mocks.checkRateLimitPersistent.mockResolvedValue(null);
    mocks.rateLimitKey.mockReturnValue("couple-court:case:user");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("requires an authenticated user at the shared boundary", async () => {
    authenticate(null);

    await expect(requireCourtUser(request({ action: "archive" }))).rejects.toMatchObject({
      status: 401,
      code: "AUTH_REQUIRED",
    });
  });

  it("returns 401 before rate limiting or repository side effects", async () => {
    authenticate(null);

    const response = await DELETE(request({ action: "archive" }), context);

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ code: "AUTH_REQUIRED" });
    expect(mocks.checkRateLimitPersistent).not.toHaveBeenCalled();
    expect(mocks.archiveCourtCaseForUser).not.toHaveBeenCalled();
    expect(mocks.deleteCourtCaseForUser).not.toHaveBeenCalled();
  });

  it.each([
    ["missing", undefined],
    ["incorrect", "delete permanently"],
  ])("rejects a permanent delete with %s confirmation", async (_label, confirmation) => {
    const body: Record<string, unknown> = { action: "delete" };
    if (confirmation !== undefined) body.confirmation = confirmation;

    const response = await DELETE(request(body), context);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: "COURT_DELETE_CONFIRMATION_REQUIRED",
    });
    expect(mocks.checkRateLimitPersistent).not.toHaveBeenCalled();
    expect(mocks.archiveCourtCaseForUser).not.toHaveBeenCalled();
    expect(mocks.deleteCourtCaseForUser).not.toHaveBeenCalled();
  });

  it("permanently deletes only with the exact confirmation", async () => {
    const response = await DELETE(request({
      action: "delete",
      confirmation: "영구삭제",
    }), context);

    expect(response.status).toBe(204);
    expect(mocks.checkRateLimitPersistent).toHaveBeenCalledOnce();
    expect(mocks.deleteCourtCaseForUser).toHaveBeenCalledWith(CASE_ID, USER_ID);
    expect(mocks.archiveCourtCaseForUser).not.toHaveBeenCalled();
  });

  it("archives without invoking permanent deletion", async () => {
    const response = await DELETE(request({ action: "archive" }), context);

    expect(response.status).toBe(204);
    expect(mocks.checkRateLimitPersistent).toHaveBeenCalledOnce();
    expect(mocks.archiveCourtCaseForUser).toHaveBeenCalledWith(CASE_ID, USER_ID);
    expect(mocks.deleteCourtCaseForUser).not.toHaveBeenCalled();
  });
});
