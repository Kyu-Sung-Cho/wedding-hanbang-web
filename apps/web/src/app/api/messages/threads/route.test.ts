// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const USER = "11111111-1111-4111-8111-111111111111";
const VENDOR = "22222222-2222-4222-8222-222222222222";
const MESSAGE = { id: "message", vendor_id: VENDOR, customer_id: USER, sender_type: "vendor", content: "private message", is_read: false, created_at: "2026-09-28T00:00:00Z" };
const mocks = vi.hoisted(() => ({ getUser: vi.fn(), read: vi.fn(), vendorRead: vi.fn(), owner: vi.fn() }));
function query(read: () => unknown) {
  const builder = { select: () => builder, eq: () => builder, in: () => builder, order: () => builder,
    then: (resolve: (value: unknown) => unknown) => Promise.resolve(read()).then(resolve) };
  return builder;
}
vi.mock("@/lib/supabase/server", () => ({ createClientFromRequest: async () => ({ auth: { getUser: mocks.getUser }, from: () => query(mocks.read) }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: () => query(mocks.vendorRead) }) }));
vi.mock("@/lib/vendors/serverOwnership", () => ({ loadOwnedVendorWithServiceRole: mocks.owner }));

import { GET } from "./route";
const request = () => new NextRequest("https://hanbang.ai/api/messages/threads");

beforeEach(() => {
  vi.resetAllMocks();
  mocks.getUser.mockResolvedValue({ data: { user: { id: USER } }, error: null });
  mocks.owner.mockResolvedValue(null);
  mocks.read.mockReturnValue({ data: [MESSAGE], error: null });
  mocks.vendorRead.mockReturnValue({ data: [{ id: VENDOR, name: "업체" }], error: null });
});

describe("message threads preserve failed versus empty reads", () => {
  it.each(["customer", "vendor"])("reports %s inbox read errors instead of an empty success", async role => {
    if (role === "vendor") mocks.owner.mockResolvedValue({ id: VENDOR, name: "업체" });
    mocks.read.mockReturnValue({ data: null, error: { code: "08006", message: "private database diagnostic" } });
    const response = await GET(request());
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("private database diagnostic");
    expect(response.headers.get("cache-control")).toContain("private, no-store");
  });

  it("reports vendor label query failure without inventing a successful partial inbox", async () => {
    mocks.vendorRead.mockReturnValue({ data: null, error: { message: "private lookup error" } });
    expect((await GET(request())).status).toBe(503);
  });

  it.each(["customer", "vendor"])("keeps genuinely empty %s inboxes successful", async role => {
    if (role === "vendor") mocks.owner.mockResolvedValue({ id: VENDOR, name: "업체" });
    mocks.read.mockReturnValue({ data: [], error: null });
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ threads: [], isVendor: role === "vendor" });
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("keeps the authenticated viewer's messages and unread count", async () => {
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect((await response.json()).threads).toEqual([expect.objectContaining({ vendorId: VENDOR, customerId: USER, lastMessage: "private message", unreadCount: 1 })]);
  });

  it("still rejects anonymous requests", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });
    const response = await GET(request());
    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(mocks.read).not.toHaveBeenCalled();
  });
});
