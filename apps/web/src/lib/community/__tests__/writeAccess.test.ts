import { describe, expect, it, vi } from "vitest";
import { checkCommunityWriteAccess } from "@/lib/community/writeAccess";

function client(result: {
  data: { profile_exists: boolean; is_suspended: boolean } | null;
  error: { message: string } | null;
}) {
  return {
    rpc: vi.fn(async () => result),
  };
}

describe("checkCommunityWriteAccess", () => {
  it("allows a member without a community profile yet", async () => {
    const mock = client({
      data: { profile_exists: false, is_suspended: false },
      error: null,
    });

    await expect(
      checkCommunityWriteAccess(mock as never, "member-1"),
    ).resolves.toEqual({ allowed: true });
  });

  it("blocks a suspended member with a stable code", async () => {
    const mock = client({
      data: { profile_exists: true, is_suspended: true },
      error: null,
    });

    await expect(
      checkCommunityWriteAccess(mock as never, "member-1"),
    ).resolves.toMatchObject({
      allowed: false,
      status: 403,
      code: "COMMUNITY_SUSPENDED",
    });
  });

  it("fails closed when suspension cannot be checked", async () => {
    const mock = client({ data: null, error: { message: "unavailable" } });

    await expect(
      checkCommunityWriteAccess(mock as never, "member-1"),
    ).resolves.toMatchObject({
      allowed: false,
      status: 503,
      code: "COMMUNITY_WRITE_ACCESS_UNAVAILABLE",
    });
  });

  it("fails closed when the narrow RPC returns a malformed payload", async () => {
    const mock = client({ data: null, error: null });

    await expect(
      checkCommunityWriteAccess(mock as never, "member-1"),
    ).resolves.toMatchObject({
      allowed: false,
      status: 503,
      code: "COMMUNITY_WRITE_ACCESS_UNAVAILABLE",
    });
  });
});
