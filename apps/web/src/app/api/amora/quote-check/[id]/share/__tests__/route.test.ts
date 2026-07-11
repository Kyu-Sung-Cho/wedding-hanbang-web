import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClientFromRequest } from "@/lib/supabase/server";
import { DELETE, POST } from "../route";

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClientFromRequest: vi.fn(),
}));

const QUOTE_ID = "12345678-1234-4234-9234-123456789abc";

function request(method: "POST" | "DELETE") {
  return new NextRequest(`http://localhost/api/amora/quote-check/${QUOTE_ID}/share`, {
    method,
  });
}

function context(id = QUOTE_ID) {
  return { params: Promise.resolve({ id }) };
}

function mockAuth(userId: string | null) {
  vi.mocked(createClientFromRequest).mockResolvedValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: userId ? { id: userId } : null },
      }),
    },
  } as unknown as Awaited<ReturnType<typeof createClientFromRequest>>);
}

function mockVisibilityUpdate(result: { data: unknown; error: unknown }) {
  const eqCalls: Array<[string, unknown]> = [];
  let updatePayload: Record<string, unknown> | null = null;
  const query = {
    update: vi.fn((payload: Record<string, unknown>) => {
      updatePayload = payload;
      return query;
    }),
    eq: vi.fn((column: string, value: unknown) => {
      eqCalls.push([column, value]);
      return query;
    }),
    select: vi.fn(() => query),
    maybeSingle: vi.fn().mockResolvedValue(result),
  };
  const admin = { from: vi.fn(() => query) };
  vi.mocked(createAdminClient).mockReturnValue(
    admin as unknown as ReturnType<typeof createAdminClient>
  );
  return {
    admin,
    eqCalls,
    getUpdatePayload: () => updatePayload,
  };
}

describe("/api/amora/quote-check/[id]/share", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth("user-1");
  });

  it("publishes only the authenticated owner's saved result", async () => {
    const db = mockVisibilityUpdate({
      data: { id: QUOTE_ID, is_public: true, published_at: "2026-07-11T12:00:00.000Z" },
      error: null,
    });

    const response = await POST(request("POST"), context());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.isPublic).toBe(true);
    expect(db.getUpdatePayload()).toMatchObject({ is_public: true });
    expect(db.getUpdatePayload()?.published_at).toEqual(expect.any(String));
    expect(db.eqCalls).toEqual([
      ["id", QUOTE_ID],
      ["user_id", "user-1"],
    ]);
    expect(db.admin.from).toHaveBeenCalledWith("amora_quote_checks");
    expect(response.headers.get("Cache-Control")).toContain("no-store");
  });

  it("revokes publication and clears its timestamp", async () => {
    const db = mockVisibilityUpdate({
      data: { id: QUOTE_ID, is_public: false, published_at: null },
      error: null,
    });

    const response = await DELETE(request("DELETE"), context());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.isPublic).toBe(false);
    expect(db.getUpdatePayload()).toEqual({ is_public: false, published_at: null });
  });

  it("does not reveal whether another user's result exists", async () => {
    mockVisibilityUpdate({ data: null, error: null });

    const response = await POST(request("POST"), context());
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error).toBe("저장된 결과를 찾을 수 없습니다.");
  });

  it("requires authentication before changing visibility", async () => {
    mockAuth(null);

    const response = await POST(request("POST"), context());

    expect(response.status).toBe(401);
    expect(createAdminClient).not.toHaveBeenCalled();
  });
});
