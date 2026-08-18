import { beforeEach, describe, expect, it, vi } from "vitest";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClientFromRequest } from "@/lib/supabase/server";
import { DELETE, POST } from "./route";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClientFromRequest: vi.fn() }));
vi.mock("@/utils/rateLimit", () => ({
  checkRateLimit: vi.fn(() => null),
  rateLimitKey: vi.fn(() => "mediation-draft:test"),
}));

const USER_ID = "11111111-1111-4111-8111-111111111111";
const COUPLE_ID = "22222222-2222-4222-8222-222222222222";
const DRAFT_ID = "33333333-3333-4333-8333-333333333333";
const SHARED_ID = "44444444-4444-4444-8444-444444444444";

function query(result: { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq"]) chain[method] = vi.fn(() => chain);
  chain.single = vi.fn(async () => result);
  return chain;
}

function request(method: "POST" | "DELETE", body: unknown, origin = "http://localhost") {
  return new Request("http://localhost/api/amora/mediation/draft", {
    method,
    headers: {
      "Content-Type": "application/json",
      Origin: origin,
      "Sec-Fetch-Site": origin === "http://localhost" ? "same-origin" : "cross-site",
    },
    body: JSON.stringify(body),
  });
}

function authenticatedClient() {
  return {
    auth: { getUser: vi.fn(async () => ({ data: { user: { id: USER_ID } } })) },
    from: vi.fn(() => query({ data: { couple_id: COUPLE_ID }, error: null })),
  } as unknown as Awaited<ReturnType<typeof createClientFromRequest>>;
}

describe("/api/amora/mediation/draft", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shares only the authenticated user's exact draft and accepts atomically", async () => {
    vi.mocked(createClientFromRequest).mockResolvedValue(authenticatedClient());
    const rpc = vi.fn(async () => ({
      data: {
        shared_message_id: SHARED_ID,
        reused: false,
        acceptance: { accepted_count: 1 },
      },
      error: null,
    }));
    vi.mocked(createAdminClient).mockReturnValue({ rpc } as never);

    const response = await POST(request("POST", { messageId: DRAFT_ID }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      sharedMessageId: SHARED_ID,
      reused: false,
    });
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(rpc).toHaveBeenCalledWith("share_amora_mediation_draft", {
      p_draft_message_id: DRAFT_ID,
      p_user_id: USER_ID,
      p_accept: true,
    });
  });

  it("discards only the authenticated user's unsent draft", async () => {
    vi.mocked(createClientFromRequest).mockResolvedValue(authenticatedClient());
    const rpc = vi.fn(async () => ({ data: true, error: null }));
    vi.mocked(createAdminClient).mockReturnValue({ rpc } as never);

    const response = await DELETE(request("DELETE", { messageId: DRAFT_ID }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ discarded: true });
    expect(rpc).toHaveBeenCalledWith("discard_amora_mediation_draft", {
      p_draft_message_id: DRAFT_ID,
      p_user_id: USER_ID,
    });
  });

  it("rejects cross-site mutation before authentication", async () => {
    const response = await POST(request("POST", { messageId: DRAFT_ID }, "https://evil.example"));
    expect(response.status).toBe(403);
    expect(createClientFromRequest).not.toHaveBeenCalled();
  });

  it("fails a roster-changed draft closed without exposing database text", async () => {
    vi.mocked(createClientFromRequest).mockResolvedValue(authenticatedClient());
    vi.mocked(createAdminClient).mockReturnValue({
      rpc: vi.fn(async () => ({
        data: null,
        error: { code: "55000", message: "AMORA_MEDIATION_DRAFT_ROSTER_CHANGED private" },
      })),
    } as never);

    const response = await POST(request("POST", { messageId: DRAFT_ID }));

    expect(response.status).toBe(409);
    const payload = await response.json();
    expect(payload).toEqual({ error: "함께 준비하는 구성이 바뀌어 이 초안은 보낼 수 없어요." });
    expect(JSON.stringify(payload)).not.toContain("private");
  });

  it("rejects extra caller authority and malformed service receipts", async () => {
    vi.mocked(createClientFromRequest).mockResolvedValue(authenticatedClient());
    const rpc = vi.fn(async () => ({ data: { shared_message_id: "wrong", reused: false }, error: null }));
    vi.mocked(createAdminClient).mockReturnValue({ rpc } as never);

    const extra = await POST(request("POST", { messageId: DRAFT_ID, coupleId: COUPLE_ID }));
    expect(extra.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();

    const malformed = await POST(request("POST", { messageId: DRAFT_ID }));
    expect(malformed.status).toBe(503);
    await expect(malformed.json()).resolves.toEqual({ error: "초안을 함께 보내지 못했어요." });
  });
});
