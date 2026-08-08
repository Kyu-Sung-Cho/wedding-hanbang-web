import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const USER_ID = "10000000-0000-4000-8000-000000000001";
const POST_ID = "20000000-0000-4000-8000-000000000001";

const mocks = vi.hoisted(() => ({
  trusted: vi.fn(() => true),
  createClientFromRequest: vi.fn(),
  createAdminClient: vi.fn(),
  checkCommunityWriteAccess: vi.fn(async () => ({ allowed: true as const })),
  checkRateLimitPersistent: vi.fn(async () => null),
}));

vi.mock("@/utils/trustedMutation", () => ({
  isTrustedMutationRequest: mocks.trusted,
}));
vi.mock("@/lib/supabase/server", () => ({
  createClientFromRequest: mocks.createClientFromRequest,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mocks.createAdminClient,
}));
vi.mock("@/lib/community/writeAccess", () => ({
  checkCommunityWriteAccess: mocks.checkCommunityWriteAccess,
}));
vi.mock("@/utils/rateLimit", () => ({
  checkRateLimitPersistent: mocks.checkRateLimitPersistent,
  rateLimitKey: vi.fn(() => "bookmark-key"),
}));

import { POST } from "./route";

function request(body: BodyInit) {
  return new NextRequest(`https://hanbang.ai/api/community/posts/${POST_ID}/bookmark`, {
    method: "POST",
    headers: {
      origin: "https://hanbang.ai",
      "sec-fetch-site": "same-origin",
      "content-type": "application/json",
    },
    body,
    ...(body instanceof ReadableStream ? { duplex: "half" as const } : {}),
  } as ConstructorParameters<typeof NextRequest>[1] & { duplex?: "half" });
}

describe("POST /api/community/posts/[id]/bookmark", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.trusted.mockReturnValue(true);
    mocks.createClientFromRequest.mockResolvedValue({
      auth: {
        getUser: vi.fn(async () => ({ data: { user: { id: USER_ID } } })),
      },
    });
    mocks.createAdminClient.mockReturnValue({
      rpc: vi.fn(async () => ({
        data: { bookmarked: true, bookmark_count: 4 },
        error: null,
      })),
    });
  });

  it("persists explicit bookmark intent through the atomic RPC", async () => {
    const service = mocks.createAdminClient();
    mocks.createAdminClient.mockReturnValue(service);

    const response = await POST(request(JSON.stringify({ bookmarked: true })), {
      params: Promise.resolve({ id: POST_ID }),
    });

    expect(response.status).toBe(200);
    expect(service.rpc).toHaveBeenCalledWith("community_set_post_bookmark", {
      p_user_id: USER_ID,
      p_post_id: POST_ID,
      p_bookmarked: true,
    });
    await expect(response.json()).resolves.toEqual({
      bookmarked: true,
      bookmark_count: 4,
    });
  });

  it("allows removal while suspended without calling the add-write gate", async () => {
    const service = {
      rpc: vi.fn(async () => ({
        data: { bookmarked: false, bookmark_count: 3 },
        error: null,
      })),
    };
    mocks.createAdminClient.mockReturnValue(service);

    const response = await POST(request(JSON.stringify({ bookmarked: false })), {
      params: Promise.resolve({ id: POST_ID }),
    });

    expect(response.status).toBe(200);
    expect(mocks.checkCommunityWriteAccess).not.toHaveBeenCalled();
    expect(service.rpc).toHaveBeenCalledWith(
      "community_set_post_bookmark",
      expect.objectContaining({ p_bookmarked: false }),
    );
  });

  it("rejects malformed or toggle-style empty bodies before the RPC", async () => {
    const service = { rpc: vi.fn() };
    mocks.createAdminClient.mockReturnValue(service);

    for (const body of ["{", "{}", JSON.stringify({ bookmarked: 1 })]) {
      const response = await POST(request(body), {
        params: Promise.resolve({ id: POST_ID }),
      });
      expect(response.status).toBe(400);
    }
    expect(service.rpc).not.toHaveBeenCalled();
  });

  it("enforces the stream byte limit without content-length", async () => {
    const service = { rpc: vi.fn() };
    mocks.createAdminClient.mockReturnValue(service);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("x".repeat(513)));
        controller.close();
      },
    });
    const oversized = request(stream);
    expect(oversized.headers.get("content-length")).toBeNull();

    const response = await POST(oversized, {
      params: Promise.resolve({ id: POST_ID }),
    });

    expect(response.status).toBe(413);
    expect(service.rpc).not.toHaveBeenCalled();
  });
});
