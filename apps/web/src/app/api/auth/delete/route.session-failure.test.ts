// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthApiError, AuthRetryableFetchError, AuthSessionMissingError, AuthUnknownError } from "@supabase/supabase-js";

const mocks = vi.hoisted(() => ({ getUser: vi.fn(), admin: vi.fn(), requestDeletion: vi.fn(), limit: vi.fn(), proof: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClientFromRequest: async () => ({ auth: { getUser: mocks.getUser } }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.admin }));
vi.mock("@/lib/accountDeletion/communityStorageSaga", () => ({ AccountDeletionStorageError: class extends Error { code = "synthetic"; }, requestAccountDeletion: mocks.requestDeletion }));
vi.mock("@/lib/accountDeletion/supportProof", () => ({ issueDeletionSupportProof: mocks.proof }));
vi.mock("@/lib/supabase/destinationFence", () => ({ verifyRuntimeSupabaseServiceDestination: () => ({ projectRef: "synthetic" }) }));
vi.mock("@/utils/rateLimit", () => ({ checkRateLimitPersistent: mocks.limit, rateLimitKey: () => "synthetic" }));
import { DELETE } from "./route";
import { POST } from "./support-proof/route";

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("ACCOUNT_DELETION_INTAKE_ENABLED", "true");
  vi.stubEnv("ACCOUNT_DELETION_CRON_ENABLED", "false");
});
afterEach(() => vi.unstubAllEnvs());

describe.each([
  { name: "deletion intake", method: "DELETE", path: "/api/auth/delete", handler: DELETE, body: { reason: "privacy" } },
  { name: "support identity proof", method: "POST", path: "/api/auth/delete/support-proof", handler: POST, body: { intent: "support-identity-only" } },
])("$name authentication failure", ({ method, path, handler, body }) => {
  function request() {
    return new Request(`https://hanbang.ai${path}`, { method, headers: { "content-type": "application/json", origin: "https://hanbang.ai" }, body: JSON.stringify(body) });
  }

  it.each([
    new AuthRetryableFetchError("private transport diagnostic", 503),
    new AuthApiError("private database diagnostic", 500, "unexpected_failure"),
    new AuthApiError("private rate-limit diagnostic", 429, "over_request_rate_limit"),
    new AuthUnknownError("private SDK diagnostic", new Error("private original error")),
  ])("returns 503 for $name $status before any deletion or signing work", async error => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error });
    const response = await handler(request());
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(await response.text()).not.toContain("private");
    expect(mocks.admin).not.toHaveBeenCalled();
    expect(mocks.requestDeletion).not.toHaveBeenCalled();
    expect(mocks.proof).not.toHaveBeenCalled();
    expect(mocks.limit).not.toHaveBeenCalled();
  });

  it.each([null, new AuthSessionMissingError(), new AuthApiError("expired session", 403, "bad_jwt")])("keeps absent and expired credentials at 401: %s", async error => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error });
    expect((await handler(request())).status).toBe(401);
    expect(mocks.requestDeletion).not.toHaveBeenCalled();
    expect(mocks.proof).not.toHaveBeenCalled();
  });
});
