import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  checkRateLimitPersistent: vi.fn<() => Promise<Response | null>>(),
  rateLimitKey: vi.fn((prefix: string) => `${prefix}:test`),
  createClientFromRequest: vi.fn(),
  buildSourceBackedPriceComment: vi.fn(() => ({ summary: "verified" })),
  logAIInteraction: vi.fn(async () => undefined),
}));

vi.mock("@/utils/rateLimit", () => ({
  checkRateLimitPersistent: mocks.checkRateLimitPersistent,
  rateLimitKey: mocks.rateLimitKey,
}));
vi.mock("@/lib/supabase/server", () => ({
  createClientFromRequest: mocks.createClientFromRequest,
}));
vi.mock("@/lib/community/priceComment", () => ({
  buildSourceBackedPriceComment: mocks.buildSourceBackedPriceComment,
}));
vi.mock("@/lib/compliance/ai-log", () => ({
  logAIInteraction: mocks.logAIInteraction,
  startLatencyClock: vi.fn(() => 1),
  elapsedMs: vi.fn(() => 1),
}));

import { POST } from "./route";

function asRouteRequest(request: Request) {
  return request as Parameters<typeof POST>[0];
}

describe("POST /api/community/ai-price-comment ingress boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.checkRateLimitPersistent.mockResolvedValue(null);
    mocks.createClientFromRequest.mockResolvedValue({
      auth: { getUser: vi.fn(async () => ({ data: { user: { id: "user-1" } } })) },
    });
  });

  it("rejects a huge valid JSON body without Content-Length before shape validation", async () => {
    const request = new Request("http://localhost/api/community/ai-price-comment", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ priceData: { note: "x".repeat(30 * 1024) } }),
    });
    expect(request.headers.get("content-length")).toBeNull();

    const response = await POST(asRouteRequest(request));

    expect(response.status).toBe(413);
    expect(mocks.checkRateLimitPersistent).toHaveBeenCalledTimes(1);
    expect(mocks.createClientFromRequest).not.toHaveBeenCalled();
  });

  it("cancels a headerless chunked body as soon as the 24 KiB stream limit is exceeded", async () => {
    let pulls = 0;
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        if (pulls === 1) controller.enqueue(new Uint8Array(24 * 1024));
        else if (pulls === 2) controller.enqueue(new Uint8Array([1]));
        else controller.enqueue(new Uint8Array(512 * 1024));
      },
      cancel() {
        cancelled = true;
      },
    }, { highWaterMark: 0 });
    const request = {
      body,
      headers: new Headers(),
      method: "POST",
      url: "http://localhost/api/community/ai-price-comment",
    } as Request;

    const response = await POST(asRouteRequest(request));

    expect(response.status).toBe(413);
    expect(pulls).toBe(2);
    expect(cancelled).toBe(true);
    expect(mocks.checkRateLimitPersistent).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["invalid JSON", "{not-json"],
    ["missing base_price", JSON.stringify({ priceData: { vendor_category: "studio" } })],
  ])("charges every repeated %s attempt to the shared ingress bucket", async (_label, body) => {
    const responses = await Promise.all(Array.from({ length: 5 }, () => POST(asRouteRequest(
      new Request("http://localhost/api/community/ai-price-comment", { method: "POST", body }),
    ))));

    expect(responses.map((response) => response.status)).toEqual([400, 400, 400, 400, 400]);
    expect(mocks.checkRateLimitPersistent).toHaveBeenCalledTimes(5);
    expect(mocks.createClientFromRequest).not.toHaveBeenCalled();
  });

  it("fails closed before pulling the request body when the shared ingress bucket is unavailable", async () => {
    let pulls = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        controller.enqueue(new Uint8Array(1_024));
      },
    }, { highWaterMark: 0 });
    mocks.checkRateLimitPersistent.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "unavailable" }), { status: 503 }),
    );
    const request = {
      body,
      headers: new Headers(),
      method: "POST",
      url: "http://localhost/api/community/ai-price-comment",
    } as Request;

    const response = await POST(asRouteRequest(request));

    expect(response.status).toBe(503);
    expect(pulls).toBe(0);
    expect(mocks.createClientFromRequest).not.toHaveBeenCalled();
  });

  it("applies both ingress and authenticated subject buckets to a valid request", async () => {
    const response = await POST(asRouteRequest(new Request(
      "http://localhost/api/community/ai-price-comment",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ priceData: { vendor_category: "studio", base_price: 1_000_000 } }),
      },
    )));

    expect(response.status).toBe(200);
    expect(mocks.checkRateLimitPersistent).toHaveBeenCalledTimes(2);
    expect(mocks.rateLimitKey).toHaveBeenNthCalledWith(
      1,
      "community:ai-price-comment:ingress",
      expect.any(Request),
    );
    expect(mocks.rateLimitKey).toHaveBeenNthCalledWith(
      2,
      "community:ai-price-comment",
      expect.any(Request),
      "user-1",
    );
  });
});
