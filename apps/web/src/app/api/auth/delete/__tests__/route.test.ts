import { beforeEach, describe, expect, it, vi } from "vitest";

import { requestAccountDeletion } from "@/lib/accountDeletion/communityStorageSaga";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClientFromRequest } from "@/lib/supabase/server";
import { checkRateLimitPersistent } from "@/utils/rateLimit";
import {
  HANBANG_EXPECTED_ACTOR_USER_ID_HEADER,
  HANBANG_MUTATION_CONTRACT_VERSION,
  HANBANG_MUTATION_CONTRACT_VERSION_HEADER,
} from "@hanbang/shared";
import { DELETE } from "../route";

vi.mock("@/lib/accountDeletion/communityStorageSaga", () => ({
  AccountDeletionStorageError: class AccountDeletionStorageError extends Error {
    code = "test_account_deletion_error";
  },
  requestAccountDeletion: vi.fn(),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClientFromRequest: vi.fn() }));
vi.mock("@/utils/trustedMutation", () => ({
  isTrustedMutationRequest: vi.fn(() => true),
}));
vi.mock("@/utils/rateLimit", () => ({
  checkRateLimitPersistent: vi.fn(async () => null),
  rateLimitKey: vi.fn(() => "auth:delete:test-user"),
}));

const USER_ID = "11111111-1111-4111-8111-111111111111";

function deletionRequest(reason = "unsatisfied", headers: HeadersInit = {}) {
  return new Request("http://localhost/api/auth/delete", {
    method: "DELETE",
    headers: {
      "Content-Type": "application/json",
      [HANBANG_MUTATION_CONTRACT_VERSION_HEADER]: HANBANG_MUTATION_CONTRACT_VERSION,
      [HANBANG_EXPECTED_ACTOR_USER_ID_HEADER]: USER_ID,
      ...headers,
    },
    body: JSON.stringify({ reason }),
  });
}

