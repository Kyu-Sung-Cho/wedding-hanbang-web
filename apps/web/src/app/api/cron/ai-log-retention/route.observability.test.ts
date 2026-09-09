// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const mocks = vi.hoisted(() => ({ admin: vi.fn(), error: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.admin }));
vi.mock("@/utils/log", () => ({ log: { error: mocks.error } }));
import { GET } from "./route";

const eventSchema = z.object({
  event: z.literal("ai_log_retention_run"),
  version: z.literal(1),
  runId: z.string().uuid(),
  occurredAt: z.string().datetime(),
  deploymentId: z.string().nullable(),
  commit: z.string().nullable(),
  enabled: z.boolean(),
  status: z.enum(["started", "disabled", "completed", "failed", "partial"]),
  failedStep: z.enum(["client", "ai_interactions", "admin_access"]).nullable(),
  redacted: z.number().int().nonnegative().nullable(),
  purgedAdminAccess: z.number().int().nonnegative().nullable(),
}).strict();

function request(secret = "cron-secret") {
  return new Request("https://example.test/api/cron/ai-log-retention?private=do-not-log", {
    headers: { authorization: `Bearer ${secret}` },
  });
}

describe("retention run evidence", () => {
  let output = vi.spyOn(console, "log").mockImplementation(() => {});
  const events = () => output.mock.calls.map(([line]) => eventSchema.parse(JSON.parse(String(line))));

  beforeEach(() => {
    vi.clearAllMocks();
    output = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("CRON_SECRET", "cron-secret");
    vi.stubEnv("AI_LOG_RETENTION_CRON_ENABLED", "true");
    vi.stubEnv("VERCEL_DEPLOYMENT_ID", "dpl_test123");
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "a".repeat(40));
  });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

  it("does not emit a run or construct a client for unauthorized requests", async () => {
    expect((await GET(request("wrong"))).status).toBe(401);
    expect(output).not.toHaveBeenCalled();
    expect(mocks.admin).not.toHaveBeenCalled();
  });

  it("records disabled separately without implying zero processed rows", async () => {
    vi.stubEnv("AI_LOG_RETENTION_CRON_ENABLED", "false");
    expect((await GET(request())).status).toBe(200);
    expect(events()).toEqual([expect.objectContaining({ status: "disabled", enabled: false, redacted: null, purgedAdminAccess: null, failedStep: null })]);
    expect(mocks.admin).not.toHaveBeenCalled();
  });

  it.each([[7, 2], [0, 0]])("records both confirmed counts, including zero (%i, %i)", async (redacted, purgedAdminAccess) => {
    const rpc = vi.fn().mockResolvedValueOnce({ data: redacted, error: null }).mockResolvedValueOnce({ data: purgedAdminAccess, error: null });
    mocks.admin.mockReturnValue({ rpc });
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(events()).toEqual([
      expect.objectContaining({ status: "started", redacted: null, purgedAdminAccess: null }),
      expect.objectContaining({ status: "completed", enabled: true, redacted, purgedAdminAccess, failedStep: null, deploymentId: "dpl_test123", commit: "a".repeat(40) }),
    ]);
    expect(events()[0].runId).toBe(events()[1].runId);
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(output.mock.calls)).not.toContain("cron-secret");
    expect(JSON.stringify(output.mock.calls)).not.toContain("do-not-log");
  });

  it.each([null, -1, NaN, 1.5, Number.MAX_SAFE_INTEGER + 1, "7"])("does not report a malformed first count as success: %s", async (data) => {
    const rpc = vi.fn().mockResolvedValue({ data, error: null });
    mocks.admin.mockReturnValue({ rpc });
    expect((await GET(request())).status).toBe(500);
    expect(events().at(-1)).toMatchObject({ status: "failed", failedStep: "ai_interactions", redacted: null, purgedAdminAccess: null });
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it.each(["error", "throw", "malformed"])("preserves known work when the second step fails with %s", async (failure) => {
    const rpc = vi.fn().mockResolvedValueOnce({ data: 7, error: null });
    if (failure === "throw") rpc.mockRejectedValueOnce(new Error("private customer text and secret-key"));
    else rpc.mockResolvedValueOnce({ data: failure === "malformed" ? -1 : null, error: failure === "error" ? { message: "private customer text and secret-key" } : null });
    mocks.admin.mockReturnValue({ rpc });
    const response = await GET(request());
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: "Admin access log retention failed", redacted: 7 });
    expect(events().at(-1)).toMatchObject({ status: "partial", failedStep: "admin_access", redacted: 7, purgedAdminAccess: null });
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(mocks.error).toHaveBeenCalledExactlyOnceWith("api/cron/ai-log-retention", new Error("Retention run failed at admin_access"));
    const errorDetails = mocks.error.mock.calls.flat().map(value => value instanceof Error ? value.message : String(value)).join(" ");
    expect(errorDetails).not.toContain("secret-key");
    expect(JSON.stringify(output.mock.calls)).not.toContain("private customer text");
  });

  it("contains client exceptions and rejects malformed deployment metadata", async () => {
    vi.stubEnv("VERCEL_DEPLOYMENT_ID", "private customer text");
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "secret-key");
    mocks.admin.mockImplementationOnce(() => { throw new Error("private customer text and secret-key"); });
    expect((await GET(request())).status).toBe(500);
    expect(events().at(-1)).toMatchObject({ status: "failed", failedStep: "client", deploymentId: null, commit: null });
    expect(mocks.error).toHaveBeenCalledExactlyOnceWith("api/cron/ai-log-retention", new Error("Retention run failed at client"));
    const errorDetails = mocks.error.mock.calls.flat().map(value => value instanceof Error ? value.message : String(value)).join(" ");
    expect(errorDetails).not.toContain("secret-key");
    expect(JSON.stringify(output.mock.calls)).not.toContain("private customer text");
  });

  it("does not retry work or turn success into failure when the log sink throws", async () => {
    output.mockImplementation(() => { throw new Error("log unavailable"); });
    const rpc = vi.fn().mockResolvedValueOnce({ data: 7, error: null }).mockResolvedValueOnce({ data: 2, error: null });
    mocks.admin.mockReturnValue({ rpc });
    const response = await GET(request());
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ status: "completed", redacted: 7, purgedAdminAccess: 2 });
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it.each(["ai_interactions", "admin_access"])("still attempts a safe error alert when JSON output fails at %s", async (step) => {
    output.mockImplementation(() => { throw new Error("log unavailable"); });
    const rpc = vi.fn();
    if (step === "admin_access") rpc.mockResolvedValueOnce({ data: 0, error: null });
    rpc.mockRejectedValueOnce(new Error("secret-key"));
    mocks.admin.mockReturnValue({ rpc });
    const response = await GET(request());
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual(step === "admin_access"
      ? { error: "Admin access log retention failed", redacted: 0 }
      : { error: "AI log retention failed" });
    expect(rpc).toHaveBeenCalledTimes(step === "admin_access" ? 2 : 1);
    expect(mocks.error).toHaveBeenCalledExactlyOnceWith("api/cron/ai-log-retention", new Error(`Retention run failed at ${step}`));
  });

  it("preserves the partial response even if the separate error alert throws", async () => {
    mocks.error.mockImplementationOnce(() => { throw new Error("alert unavailable"); });
    const rpc = vi.fn().mockResolvedValueOnce({ data: 7, error: null }).mockRejectedValueOnce(new Error("secret-key"));
    mocks.admin.mockReturnValue({ rpc });
    const response = await GET(request());
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: "Admin access log retention failed", redacted: 7 });
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(events().at(-1)).toMatchObject({ status: "partial", redacted: 7, purgedAdminAccess: null });
  });
});
