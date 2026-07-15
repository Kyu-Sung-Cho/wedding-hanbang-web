import { createClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createClientFromRequest } from "@/lib/supabase/server";
import { DELETE } from "../route";

vi.mock("@supabase/supabase-js", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClientFromRequest: vi.fn() }));
vi.mock("@/utils/rateLimit", () => ({
  checkRateLimit: vi.fn(() => null),
  rateLimitKey: vi.fn(() => "auth:delete:test-user"),
}));

const USER_ID = "11111111-1111-4111-8111-111111111111";

function deletionRequest(reason = "not useful") {
  return new Request("http://localhost/api/auth/delete", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reason }),
  });
}

type TestError = { code: string; message: string };

function setup({
  authError = null,
  auditError = null,
}: {
  authError?: TestError | null;
  auditError?: TestError | null;
} = {}) {
  const sequence: string[] = [];
  const auditInsert = vi.fn(async (payload: unknown) => {
    void payload;
    sequence.push("audit");
    return { error: auditError };
  });
  const deleteUser = vi.fn(async () => {
    sequence.push("auth");
    return { error: authError };
  });
  const from = vi.fn((table: string) => {
    if (table !== "account_deletions") {
      throw new Error(`unexpected table access: ${table}`);
    }
    return { insert: auditInsert };
  });

  vi.mocked(createClientFromRequest).mockResolvedValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: USER_ID, email: "private@example.com" } },
      }),
    },
  } as never);
  vi.mocked(createClient).mockReturnValue({
    auth: { admin: { deleteUser } },
    from,
  } as never);

  return { sequence, auditInsert, deleteUser, from };
}

describe("/api/auth/delete DELETE", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role";
  });

  it("does not initialize an admin client for an unauthenticated request", async () => {
    vi.mocked(createClientFromRequest).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) },
    } as never);

    const response = await DELETE(deletionRequest());

    expect(response.status).toBe(401);
    expect(createClient).not.toHaveBeenCalled();
  });

  it("performs no public-table deletion before the Auth deletion boundary", async () => {
    const authError = { code: "database_error", message: "sensitive backend detail" };
    const { sequence, auditInsert, deleteUser, from } = setup({ authError });

    const response = await DELETE(deletionRequest());
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({ error: "계정 삭제에 실패했습니다." });
    expect(JSON.stringify(body)).not.toContain(authError.message);
    expect(deleteUser).toHaveBeenCalledWith(USER_ID);
    expect(sequence).toEqual(["auth"]);
    expect(from).not.toHaveBeenCalled();
    expect(auditInsert).not.toHaveBeenCalled();
  });

  it("records only an anonymous reason after Auth deletion succeeds", async () => {
    const { sequence, auditInsert } = setup();

    const response = await DELETE(deletionRequest("too expensive"));
    const payload = auditInsert.mock.calls[0]?.[0] as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(sequence).toEqual(["auth", "audit"]);
    expect(payload.reason).toBe("too expensive");
    expect(payload.deleted_at).toEqual(expect.any(String));
    expect(payload).not.toHaveProperty("user_id");
    expect(payload).not.toHaveProperty("email");
  });

  it("does not report a failed deletion when the anonymous audit insert fails", async () => {
    const { auditInsert } = setup({
      auditError: { code: "audit_unavailable", message: "temporary" },
    });

    const response = await DELETE(deletionRequest());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });
    expect(auditInsert).toHaveBeenCalledOnce();
  });
});
