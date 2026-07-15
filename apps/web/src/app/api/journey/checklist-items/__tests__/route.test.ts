import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClientFromRequest } from "@/lib/supabase/server";
import { POST } from "../route";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClientFromRequest: vi.fn() }));

function request(body: Record<string, unknown>) {
  return new Request("http://localhost/api/journey/checklist-items", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/journey/checklist-items", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createClientFromRequest).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } } }) },
    } as unknown as Awaited<ReturnType<typeof createClientFromRequest>>);
  });

  it("sends only a server-owned checklist template to the atomic RPC", async () => {
    const progress = {
      venue: {
        category: "venue",
        status: "in_progress",
        budget: 20_000_000,
        checklist: [{ id: "venue_01", label: "예식 스타일 결정", done: true }],
      },
      __events: [{ id: "partner-event" }],
    };
    const rpc = vi.fn().mockResolvedValue({
      data: {
        conflict: false,
        progress,
        categoryKey: "venue",
        itemId: "venue_01",
        item: progress.venue.checklist[0],
      },
      error: null,
    });
    const single = vi.fn().mockResolvedValue({ data: { couple_id: "couple-1" }, error: null });
    vi.mocked(createAdminClient).mockReturnValue({
      from: vi.fn(() => ({ select: vi.fn(() => ({ eq: vi.fn(() => ({ single })) })) })),
      rpc,
    } as unknown as ReturnType<typeof createAdminClient>);

    const response = await POST(request({
      categoryKey: "venue",
      itemId: "venue_01",
      done: true,
      expectedDone: false,
    }));

    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("mutate_journey_checklist_item", expect.objectContaining({
      p_couple_id: "couple-1",
      p_category_key: "venue",
      p_item_id: "venue_01",
      p_done: true,
      p_expected_done: false,
      p_default_checklist: expect.any(Array),
    }));
    const rpcArgs = rpc.mock.calls[0][1];
    expect(rpcArgs.p_default_checklist).not.toBe(progress.venue.checklist);
  });

  it.each([
    { categoryKey: "__events", itemId: "venue_01", done: true, expectedDone: false },
    { categoryKey: "venue", itemId: "unknown", done: true, expectedDone: false },
    { categoryKey: "venue", itemId: "venue_01", done: "yes", expectedDone: false },
    { categoryKey: "venue", itemId: "venue_01", done: true, expectedDone: 0 },
    { categoryKey: "venue", itemId: "venue_01", done: false, expectedDone: false },
    { categoryKey: "venue", itemId: "venue_01", done: true, expectedDone: false, progress: {} },
    { coupleId: "other", categoryKey: "venue", itemId: "venue_01", done: true, expectedDone: false },
  ])("rejects non-canonical mutation input: %o", async (body) => {
    const response = await POST(request(body));
    expect(response.status).toBe(400);
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("returns authoritative progress with 409 when the expected item state is stale", async () => {
    const progress = {
      venue: {
        category: "venue",
        status: "in_progress",
        checklist: [{ id: "venue_01", label: "예식 스타일 결정", done: true }],
      },
    };
    const rpc = vi.fn().mockResolvedValue({
      data: {
        conflict: true,
        progress,
        categoryKey: "venue",
        itemId: "venue_01",
        item: progress.venue.checklist[0],
      },
      error: null,
    });
    const single = vi.fn().mockResolvedValue({ data: { couple_id: "couple-1" }, error: null });
    vi.mocked(createAdminClient).mockReturnValue({
      from: vi.fn(() => ({ select: vi.fn(() => ({ eq: vi.fn(() => ({ single })) })) })),
      rpc,
    } as unknown as ReturnType<typeof createAdminClient>);

    const response = await POST(request({
      categoryKey: "venue",
      itemId: "venue_01",
      done: true,
      expectedDone: false,
    }));

    expect(response.status).toBe(409);
    expect((await response.json()).progress).toEqual(progress);
  });

  it("fails closed when RPC output does not confirm the requested item", async () => {
    const single = vi.fn().mockResolvedValue({ data: { couple_id: "couple-1" }, error: null });
    vi.mocked(createAdminClient).mockReturnValue({
      from: vi.fn(() => ({ select: vi.fn(() => ({ eq: vi.fn(() => ({ single })) })) })),
      rpc: vi.fn().mockResolvedValue({
        data: {
          conflict: false,
          progress: { venue: { checklist: [] } },
          categoryKey: "venue",
          itemId: "venue_01",
          item: { id: "venue_01", label: "예식 스타일 결정", done: true },
        },
        error: null,
      }),
    } as unknown as ReturnType<typeof createAdminClient>);

    const response = await POST(request({
      categoryKey: "venue",
      itemId: "venue_01",
      done: true,
      expectedDone: false,
    }));
    expect(response.status).toBe(500);
  });
});
