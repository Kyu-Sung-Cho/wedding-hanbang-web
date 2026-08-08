import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClientFromRequest: vi.fn(),
  getUser: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClientFromRequest: mocks.createClientFromRequest,
}));

import { GET } from "./route";

const OWNER = "11111111-1111-4111-8111-111111111111";
const DELIVERY = "22222222-2222-4222-8222-222222222222";
const NOTIFICATION = "33333333-3333-4333-8333-333333333333";
const POST = "44444444-4444-4444-8444-444444444444";
const COMMENT = "55555555-5555-4555-8555-555555555555";

function request(query = `deliveryId=${DELIVERY}&notificationId=${NOTIFICATION}`) {
  return new Request(
    `http://localhost/api/community/notifications/push-target?${query}`,
    { headers: { authorization: "Bearer access-token" } },
  );
}

describe("/api/community/notifications/push-target", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getUser.mockResolvedValue({ data: { user: { id: OWNER } }, error: null });
    mocks.createClientFromRequest.mockResolvedValue({
      auth: { getUser: mocks.getUser },
      rpc: mocks.rpc,
    });
  });

  it("returns only an owner-revalidated allowlisted target", async () => {
    mocks.rpc.mockResolvedValue({
      data: {
        owner_id: OWNER,
        delivery_id: DELIVERY,
        notification_id: NOTIFICATION,
        kind: "comment_reply",
        post_id: POST,
        comment_id: COMMENT,
      },
      error: null,
    });

    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    await expect(response.json()).resolves.toEqual({
      deliveryId: DELIVERY,
      notificationId: NOTIFICATION,
      href: `/community/post/${POST}?commentId=${COMMENT}`,
    });
    expect(mocks.rpc).toHaveBeenCalledWith(
      "community_resolve_notification_push_target",
      { p_delivery_id: DELIVERY, p_notification_id: NOTIFICATION },
    );
  });

  it("fails closed for logged-out, blocked/read/content-unavailable, and malformed results", async () => {
    mocks.getUser.mockResolvedValueOnce({ data: { user: null }, error: null });
    expect((await GET(request())).status).toBe(401);

    mocks.rpc.mockResolvedValueOnce({ data: null, error: null });
    expect((await GET(request())).status).toBe(404);

    mocks.rpc.mockResolvedValueOnce({
      data: {
        owner_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        delivery_id: DELIVERY,
        notification_id: NOTIFICATION,
        kind: "post_reply",
        post_id: POST,
        comment_id: COMMENT,
      },
      error: null,
    });
    expect((await GET(request())).status).toBe(404);
  });

  it("rejects duplicate, external, or extra query data before authentication", async () => {
    for (const query of [
      `deliveryId=${DELIVERY}&deliveryId=${DELIVERY}&notificationId=${NOTIFICATION}`,
      `deliveryId=${DELIVERY}&notificationId=${NOTIFICATION}&next=https://evil.example`,
      `deliveryId=not-a-uuid&notificationId=${NOTIFICATION}`,
    ]) {
      expect((await GET(request(query))).status).toBe(400);
    }
    expect(mocks.createClientFromRequest).not.toHaveBeenCalled();
  });
});
