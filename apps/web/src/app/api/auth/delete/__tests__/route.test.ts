import { beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import { createClientFromRequest } from "@/lib/supabase/server";
import { checkRateLimit } from "@/utils/rateLimit";
import { DELETE } from "../route";

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClientFromRequest: vi.fn(),
}));

vi.mock("@/utils/rateLimit", () => ({
  checkRateLimit: vi.fn(() => null),
  rateLimitKey: vi.fn(() => "auth:delete:test"),
}));

const USER_ID = "123e4567-e89b-42d3-a456-426614174000";
const JOB_ID = "223e4567-e89b-42d3-a456-426614174000";

function request(body: unknown = { reason: "privacy" }, headers: Record<string, string> = {}) {
  return new NextRequest("http://localhost/api/auth/delete", {
    method: "DELETE",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

function mockClients(options: {
  user?: { id: string } | null;
  lifecycle?: string | null;
  jobStatus?: string;
  rpcError?: { message: string } | null;
} = {}) {
  const authClient = {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: options.user === undefined ? { id: USER_ID } : options.user },
      }),
    },
  };
  vi.mocked(createClientFromRequest).mockResolvedValue(
    authClient as unknown as Awaited<ReturnType<typeof createClientFromRequest>>,
  );

  const profileQuery = {
    select: vi.fn(() => profileQuery),
    eq: vi.fn(() => profileQuery),
    maybeSingle: vi.fn().mockResolvedValue({
      data: { account_deleting_at: options.lifecycle ?? null },
      error: null,
    }),
  };
  const admin = {
    from: vi.fn(() => profileQuery),
    rpc: vi.fn().mockResolvedValue({
      data: {
        job_id: JOB_ID,
        status: options.jobStatus ?? "pending",
      },
      error: options.rpcError ?? null,
    }),
    auth: { admin: { deleteUser: vi.fn() } },
  };
  vi.mocked(createClient).mockReturnValue(admin as unknown as ReturnType<typeof createClient>);
  return { admin };
}

describe("/api/auth/delete DELETE", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(checkRateLimit).mockReturnValue(null);
  });

  it("rejects an oversized body before auth or queue access", async () => {
    const response = await DELETE(request({}, { "content-length": "8193" }));

    expect(response.status).toBe(413);
    expect(createClientFromRequest).not.toHaveBeenCalled();
    expect(createClient).not.toHaveBeenCalled();
  });

  it("requires an authenticated user", async () => {
    mockClients({ user: null });

    const response = await DELETE(request());

    expect(response.status).toBe(401);
    expect(createClient).not.toHaveBeenCalled();
  });

  it("atomically enqueues and returns 202 without deleting auth in the request", async () => {
    const { admin } = mockClients();

    const response = await DELETE(request({ reason: "privacy" }));
    const body = await response.json();

    expect(response.status).toBe(202);
    expect(body).toMatchObject({ queued: true, status: "pending" });
    expect(response.headers.get("retry-after")).toBe("300");
    expect(admin.rpc).toHaveBeenCalledWith("request_account_deletion", {
      p_user_id: USER_ID,
      p_reason: "privacy",
    });
    expect(admin.auth.admin.deleteUser).not.toHaveBeenCalled();
  });

  it("does not silently restart an operator-owned dead letter", async () => {
    mockClients({ lifecycle: "2026-07-11T00:00:00.000Z", jobStatus: "dead_letter" });

    const response = await DELETE(request({ reason: "other" }));
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.status).toBe("dead_letter");
    expect(checkRateLimit).not.toHaveBeenCalled();
  });
});
