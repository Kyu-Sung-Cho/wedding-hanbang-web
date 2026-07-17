import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ToolExecutionContext } from "../toolTypes";
import { patchJourneyProgress } from "../progressTools";

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(),
}));

describe("progressTools write fence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("RPC가 임의 오류를 반환하면 오래된 전체 progress로 대체하지 않고 실패한다", async () => {
    const rpcError = { code: "XX000", message: "transient database failure" };
    const update = vi.fn(() => ({
      eq: vi.fn().mockResolvedValue({ error: null }),
    }));
    const from = vi.fn(() => ({ update }));
    vi.mocked(createAdminClient).mockReturnValue({
      rpc: vi.fn().mockResolvedValue({ data: null, error: rpcError }),
      from,
    } as unknown as ReturnType<typeof createAdminClient>);
    const ctx = {
      coupleId: "00000000-0000-4000-8000-000000000001",
      weddingContext: {
        weddingDate: null,
        budget: 30_000_000,
        venue: null,
        progress: {
          venue: { category: "venue", status: "in_progress", budget: 20_000_000 },
        },
      },
    } as ToolExecutionContext;

    await expect(
      patchJourneyProgress(ctx, { __events: [{ id: "new-event" }] }),
    ).rejects.toEqual(rpcError);
    expect(from).not.toHaveBeenCalled();
    expect(ctx.weddingContext.progress).toEqual({
      venue: { category: "venue", status: "in_progress", budget: 20_000_000 },
    });
  });
});
