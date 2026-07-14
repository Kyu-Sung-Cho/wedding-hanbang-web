import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClientFromRequest: vi.fn(),
  createServiceClient: vi.fn(),
  profileSingle: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClientFromRequest: mocks.createClientFromRequest,
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: mocks.createServiceClient,
}));

import { verifyAdmin } from "@/lib/utils/adminAuth";

describe("verifyAdmin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createClientFromRequest.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: "admin-1" } } }),
      },
    });
    mocks.createServiceClient.mockReturnValue({
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({ single: mocks.profileSingle })),
        })),
      })),
    });
  });

  it("authorizes only an active administrator", async () => {
    mocks.profileSingle.mockResolvedValue({
      data: { is_admin: true, account_deleting_at: null },
      error: null,
    });

    await expect(verifyAdmin(new Request("http://localhost/api/admin"))).resolves.toEqual({
      authorized: true,
      userId: "admin-1",
    });
  });

  it("revokes authorization as soon as account deletion starts", async () => {
    mocks.profileSingle.mockResolvedValue({
      data: { is_admin: true, account_deleting_at: "2026-07-14T00:00:00.000Z" },
      error: null,
    });

    await expect(verifyAdmin(new Request("http://localhost/api/admin"))).resolves.toEqual({
      authorized: false,
    });
  });

  it("fails closed for a missing or unreadable profile", async () => {
    mocks.profileSingle.mockResolvedValue({ data: null, error: { message: "unavailable" } });

    await expect(verifyAdmin(new Request("http://localhost/api/admin"))).resolves.toEqual({
      authorized: false,
    });
  });
});
