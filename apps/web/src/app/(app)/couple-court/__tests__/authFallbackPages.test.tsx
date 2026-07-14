import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  redirect: vi.fn((destination: string): never => {
    throw new Error(`NEXT_REDIRECT:${destination}`);
  }),
}));

vi.mock("next/navigation", () => ({
  redirect: mocks.redirect,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: mocks.getUser },
  })),
}));

import CoupleCourtNewPage from "../new/page";
import CoupleCourtStatementPage from "../cases/[caseId]/statement/page";

describe("couple court unauthenticated fallback redirects", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });
  });

  it("returns from login to the allowlisted wedding new-case route", async () => {
    await expect(CoupleCourtNewPage()).rejects.toThrow("NEXT_REDIRECT");

    expect(mocks.redirect).toHaveBeenCalledWith(
      "/login?next=%2Fwedding%2Fcouple-court%2Fnew",
    );
  });

  it("preserves revision mode in the allowlisted wedding statement return", async () => {
    const caseId = "123e4567-e89b-42d3-a456-426614174000";

    await expect(CoupleCourtStatementPage({
      params: Promise.resolve({ caseId }),
      searchParams: Promise.resolve({ revision: "1" }),
    })).rejects.toThrow("NEXT_REDIRECT");

    expect(mocks.redirect).toHaveBeenCalledWith(
      `/login?next=${encodeURIComponent(`/wedding/couple-court/cases/${caseId}/statement?revision=1`)}`,
    );
  });
});
