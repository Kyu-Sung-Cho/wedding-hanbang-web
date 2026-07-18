import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  createClientFromRequest: vi.fn(),
  checkRateLimitPersistent: vi.fn(),
  insert: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mocks.createAdminClient,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClientFromRequest: mocks.createClientFromRequest,
}));

vi.mock("@/utils/rateLimit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/utils/rateLimit")>();
  return {
    ...actual,
    checkRateLimitPersistent: mocks.checkRateLimitPersistent,
  };
});

import { POST } from "./route";

const EVENT = {
  anon_id: "10000000-0000-4000-8000-000000000001",
  session_id: "20000000-0000-4000-8000-000000000001",
  event_type: "wishlist_add",
  vendor_id: "30000000-0000-4000-8000-000000000001",
  surface: "price_list",
  weight: 999,
  context: {
    category: "studio",
    zero_result: false,
    email: "private@example.test",
  },
};

function request(body: unknown) {
  return new Request("https://hanbang.ai/api/events", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-real-ip": "203.0.113.10",
    },
    body: JSON.stringify(body),
  });
}

describe("POST /api/events", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.checkRateLimitPersistent.mockResolvedValue(null);
    mocks.insert.mockResolvedValue({ error: null });
    mocks.createAdminClient.mockReturnValue({
      from: vi.fn(() => ({ insert: mocks.insert })),
    });
    mocks.createClientFromRequest.mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) },
    });
  });

  it("accepts anonymous batches and overwrites client weight", async () => {
    const response = await POST(request({ events: [EVENT] }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ accepted: 1 });
    expect(mocks.insert).toHaveBeenCalledWith([expect.objectContaining({
      event_type: "wishlist_add",
      weight: 5,
      user_id: null,
      context: { category: "studio", zero_result: false },
    })]);
    expect(JSON.stringify(mocks.insert.mock.calls)).not.toContain("private@example.test");
    expect(mocks.checkRateLimitPersistent).toHaveBeenCalledWith(
      expect.stringMatching(/^events:vendor:/),
      { maxRequests: 60, windowMs: 60_000, cost: 1 },
    );
  });

  it("atomically charges every event in a batch instead of only the HTTP request", async () => {
    const response = await POST(request({ events: [EVENT, EVENT, EVENT] }));
    expect(response.status).toBe(200);
    expect(mocks.checkRateLimitPersistent).toHaveBeenCalledWith(
      expect.any(String),
      { maxRequests: 60, windowMs: 60_000, cost: 3 },
    );
  });

  it("injects the authenticated user instead of accepting one from the body", async () => {
    mocks.createClientFromRequest.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: "40000000-0000-4000-8000-000000000001" } },
        }),
      },
    });
    const response = await POST(request({
      events: [{ ...EVENT, user_id: "50000000-0000-4000-8000-000000000001" }],
    }));
    expect(response.status).toBe(200);
    expect(mocks.insert).toHaveBeenCalledWith([expect.objectContaining({
      user_id: "40000000-0000-4000-8000-000000000001",
    })]);
  });

  it("uses one persistent trusted-network bucket even when anon ids rotate", async () => {
    const rotated = {
      ...EVENT,
      anon_id: "10000000-0000-4000-8000-000000000002",
    };

    expect((await POST(request({ events: [EVENT] }))).status).toBe(200);
    expect((await POST(request({ events: [rotated] }))).status).toBe(200);

    const firstKey = mocks.checkRateLimitPersistent.mock.calls[0]?.[0];
    const secondKey = mocks.checkRateLimitPersistent.mock.calls[1]?.[0];
    expect(firstKey).toBe(secondKey);
    expect(firstKey).toMatch(/^events:vendor:(?:hmac-)?sha256:/);
    expect(firstKey).not.toContain(EVENT.anon_id);
    expect(firstKey).not.toContain(rotated.anon_id);
  });

  it("rejects mixed anonymous identities or sessions before auth and writes", async () => {
    const response = await POST(request({
      events: [
        EVENT,
        {
          ...EVENT,
          anon_id: "10000000-0000-4000-8000-000000000002",
        },
      ],
    }));

    expect(response.status).toBe(400);
    expect(mocks.createClientFromRequest).not.toHaveBeenCalled();
    expect(mocks.checkRateLimitPersistent).not.toHaveBeenCalled();
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it("fails closed when the shared limiter is unavailable or rejects the request", async () => {
    mocks.checkRateLimitPersistent.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "rate limit unavailable" }), { status: 503 }),
    );

    const response = await POST(request({ events: [EVENT] }));
    expect(response.status).toBe(503);
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it("rejects batches above 50 before constructing a service client", async () => {
    const response = await POST(request({
      events: Array.from({ length: 51 }, () => EVENT),
    }));
    expect(response.status).toBe(400);
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it("enforces the body limit without trusting Content-Length", async () => {
    const oversized = request({ padding: "x".repeat(64 * 1024) });
    expect(oversized.headers.has("content-length")).toBe(false);

    const response = await POST(oversized);
    expect(response.status).toBe(413);
    expect(mocks.createClientFromRequest).not.toHaveBeenCalled();
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it("rejects a free-form legacy session identifier as a possible PII channel", async () => {
    mocks.createClientFromRequest.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: "40000000-0000-4000-8000-000000000001" } },
        }),
      },
    });

    const response = await POST(request({
      eventType: "vendor_view",
      sessionId: "person@example.test",
    }));

    expect(response.status).toBe(400);
    expect(mocks.checkRateLimitPersistent).toHaveBeenCalledWith(
      expect.stringMatching(/^events:legacy:/),
      { maxRequests: 120, windowMs: 60_000 },
    );
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });
});