describe("/api/auth/delete DELETE", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ACCOUNT_DELETION_INTAKE_ENABLED = "true";
    process.env.ACCOUNT_DELETION_CRON_ENABLED = "false";
    vi.mocked(checkRateLimitPersistent).mockResolvedValue(null);
    vi.mocked(createClientFromRequest).mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: USER_ID, email: "private@example.com" } },
        }),
      },
    } as never);
    vi.mocked(createAdminClient).mockReturnValue({ admin: true } as never);
  });

  it("rejects a headerless legacy deletion before creating a job", async () => {
    const response = await DELETE(new Request("http://localhost/api/auth/delete", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: "unsatisfied" }),
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: "MUTATION_ACTOR_CONTRACT_INVALID",
    });
    expect(checkRateLimitPersistent).not.toHaveBeenCalled();
    expect(requestAccountDeletion).not.toHaveBeenCalled();
  });

  it("is a complete no-op unless deletion intake is explicitly enabled", async () => {
    for (const disabledValue of [undefined, "false", "TRUE"]) {
      vi.clearAllMocks();
      if (disabledValue === undefined) {
        delete process.env.ACCOUNT_DELETION_INTAKE_ENABLED;
      } else {
        process.env.ACCOUNT_DELETION_INTAKE_ENABLED = disabledValue;
      }

      const response = await DELETE(deletionRequest());

      expect(response.status).toBe(503);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect(await response.json()).toEqual(expect.objectContaining({
        code: "ACCOUNT_DELETION_INTAKE_DISABLED",
        supportEmail: "support@hanbang.ai",
        error: expect.stringContaining("support@hanbang.ai"),
      }));
      expect(createClientFromRequest).not.toHaveBeenCalled();
      expect(checkRateLimitPersistent).not.toHaveBeenCalled();
      expect(createAdminClient).not.toHaveBeenCalled();
      expect(requestAccountDeletion).not.toHaveBeenCalled();
    }
  });

  it("uses the shared fail-closed limiter before creating a deletion job", async () => {
    const limitedResponse = new Response(
      JSON.stringify({ error: "too many requests" }),
      { status: 429, headers: { "Content-Type": "application/json" } },
    );
    vi.mocked(checkRateLimitPersistent).mockResolvedValueOnce(limitedResponse as never);

    const response = await DELETE(deletionRequest());

    expect(response.status).toBe(429);
    expect(checkRateLimitPersistent).toHaveBeenCalledWith(
      "auth:delete:test-user",
      { maxRequests: 3, windowMs: 60 * 60 * 1000 },
    );
    expect(createAdminClient).not.toHaveBeenCalled();
    expect(requestAccountDeletion).not.toHaveBeenCalled();
  });

  it("rejects a deletion confirmed on another account's screen before creating a job", async () => {
    const response = await DELETE(deletionRequest("unsatisfied", {
      [HANBANG_MUTATION_CONTRACT_VERSION_HEADER]: HANBANG_MUTATION_CONTRACT_VERSION,
      [HANBANG_EXPECTED_ACTOR_USER_ID_HEADER]: "22222222-2222-4222-8222-222222222222",
    }));

    expect(response.status).toBe(409);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toMatchObject({
      code: "MUTATION_ACTOR_CHANGED",
    });
    expect(checkRateLimitPersistent).not.toHaveBeenCalled();
    expect(createAdminClient).not.toHaveBeenCalled();
    expect(requestAccountDeletion).not.toHaveBeenCalled();
  });

  it("does not initialize an admin client for an unauthenticated request", async () => {
    vi.mocked(createClientFromRequest).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) },
    } as never);

    const response = await DELETE(deletionRequest());

    expect(response.status).toBe(401);
    expect(createAdminClient).not.toHaveBeenCalled();
    expect(requestAccountDeletion).not.toHaveBeenCalled();
  });

  it("returns an honest pending response after creating the durable deletion job", async () => {
    vi.mocked(requestAccountDeletion).mockResolvedValue({ status: "pending" });

    const response = await DELETE(deletionRequest("unsatisfied"));
    const body = await response.json();

    expect(response.status).toBe(202);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(body).toEqual(expect.objectContaining({
      success: false,
      pending: true,
      code: "ACCOUNT_DELETION_PENDING",
    }));
    expect(requestAccountDeletion).toHaveBeenCalledWith(
      { admin: true },
      USER_ID,
      "unsatisfied",
      expect.any(Number),
      { processImmediately: false },
    );
  });

  it("does not persist free-text deletion feedback that may contain PII", async () => {
    vi.mocked(requestAccountDeletion).mockResolvedValue({ status: "pending" });

    const response = await DELETE(deletionRequest("call me at 010-1234-5678"));

    expect(response.status).toBe(202);
    expect(requestAccountDeletion).toHaveBeenCalledWith(
      { admin: true },
      USER_ID,
      "unknown",
      expect.any(Number),
      { processImmediately: false },
    );
  });

  it("reports completion only after the saga has crossed and finalized Auth deletion", async () => {
    vi.mocked(requestAccountDeletion).mockResolvedValue({ status: "completed" });

    const response = await DELETE(deletionRequest());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, pending: false });
  });

  it("stops at manual review for media without proven ownership", async () => {
    vi.mocked(requestAccountDeletion).mockResolvedValue({ status: "manual_review" });

    const response = await DELETE(deletionRequest());
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.code).toBe("ACCOUNT_DELETION_REVIEW_REQUIRED");
    expect(body.success).toBe(false);
  });

  it("does not expose backend details when durable job creation fails", async () => {
    vi.mocked(requestAccountDeletion).mockRejectedValue(
      new Error("private path and backend detail"),
    );

    const response = await DELETE(deletionRequest());
    const serialized = JSON.stringify(await response.json());

    expect(response.status).toBe(503);
    expect(serialized).not.toContain("private path");
  });
});
