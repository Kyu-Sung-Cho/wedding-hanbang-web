import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { createClientFromRequest } from "@/lib/supabase/server";
import {
  claimChatRequest,
  completeChatRequest,
  failChatRequest,
} from "@/lib/ai/chatRequestClaim";
import { buildDueMomentCells } from "@/lib/amora/momentLoop";
import { GET, POST } from "../route";

const rateLimitMocks = vi.hoisted(() => ({
  check: vi.fn(),
  key: vi.fn((_prefix: string, _request: Request, userId?: string) => `chat:proactive:${userId}`),
}));

vi.mock("@supabase/supabase-js", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClientFromRequest: vi.fn() }));
vi.mock("@/lib/ai/chatRequestClaim", () => ({
  claimChatRequest: vi.fn(),
  completeChatRequest: vi.fn(),
  failChatRequest: vi.fn(),
}));
vi.mock("@/lib/amora/momentLoop", () => ({
  buildDueMomentCells: vi.fn(() => [{
    momentType: "wedding_day",
    momentLabel: "본식",
    cellKind: "d1",
    momentDate: "2026-07-17",
    dedupeKey: "wedding_day:d1:2026-07-17",
    message: "내일 일정을 확인해봐요.",
    memoryKeys: [],
    priority: 100,
  }]),
}));
vi.mock("@/lib/amora/lifecycle", () => ({
  buildAmoraLifecyclePlan: vi.fn(() => ({
    stage: "planning",
    stageLabel: "준비 단계",
    stageSummary: "확인할 일이 있어요.",
    riskLevel: "attention",
    riskScore: 70,
    guardrails: [{ cta: "확인하기" }],
    primaryAction: {
      id: "budget-check",
      title: "예산을 확인해봐요",
      body: "빠진 항목이 없는지 같이 볼게요.",
      href: "/budget",
      severity: "warning",
    },
  })),
}));
vi.mock("@/utils/rateLimit", () => ({
  checkRateLimitPersistent: rateLimitMocks.check,
  rateLimitKey: rateLimitMocks.key,
}));

function request() {
  return new NextRequest("http://localhost/api/chat/proactive", {
    method: "POST",
    headers: {
      origin: "http://localhost",
      "sec-fetch-site": "same-origin",
    },
  });
}

