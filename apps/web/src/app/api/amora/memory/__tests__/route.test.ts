import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClientFromRequest } from "@/lib/supabase/server";
import { PATCH } from "../route";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClientFromRequest: vi.fn() }));
vi.mock("@/utils/rateLimit", () => ({
  checkRateLimit: vi.fn(() => null),
  rateLimitKey: vi.fn(() => "amora:memory:user"),
}));

const USER_ID = "00000000-0000-4000-8000-000000000001";
const COUPLE_ID = "10000000-0000-4000-8000-000000000001";
const MEMORY_ID = "20000000-0000-4000-8000-000000000001";

function query(result: { data: unknown; error: unknown }) {
  const chain = {
    select: () => chain,
    eq: () => chain,
    in: () => chain,
    is: () => chain,
    single: async () => result,
    maybeSingle: async () => result,
  };
  return chain;
}

describe("/api/amora/memory PATCH", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createClientFromRequest).mockResolvedValue({
      auth: {
        getUser: vi.fn(async () => ({ data: { user: { id: USER_ID } } })),
      },
      from: vi.fn((table: string) => {
        if (table === "profiles") {
          return query({ data: { couple_id: COUPLE_ID, role: "bride" }, error: null });
        }
        if (table === "couples") {
          return query({ data: { bride_id: USER_ID, groom_id: null }, error: null });
        }
        return query({
          data: {
            id: MEMORY_ID,
            visibility: "bride_private",
            memory_key: "venue:preferred_area",
            title: "선호 지역",
            metadata: { extracted_by: "amora" },
          },
          error: null,
        });
      }),
    } as unknown as Awaited<ReturnType<typeof createClientFromRequest>>);
  });

  it("rejects sensitive personal data before a manual memory edit reaches the database", async () => {
    const rpc = vi.fn(async () => ({ data: MEMORY_ID, error: null }));
    vi.mocked(createAdminClient).mockReturnValue({ rpc } as unknown as ReturnType<typeof createAdminClient>);
    const request = new Request("http://localhost/api/amora/memory", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "update_memory",
        visibility: "bride_private",
        memoryId: MEMORY_ID,
        title: "연락처",
        value: "010.1234.5678",
      }),
    });

    const response = await PATCH(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toContain("민감정보");
    expect(rpc).not.toHaveBeenCalled();
  });
});
