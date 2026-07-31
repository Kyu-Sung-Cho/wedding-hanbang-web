import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  verifyAdmin: vi.fn(),
  getServiceClient: vi.fn(),
}));

vi.mock("@/lib/utils/adminAuth", () => ({
  verifyAdmin: mocks.verifyAdmin,
  getServiceClient: mocks.getServiceClient,
}));

import { POST } from "./route";

const POST_ID = "00000000-0000-4000-8000-000000000001";
const ADMIN_ID = "00000000-0000-4000-8000-000000000002";

function request(body: unknown) {
  return new NextRequest(`https://hanbang.ai/api/admin/posts/${POST_ID}/moderate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function context(id = POST_ID) {
  return { params: Promise.resolve({ id }) };
}

describe("POST /api/admin/posts/:id/moderate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.verifyAdmin.mockResolvedValue({
      authorized: true,
      userId: ADMIN_ID,
    });
  });

  it("requires an authenticated admin identity", async () => {
    mocks.verifyAdmin.mockResolvedValue({ authorized: false });

    const response = await POST(request({ action: "hide", reason: "개인정보 노출" }), context());

    expect(response.status).toBe(401);
    expect(mocks.getServiceClient).not.toHaveBeenCalled();
  });

  it("rejects hard deletion and missing reasons before opening the service client", async () => {
    const hardDelete = await POST(
      request({ action: "delete", reason: "삭제" }),
      context()
    );
    const noReason = await POST(request({ action: "hide", reason: " " }), context());

    expect(hardDelete.status).toBe(400);
    expect(noReason.status).toBe(400);
    expect(mocks.getServiceClient).not.toHaveBeenCalled();
  });

  it("records a reversible action through the atomic service-only RPC", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: { ok: true, event_id: "event-id" },
      error: null,
    });
    mocks.getServiceClient.mockReturnValue({ rpc });

    const response = await POST(
      request({ action: "soft_delete", reason: "반복적인 개인정보 노출" }),
      context()
    );

    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("community_moderate_content", {
      p_target_type: "post",
      p_target_id: POST_ID,
      p_action: "soft_delete",
      p_reason: "반복적인 개인정보 노출",
      p_admin_id: ADMIN_ID,
    });
  });

  it("fails closed when the audited schema is unavailable", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: {
        code: "PGRST202",
        message: "Could not find community_moderate_content",
      },
    });
    mocks.getServiceClient.mockReturnValue({ rpc });

    const response = await POST(
      request({ action: "hide", reason: "검토 중 임시 보호" }),
      context()
    );
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.code).toBe("COMMUNITY_MODERATION_SCHEMA_UNAVAILABLE");
  });
});
