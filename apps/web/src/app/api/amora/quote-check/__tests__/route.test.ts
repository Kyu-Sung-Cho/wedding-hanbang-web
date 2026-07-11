import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClientFromRequest } from "@/lib/supabase/server";
import { POST } from "../route";

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClientFromRequest: vi.fn(),
}));

vi.mock("@/utils/rateLimit", () => ({
  checkRateLimitPersistent: vi.fn().mockResolvedValue(null),
  rateLimitKey: vi.fn(() => "amora:quote-check:test"),
}));

function quoteRequest(extra: Record<string, unknown> = {}) {
  return new NextRequest("http://localhost/api/amora/quote-check", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      category: "studio",
      region: "seoul",
      quotePriceManwon: 300,
      includedItemIds: [],
      vendorName: "테스트 스튜디오",
      memo: "원본 추가금 확인",
      ...extra,
    }),
  });
}

function mockAuth(userId: string | null) {
  const profileQuery = {
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue({ data: { couple_id: "couple-1" }, error: null }),
  };
  profileQuery.select.mockReturnValue(profileQuery);
  profileQuery.eq.mockReturnValue(profileQuery);

  const authClient = {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: userId ? { id: userId } : null },
      }),
    },
    from: vi.fn(() => profileQuery),
  };

  vi.mocked(createClientFromRequest).mockResolvedValue(
    authClient as unknown as Awaited<ReturnType<typeof createClientFromRequest>>
  );
  return authClient;
}

describe("/api/amora/quote-check POST privacy contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not persist an authenticated user's result without explicit opt-in", async () => {
    const authClient = mockAuth("user-1");

    const response = await POST(quoteRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.savedId).toBeNull();
    expect(body.saveStatus).toBe("not_requested");
    expect(authClient.from).not.toHaveBeenCalled();
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("stores an opted-in result as private and never creates a vendor lead", async () => {
    mockAuth("user-1");
    let inserted: Record<string, unknown> | null = null;

    const insertQuery = {
      insert: vi.fn((payload: Record<string, unknown>) => {
        inserted = payload;
        return insertQuery;
      }),
      select: vi.fn(() => insertQuery),
      maybeSingle: vi.fn().mockResolvedValue({
        data: { id: "12345678-1234-4234-9234-123456789abc" },
        error: null,
      }),
    };
    const admin = {
      from: vi.fn((table: string) => {
        if (table !== "amora_quote_checks") {
          throw new Error(`Unexpected table access: ${table}`);
        }
        return insertQuery;
      }),
    };
    vi.mocked(createAdminClient).mockReturnValue(
      admin as unknown as ReturnType<typeof createAdminClient>
    );

    const response = await POST(quoteRequest({ saveToAccount: true }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.saveStatus).toBe("saved");
    expect(body.savedId).toBe("12345678-1234-4234-9234-123456789abc");
    expect(inserted).toMatchObject({
      user_id: "user-1",
      couple_id: "couple-1",
      vendor_name: "테스트 스튜디오",
      memo: "원본 추가금 확인",
      is_public: false,
      published_at: null,
    });
    expect(admin.from).toHaveBeenCalledTimes(1);
    expect(admin.from).not.toHaveBeenCalledWith("vendor_leads");
  });

  it("does not persist when an anonymous user requests account storage", async () => {
    mockAuth(null);

    const response = await POST(quoteRequest({ saveToAccount: true }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.savedId).toBeNull();
    expect(body.saveStatus).toBe("authentication_required");
    expect(createAdminClient).not.toHaveBeenCalled();
  });
});
