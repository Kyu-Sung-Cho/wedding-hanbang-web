import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  createClientFromRequest: vi.fn(),
  checkRateLimitPersistent: vi.fn(),
  adminFrom: vi.fn(),
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
  event_type: "vendor_card_click",
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
    mocks.adminFrom.mockReturnValue({ insert: mocks.insert });
    mocks.createAdminClient.mockReturnValue({
      from: mocks.adminFrom,
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
      event_type: "vendor_card_click",
      weight: 1,
      user_id: null,
      ingestion_trust: "client_untrusted",
      context: { category: "studio", zero_result: false },
    })]);
    expect(JSON.stringify(mocks.insert.mock.calls)).not.toContain("private@example.test");
    expect(mocks.checkRateLimitPersistent).toHaveBeenCalledWith(
      expect.stringMatching(/^events:vendor:/),
      { maxRequests: 60, windowMs: 60_000, cost: 1 },
    );
    expect(mocks.checkRateLimitPersistent).toHaveBeenCalledWith(
      expect.stringMatching(/^events:vendor:daily:/),
      { maxRequests: 1_000, windowMs: 86_400_000, cost: 1 },
    );
  });

  it.each([
    "vendor_detail_view",
    "addon_expand",
    "wishlist_add",
    "combo_add",
    "combo_save",
    "combo_share",
    "budget_search",
    "alert_subscribe",
    "quote_request",
  ])("rejects client-owned high-trust event %s before auth or service writes", async (eventType) => {
    const response = await POST(request({
      events: [{ ...EVENT, event_type: eventType }],
    }));

    expect(response.status).toBe(400);
    expect(mocks.createClientFromRequest).not.toHaveBeenCalled();
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it("atomically charges every event in a batch instead of only the HTTP request", async () => {
    const response = await POST(request({ events: [EVENT, EVENT, EVENT] }));
    expect(response.status).toBe(200);
    expect(mocks.checkRateLimitPersistent).toHaveBeenCalledWith(
      expect.any(String),
      { maxRequests: 60, windowMs: 60_000, cost: 3 },
    );
  });

  it("does not persist an authenticated identity in the client telemetry lane", async () => {
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
      user_id: null,
      ingestion_trust: "client_untrusted",
    })]);
    expect(JSON.stringify(mocks.insert.mock.calls)).not.toContain(
      "40000000-0000-4000-8000-000000000001",
    );
    expect(JSON.stringify(mocks.insert.mock.calls)).not.toContain(
      "50000000-0000-4000-8000-000000000001",
    );
  });

  it("uses one persistent trusted-network bucket even when anon ids rotate", async () => {
    const rotated = {
      ...EVENT,
      anon_id: "10000000-0000-4000-8000-000000000002",
    };

    expect((await POST(request({ events: [EVENT] }))).status).toBe(200);
    expect((await POST(request({ events: [rotated] }))).status).toBe(200);

    const vendorKeys = mocks.checkRateLimitPersistent.mock.calls
      .map((call) => call[0] as string)
      .filter((key) => key.startsWith("events:vendor:") && !key.startsWith("events:vendor:daily:"));
    const [firstKey, secondKey] = vendorKeys;
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
    expect(mocks.checkRateLimitPersistent).toHaveBeenCalledTimes(1);
    expect(mocks.checkRateLimitPersistent).toHaveBeenCalledWith(
      expect.stringMatching(/^events:ingress:/),
      { maxRequests: 120, windowMs: 60_000 },
    );
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it("blocks malformed ingress before buffering or auth work", async () => {
    mocks.checkRateLimitPersistent.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "limited" }), { status: 429 }),
    );
    const malformed = new Request("https://hanbang.ai/api/events", {
      method: "POST",
      headers: { "x-real-ip": "203.0.113.10" },
      body: "not-json",
    });

    const response = await POST(malformed);

    expect(response.status).toBe(429);
    expect(mocks.checkRateLimitPersistent).toHaveBeenCalledWith(
      expect.stringMatching(/^events:ingress:/),
      { maxRequests: 120, windowMs: 60_000 },
    );
    expect(mocks.createClientFromRequest).not.toHaveBeenCalled();
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
      { maxRequests: 60, windowMs: 60_000 },
    );
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it("rejects authenticated legacy decision events instead of trusting the session", async () => {
    mocks.createClientFromRequest.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: "40000000-0000-4000-8000-000000000001" } },
        }),
      },
    });

    const response = await POST(request({
      eventType: "booking_complete",
      vendorId: "30000000-0000-4000-8000-000000000001",
      sessionId: "20000000-0000-4000-8000-000000000001",
    }));

    expect(response.status).toBe(400);
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it("rejects unauthenticated legacy decision events before auth work", async () => {
    const response = await POST(request({
      eventType: "booking_complete",
      vendorId: "30000000-0000-4000-8000-000000000001",
      sessionId: "20000000-0000-4000-8000-000000000001",
    }));

    expect(response.status).toBe(400);
    expect(mocks.createClientFromRequest).not.toHaveBeenCalled();
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it("writes validated legacy events through the service client", async () => {
    const profileSingle = vi.fn().mockResolvedValue({
      data: { couple_id: "60000000-0000-4000-8000-000000000001" },
    });
    const profileEq = vi.fn(() => ({ single: profileSingle }));
    const profileSelect = vi.fn(() => ({ eq: profileEq }));
    const userFrom = vi.fn((table: string) => {
      if (table !== "profiles") throw new Error(`unexpected user table: ${table}`);
      return { select: profileSelect };
    });
    mocks.createClientFromRequest.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: "40000000-0000-4000-8000-000000000001" } },
        }),
      },
      from: userFrom,
    });

    const response = await POST(request({
      eventType: "vendor_view",
      vendorId: "30000000-0000-4000-8000-000000000001",
      sessionId: "20000000-0000-4000-8000-000000000001",
      durationSeconds: 12,
      metadata: {
        category: "studio",
        zero_result: false,
        email: "private@example.test",
      },
    }));

    expect(response.status).toBe(200);
    expect(userFrom).toHaveBeenCalledTimes(1);
    expect(userFrom).toHaveBeenCalledWith("profiles");
    expect(mocks.createAdminClient).toHaveBeenCalledTimes(1);
    expect(mocks.adminFrom).toHaveBeenCalledWith("customer_events");
    expect(mocks.insert).toHaveBeenCalledWith(expect.objectContaining({
      user_id: "40000000-0000-4000-8000-000000000001",
      couple_id: "60000000-0000-4000-8000-000000000001",
      event_type: "vendor_view",
      vendor_id: "30000000-0000-4000-8000-000000000001",
      duration_seconds: 12,
      session_id: "20000000-0000-4000-8000-000000000001",
      metadata: { category: "studio", zero_result: false },
    }));
    expect(mocks.checkRateLimitPersistent).toHaveBeenCalledWith(
      expect.stringMatching(/^events:legacy:daily:/),
      { maxRequests: 500, windowMs: 86_400_000 },
    );
    expect(JSON.stringify(mocks.insert.mock.calls)).not.toContain(
      "private@example.test",
    );
  });
});