describe("/api/chat/proactive outbound-care safety fence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rateLimitMocks.check.mockResolvedValue(null);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://abcdefghijklmnopqrst.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", `sb_secret_${"a".repeat(40)}`);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("never mutates or reads user data through GET", async () => {
    vi.stubEnv("AMORA_CARE_OUTBOUND_ENABLED", "true");

    const response = await GET();

    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST");
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(createClientFromRequest).not.toHaveBeenCalled();
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("rejects a cross-site POST before authentication or service-role construction", async () => {
    vi.stubEnv("AMORA_CARE_OUTBOUND_ENABLED", "true");
    const crossSiteRequest = new NextRequest("http://localhost/api/chat/proactive", {
      method: "POST",
      headers: {
        origin: "https://attacker.example",
        "sec-fetch-site": "cross-site",
      },
    });

    const response = await POST(crossSiteRequest);

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      triggered: false,
      reason: "invalid_origin",
    });
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(createClientFromRequest).not.toHaveBeenCalled();
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("fails closed when a POST has neither Origin nor Sec-Fetch-Site proof", async () => {
    vi.stubEnv("AMORA_CARE_OUTBOUND_ENABLED", "true");

    const response = await POST(new NextRequest(
      "http://localhost/api/chat/proactive",
      { method: "POST" },
    ));

    expect(response.status).toBe(403);
    expect(createClientFromRequest).not.toHaveBeenCalled();
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("fails closed on the persistent per-user limit before service-role data reads", async () => {
    vi.stubEnv("AMORA_CARE_OUTBOUND_ENABLED", "true");
    vi.mocked(createClientFromRequest).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "member-1" } } }) },
    } as never);
    rateLimitMocks.check.mockResolvedValueOnce(NextResponse.json(
      { error: "rate_limit_unavailable" },
      { status: 503, headers: { "Retry-After": "60" } },
    ));

    const response = await POST(request());

    expect(response.status).toBe(503);
    expect(rateLimitMocks.check).toHaveBeenCalledWith(
      "chat:proactive:member-1",
      { maxRequests: 6, windowMs: 10 * 60 * 1000 },
      { failClosed: true },
    );
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("reads no user data and creates no service client while the kill switch is off", async () => {
    vi.stubEnv("AMORA_CARE_OUTBOUND_ENABLED", "false");

    const response = await POST(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      triggered: false,
      reason: "outbound_disabled",
    });
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("vary")).toContain("Origin");
    expect(createClientFromRequest).not.toHaveBeenCalled();
    expect(createAdminClient).not.toHaveBeenCalled();
    expect(rateLimitMocks.check).not.toHaveBeenCalled();
  });

  it("writes no shared moment when the atomic RPC reports non-unanimous consent", async () => {
    vi.stubEnv("AMORA_CARE_OUTBOUND_ENABLED", "true");
    vi.mocked(createClientFromRequest).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "member-1" } } }) },
    } as never);

    const directInsert = vi.fn();
    const from = vi.fn((table: string) => {
      const builder = {
        select: vi.fn(() => builder),
        eq: vi.fn(() => builder),
        in: vi.fn(() => builder),
        insert: directInsert,
        single: vi.fn(async () => {
          if (table === "profiles") return { data: { couple_id: "couple-1", name: "Member" }, error: null };
          if (table === "wedding_journeys") {
            return { data: { wedding_date: "2026-07-17", progress: {} }, error: null };
          }
          return { data: null, error: null };
        }),
        then(resolve: (value: unknown) => void) {
          resolve({ data: [], error: null });
        },
      };
      return builder;
    });
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null });
    vi.mocked(createAdminClient).mockReturnValue({ from, rpc } as never);

    const response = await POST(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      triggered: false,
      reason: "consent_required",
    });
    expect(rpc).toHaveBeenCalledWith("insert_amora_care_message", expect.objectContaining({
      p_couple_id: "couple-1",
    }));
    expect(directInsert).not.toHaveBeenCalled();
    expect(completeChatRequest).not.toHaveBeenCalled();
  });

  it("never completes a lifecycle claim when the consent-fenced RPC persisted no message", async () => {
    vi.stubEnv("AMORA_CARE_OUTBOUND_ENABLED", "true");
    vi.mocked(buildDueMomentCells).mockReturnValueOnce([]);
    vi.mocked(createClientFromRequest).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "member-1" } } }) },
    } as never);
    vi.mocked(claimChatRequest).mockResolvedValue({ action: "acquired" } as never);
    vi.mocked(failChatRequest).mockResolvedValue(undefined as never);

    const directInsert = vi.fn();
    const from = vi.fn((table: string) => {
      const builder = {
        select: vi.fn(() => builder),
        eq: vi.fn(() => builder),
        order: vi.fn(() => builder),
        limit: vi.fn(() => builder),
        insert: directInsert,
        single: vi.fn(async () => {
          if (table === "profiles") return { data: { couple_id: "couple-1", name: "Member" }, error: null };
          if (table === "wedding_journeys") {
            return {
              data: { wedding_date: "2026-10-01", venue: null, total_budget: 50_000_000, progress: {} },
              error: null,
            };
          }
          return { data: null, error: null };
        }),
        then(resolve: (value: unknown) => void) {
          resolve({ data: [], error: null });
        },
      };
      return builder;
    });
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null });
    vi.mocked(createAdminClient).mockReturnValue({ from, rpc } as never);

    const response = await POST(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      triggered: false,
      reason: "consent_required",
    });
    expect(failChatRequest).toHaveBeenCalledWith(expect.objectContaining({
      failureCode: "CONSENT_REQUIRED",
    }), expect.anything());
    expect(completeChatRequest).not.toHaveBeenCalled();
    expect(directInsert).not.toHaveBeenCalled();
  });

  it("completes a duplicate lifecycle claim only after loading the real persisted message", async () => {
    vi.stubEnv("AMORA_CARE_OUTBOUND_ENABLED", "true");
    vi.mocked(buildDueMomentCells).mockReturnValueOnce([]);
    vi.mocked(createClientFromRequest).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "member-1" } } }) },
    } as never);
    vi.mocked(claimChatRequest).mockResolvedValue({ action: "acquired" } as never);
    vi.mocked(completeChatRequest).mockResolvedValue(undefined as never);

    const from = vi.fn((table: string) => {
      const builder = {
        select: vi.fn(() => builder),
        eq: vi.fn(() => builder),
        order: vi.fn(() => builder),
        limit: vi.fn(() => builder),
        single: vi.fn(async () => {
          if (table === "profiles") return { data: { couple_id: "couple-1", name: "Member" }, error: null };
          if (table === "wedding_journeys") {
            return {
              data: { wedding_date: "2026-10-01", venue: null, total_budget: 50_000_000, progress: {} },
              error: null,
            };
          }
          return { data: null, error: null };
        }),
        maybeSingle: vi.fn(async () => ({ data: { id: "persisted-message-1" }, error: null })),
        then(resolve: (value: unknown) => void) {
          resolve({ data: [], error: null });
        },
      };
      return builder;
    });
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { code: "23505", message: "duplicate key" },
    });
    vi.mocked(createAdminClient).mockReturnValue({ from, rpc } as never);

    const response = await POST(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      triggered: true,
      kind: "lifecycle",
      messageId: "persisted-message-1",
    });
    expect(completeChatRequest).toHaveBeenCalledWith(expect.objectContaining({
      messageId: "persisted-message-1",
    }), expect.anything());
  });
});
