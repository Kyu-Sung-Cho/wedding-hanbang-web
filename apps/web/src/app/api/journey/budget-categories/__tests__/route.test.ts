import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClientFromRequest } from "@/lib/supabase/server";
import { POST } from "../route";

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClientFromRequest: vi.fn(),
}));

function createRequest(body: Record<string, unknown>) {
  return new Request("http://localhost/api/journey/budget-categories", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/journey/budget-categories", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createClientFromRequest).mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } } }),
      },
    } as unknown as Awaited<ReturnType<typeof createClientFromRequest>>);
  });

  it("stores distinct planned, contracted, paid, and next-payment facts for the authenticated couple", async () => {
    const authoritativeProgress = {
      venue: {
        category: "venue",
        status: "completed",
        checklist: [{ id: "venue_01", label: "계약서 확인", done: true }],
        budget: 15_000_000,
        contractedTotal: 12_500_000,
        paidToDate: 3_000_000,
        nextPaymentAmount: 2_000_000,
        nextPaymentDate: "2026-08-31",
        spent: 2_500_000,
        payer: "both_parents",
      },
      __events: [{ id: "evt_partner" }],
    };
    const rpc = vi.fn().mockResolvedValue({
      data: {
        progress: authoritativeProgress,
        categoryKey: "venue",
      },
      error: null,
    });
    const single = vi.fn().mockResolvedValue({
      data: { couple_id: "couple-1" },
      error: null,
    });
    vi.mocked(createAdminClient).mockReturnValue({
      from: vi.fn(() => ({ select: vi.fn(() => ({ eq: vi.fn(() => ({ single })) })) })),
      rpc,
    } as unknown as ReturnType<typeof createAdminClient>);

    const response = await POST(createRequest({
      categoryKey: "venue",
      set: {
        budget: 15_000_000,
        contractedTotal: 12_500_000,
        paidToDate: 3_000_000,
        nextPaymentAmount: 2_000_000,
        nextPaymentDate: "2026-08-31",
      },
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("mutate_journey_budget_category", {
      p_couple_id: "couple-1",
      p_category_key: "venue",
      p_set_fields: {
        budget: 15_000_000,
        contractedTotal: 12_500_000,
        paidToDate: 3_000_000,
        nextPaymentAmount: 2_000_000,
        nextPaymentDate: "2026-08-31",
      },
      p_remove_fields: [],
      p_visibility: null,
    });
    expect(body.progress).toEqual(authoritativeProgress);
  });

  it.each([
    ["reserved key", { categoryKey: "__events", set: { budget: 1 } }],
    ["prototype key", { categoryKey: "constructor", set: { budget: 1 } }],
    ["fractional amount", { categoryKey: "venue", set: { budget: 1.5 } }],
    ["fractional contracted total", { categoryKey: "venue", set: { contractedTotal: 1.5 } }],
    ["unsafe paid amount", { categoryKey: "venue", set: { paidToDate: Number.MAX_SAFE_INTEGER + 1 } }],
    ["negative amount", { categoryKey: "venue", set: { spent: -1 } }],
    ["oversized next payment", { categoryKey: "venue", set: { nextPaymentAmount: 10_000_000_001 } }],
    ["string amount", { categoryKey: "venue", set: { budget: "10000" } }],
    ["impossible payment date", { categoryKey: "venue", set: { nextPaymentDate: "2026-02-29" } }],
    ["non date-only payment date", { categoryKey: "venue", set: { nextPaymentDate: "2026-8-01" } }],
    ["paid above contracted total", { categoryKey: "venue", set: { contractedTotal: 10, paidToDate: 11 } }],
    ["legacy spent write", { categoryKey: "venue", set: { spent: 1 } }],
    ["legacy cost write", { categoryKey: "venue", set: { cost: 1 } }],
    ["legacy payer write", { categoryKey: "venue", set: { payer: "couple" } }],
    ["unknown payer", { categoryKey: "venue", set: { payer: "bride" } }],
    ["label on a fixed category", { categoryKey: "venue", set: { label: "예식장" } }],
    ["untrimmed label", { categoryKey: "custom_1", set: { label: "  기타 " } }],
    ["control character in label", { categoryKey: "custom_1", set: { label: "기타\n비용" } }],
    ["checklist overwrite", { categoryKey: "venue", set: { checklist: [] } }],
    ["status removal", { categoryKey: "venue", remove: ["status"] }],
    ["set/remove conflict", { categoryKey: "venue", set: { budget: 1 }, remove: ["budget"] }],
    ["empty mutation", { categoryKey: "venue" }],
  ])("rejects %s before calling the service mutation", async (_label, body) => {
    const response = await POST(createRequest(body));

    expect(response.status).toBe(400);
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("does not accept a client supplied couple id", async () => {
    const response = await POST(createRequest({
      coupleId: "other-couple",
      categoryKey: "venue",
      set: { budget: 1_000_000 },
    }));

    expect(response.status).toBe(400);
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("fails closed when the RPC does not confirm removals or visibility", async () => {
    const single = vi.fn().mockResolvedValue({
      data: { couple_id: "couple-1" },
      error: null,
    });
    vi.mocked(createAdminClient).mockReturnValue({
      from: vi.fn(() => ({ select: vi.fn(() => ({ eq: vi.fn(() => ({ single })) })) })),
      rpc: vi.fn().mockResolvedValue({
        data: {
          progress: {
            venue: { category: "venue", spent: 10_000, cost: 10_000 },
            __hidden: [],
          },
          categoryKey: "venue",
        },
        error: null,
      }),
    } as unknown as ReturnType<typeof createAdminClient>);

    const response = await POST(createRequest({
      categoryKey: "venue",
      remove: ["spent"],
      visibility: "hidden",
    }));

    expect(response.status).toBe(500);
  });

  it("allows explicit legacy cleanup without changing or reclassifying other money facts", async () => {
    const authoritativeProgress = {
      venue: {
        category: "venue",
        budget: 20_000_000,
        contractedTotal: 15_000_000,
        paidToDate: 5_000_000,
      },
    };
    const rpc = vi.fn().mockResolvedValue({
      data: { progress: authoritativeProgress, categoryKey: "venue" },
      error: null,
    });
    const single = vi.fn().mockResolvedValue({
      data: { couple_id: "couple-1" },
      error: null,
    });
    vi.mocked(createAdminClient).mockReturnValue({
      from: vi.fn(() => ({ select: vi.fn(() => ({ eq: vi.fn(() => ({ single })) })) })),
      rpc,
    } as unknown as ReturnType<typeof createAdminClient>);

    const response = await POST(createRequest({
      categoryKey: "venue",
      remove: ["spent", "cost", "payer"],
    }));

    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("mutate_journey_budget_category", {
      p_couple_id: "couple-1",
      p_category_key: "venue",
      p_set_fields: {},
      p_remove_fields: ["spent", "cost", "payer"],
      p_visibility: null,
    });
  });

  it("fails closed when the authoritative result violates paid-to-contracted semantics", async () => {
    const single = vi.fn().mockResolvedValue({
      data: { couple_id: "couple-1" },
      error: null,
    });
    vi.mocked(createAdminClient).mockReturnValue({
      from: vi.fn(() => ({ select: vi.fn(() => ({ eq: vi.fn(() => ({ single })) })) })),
      rpc: vi.fn().mockResolvedValue({
        data: {
          progress: {
            venue: {
              category: "venue",
              budget: 20_000_000,
              contractedTotal: 10_000_000,
              paidToDate: 11_000_000,
            },
          },
          categoryKey: "venue",
        },
        error: null,
      }),
    } as unknown as ReturnType<typeof createAdminClient>);

    const response = await POST(createRequest({
      categoryKey: "venue",
      set: { budget: 20_000_000 },
    }));

    expect(response.status).toBe(500);
  });

  it("fails closed when the authoritative result contains an unsafe planned budget", async () => {
    const single = vi.fn().mockResolvedValue({
      data: { couple_id: "couple-1" },
      error: null,
    });
    vi.mocked(createAdminClient).mockReturnValue({
      from: vi.fn(() => ({ select: vi.fn(() => ({ eq: vi.fn(() => ({ single })) })) })),
      rpc: vi.fn().mockResolvedValue({
        data: {
          progress: {
            venue: {
              category: "venue",
              budget: 1.5,
              contractedTotal: 10_000_000,
            },
          },
          categoryKey: "venue",
        },
        error: null,
      }),
    } as unknown as ReturnType<typeof createAdminClient>);

    const response = await POST(createRequest({
      categoryKey: "venue",
      set: { contractedTotal: 10_000_000 },
    }));

    expect(response.status).toBe(500);
  });

  it("requires authentication", async () => {
    vi.mocked(createClientFromRequest).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) },
    } as unknown as Awaited<ReturnType<typeof createClientFromRequest>>);

    const response = await POST(createRequest({
      categoryKey: "venue",
      set: { budget: 1_000_000 },
    }));

    expect(response.status).toBe(401);
    expect(createAdminClient).not.toHaveBeenCalled();
  });
});
