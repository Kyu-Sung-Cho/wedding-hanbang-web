import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  createClientFromRequest: vi.fn(),
  checkRateLimitPersistent: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mocks.createAdminClient,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClientFromRequest: mocks.createClientFromRequest,
}));

vi.mock("@/utils/rateLimit", () => ({
  checkRateLimitPersistent: mocks.checkRateLimitPersistent,
  rateLimitKey: vi.fn(() => "amora:quote-check:publish:test-user"),
}));

import { DELETE, POST } from "./route";

const QUOTE_ID = "10000000-0000-4000-8000-000000000001";

function request(method: "POST" | "DELETE", sameOrigin = true) {
  return new Request(`https://hanbang.ai/api/amora/quote-check/${QUOTE_ID}/publish`, {
    method,
    headers: sameOrigin
      ? { "sec-fetch-site": "same-origin" }
      : { origin: "https://attacker.example", "sec-fetch-site": "cross-site" },
  });
}

function setActor(userId: string | null) {
  const getUser = vi.fn().mockResolvedValue({
    data: { user: userId ? { id: userId } : null },
  });
  mocks.createClientFromRequest.mockResolvedValue({ auth: { getUser } });
  return getUser;
}

function setMutationResult(
  data: { id: string; published_at: string | null } | null,
  error: unknown = null,
) {
  const maybeSingle = vi.fn().mockResolvedValue({ data, error });
  const select = vi.fn(() => ({ maybeSingle }));
  const eqUser = vi.fn(() => ({ select }));
  const eqId = vi.fn(() => ({ eq: eqUser }));
  const update = vi.fn(() => ({ eq: eqId }));
  const from = vi.fn(() => ({ update }));
  mocks.createAdminClient.mockReturnValue({ from });
  return { from, update, eqId, eqUser, select, maybeSingle };
}

describe("explicit quote publication consent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.checkRateLimitPersistent.mockResolvedValue(null);
  });

  it("rejects a cross-site publication request before authentication or service-role access", async () => {
    const response = await POST(request("POST", false), {
      params: Promise.resolve({ id: QUOTE_ID }),
    });

    expect(response.status).toBe(403);
    expect(mocks.createClientFromRequest).not.toHaveBeenCalled();
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it("requires an authenticated owner before service-role access", async () => {
    setActor(null);

    const response = await POST(request("POST"), {
      params: Promise.resolve({ id: QUOTE_ID }),
    });

    expect(response.status).toBe(401);
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
  });

  it("publishes only when both quote id and authenticated owner match", async () => {
    setActor("20000000-0000-4000-8000-000000000002");
    const query = setMutationResult({
      id: QUOTE_ID,
      published_at: "2026-08-02T00:00:00.000Z",
    });

    const response = await POST(request("POST"), {
      params: Promise.resolve({ id: QUOTE_ID }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(query.from).toHaveBeenCalledWith("amora_quote_checks");
    expect(query.update).toHaveBeenCalledWith({ published_at: expect.any(String) });
    expect(query.eqId).toHaveBeenCalledWith("id", QUOTE_ID);
    expect(query.eqUser).toHaveBeenCalledWith(
      "user_id",
      "20000000-0000-4000-8000-000000000002",
    );
    expect(query.select).toHaveBeenCalledWith("id, published_at");
    expect(body).toEqual({ id: QUOTE_ID, published: true, publicPath: `/quote/${QUOTE_ID}` });
  });

  it("does not reveal whether a quote belongs to another account", async () => {
    setActor("20000000-0000-4000-8000-000000000002");
    setMutationResult(null);

    const response = await POST(request("POST"), {
      params: Promise.resolve({ id: QUOTE_ID }),
    });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "결과를 찾을 수 없습니다." });
  });

  it("lets the owner revoke publication and returns no public path", async () => {
    setActor("20000000-0000-4000-8000-000000000002");
    const query = setMutationResult({ id: QUOTE_ID, published_at: null });

    const response = await DELETE(request("DELETE"), {
      params: Promise.resolve({ id: QUOTE_ID }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(query.update).toHaveBeenCalledWith({ published_at: null });
    expect(body).toEqual({ id: QUOTE_ID, published: false, publicPath: null });
  });
});
