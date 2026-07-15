import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClientFromRequest } from "@/lib/supabase/server";
import { DELETE, POST } from "../route";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClientFromRequest: vi.fn() }));

const QUOTE_ID = "12345678-1234-4234-9234-123456789abc";
const request = (method: "POST" | "DELETE") =>
  new NextRequest(`http://localhost/api/amora/quote-check/${QUOTE_ID}/share`, { method });
const context = (id = QUOTE_ID) => ({ params: Promise.resolve({ id }) });

function mockAuth(userId: string | null) {
  vi.mocked(createClientFromRequest).mockResolvedValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: userId ? { id: userId } : null },
      }),
    },
  } as unknown as Awaited<ReturnType<typeof createClientFromRequest>>);
}

function mockRevocation() {
  const updates: Record<string, unknown>[] = [];
  const query = {
    update: vi.fn((payload: Record<string, unknown>) => {
      updates.push(payload);
      return query;
    }),
    eq: vi.fn(() => query),
    select: vi.fn(() => query),
    maybeSingle: vi.fn().mockResolvedValue({
      data: { id: QUOTE_ID, is_public: false, published_at: null },
      error: null,
    }),
  };
  vi.mocked(createAdminClient).mockReturnValue({
    from: vi.fn(() => query),
  } as unknown as ReturnType<typeof createAdminClient>);
  return updates;
}

describe("/api/amora/quote-check/[id]/share retirement contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not publish new links and checks no auth or database first", async () => {
    const response = await POST(request("POST"), context());
    const body = await response.json();

    expect(response.status).toBe(410);
    expect(body).toEqual({
      error: "견적 체크 결과의 신규 공유는 현재 제공하지 않습니다.",
      code: "quote_check_sharing_retired",
    });
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(createClientFromRequest).not.toHaveBeenCalled();
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("still lets the authenticated owner revoke a legacy public link", async () => {
    mockAuth("user-1");
    const updates = mockRevocation();

    const response = await DELETE(request("DELETE"), context());
    expect(response.status).toBe(200);
    expect(updates).toEqual([{ is_public: false, published_at: null }]);
  });

  it("requires authentication before revoking a legacy public link", async () => {
    mockAuth(null);
    const response = await DELETE(request("DELETE"), context());
    expect(response.status).toBe(401);
    expect(createAdminClient).not.toHaveBeenCalled();
  });
});
