import { describe, expect, it, vi } from "vitest";
import { checkCommunityWriteAccess } from "@/lib/community/writeAccess";

function client(result: {
  data: { is_suspended: boolean } | null;
  error: { message: string } | null;
}) {
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle: vi.fn(async () => result),
  };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  return {
    from: vi.fn(() => query),
    query,
  };
}

describe("checkCommunityWriteAccess", () => {
  it("allows a member without a community profile yet", async () => {
    const mock = client({ data: null, error: null });

    await expect(
      checkCommunityWriteAccess(mock as never, "member-1"),
    ).resolves.toEqual({ allowed: true });
  });

  it("blocks a suspended member with a stable code", async () => {
    const mock = client({ data: { is_suspended: true }, error: null });

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
});
