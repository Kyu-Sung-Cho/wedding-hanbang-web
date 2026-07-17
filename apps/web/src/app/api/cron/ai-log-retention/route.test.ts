// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mocks.createAdminClient,
}));

import { GET } from "./route";

function request(secret = "cron-secret") {
  return new Request("https://example.test/api/cron/ai-log-retention", {
    headers: { authorization: `Bearer ${secret}` },
  });
}

describe("GET /api/cron/ai-log-retention", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("CRON_SECRET", "cron-secret");
    delete process.env.AI_LOG_RETENTION_CRON_ENABLED;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    delete process.env.AI_LOG_RETENTION_CRON_ENABLED;
  });

  it("is a successful no-op without constructing a service client when the kill switch is missing", async () => {
    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      ok: true,
      enabled: false,
      status: "disabled",
    });
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it("rejects missing or incorrect cron authentication before evaluating the kill switch", async () => {
    vi.stubEnv("AI_LOG_RETENTION_CRON_ENABLED", "true");

    const incorrect = await GET(request("wrong-secret"));
    expect(incorrect.status).toBe(401);

    vi.stubEnv("CRON_SECRET", "");
    const missing = await GET(request());
    expect(missing.status).toBe(401);
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it("treats every value other than exact lowercase true as disabled", async () => {
    for (const value of ["false", "TRUE", " true ", "1"]) {
      vi.stubEnv("AI_LOG_RETENTION_CRON_ENABLED", value);
      const response = await GET(request());

      expect(response.status, value).toBe(200);
      await expect(response.json(), value).resolves.toMatchObject({
        ok: true,
        enabled: false,
        status: "disabled",
      });
    }

    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it("calls the exact 90-day service RPC once only when explicitly enabled", async () => {
    vi.stubEnv("AI_LOG_RETENTION_CRON_ENABLED", "true");
    const rpc = vi.fn().mockResolvedValue({ data: 7, error: null });
    mocks.createAdminClient.mockReturnValue({ rpc });

    const response = await GET(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      enabled: true,
      status: "completed",
      redacted: 7,
    });
    expect(mocks.createAdminClient).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("redact_old_ai_interactions", {
      p_retention: "90 days",
    });
  });

  it("contains service-client and RPC exceptions without exposing secrets or database details", async () => {
    vi.stubEnv("AI_LOG_RETENTION_CRON_ENABLED", "true");
    mocks.createAdminClient.mockImplementationOnce(() => {
      throw new Error("SUPABASE_SERVICE_ROLE_KEY=private-service-key");
    });

    const clientFailure = await GET(request());
    const clientBody = JSON.stringify(await clientFailure.json());

    expect(clientFailure.status).toBe(500);
    expect(clientBody).toBe('{"error":"AI log retention failed"}');
    expect(clientBody).not.toContain("private-service-key");

    mocks.createAdminClient.mockReturnValueOnce({
      rpc: vi.fn().mockRejectedValue(
        new Error("relation private.ai_interactions_log does not exist"),
      ),
    });

    const rpcFailure = await GET(request());
    const rpcBody = JSON.stringify(await rpcFailure.json());

    expect(rpcFailure.status).toBe(500);
    expect(rpcBody).toBe('{"error":"AI log retention failed"}');
    expect(rpcBody).not.toContain("ai_interactions_log");
  });

  it("returns a generic 500 for a database error or malformed count", async () => {
    vi.stubEnv("AI_LOG_RETENTION_CRON_ENABLED", "true");
    const rpc = vi.fn()
      .mockResolvedValueOnce({
        data: null,
        error: { message: "database private detail" },
      })
      .mockResolvedValueOnce({ data: -1, error: null });
    mocks.createAdminClient.mockReturnValue({ rpc });

    for (const forbiddenDetail of ["private detail", "-1"]) {
      const response = await GET(request());
      const body = JSON.stringify(await response.json());

      expect(response.status).toBe(500);
      expect(body).toBe('{"error":"AI log retention failed"}');
      expect(body).not.toContain(forbiddenDetail);
    }
  });

  it("registers exactly one daily low-traffic Vercel schedule", () => {
    const config = JSON.parse(readFileSync(
      resolve(process.cwd(), "vercel.json"),
      "utf8",
    )) as { crons: Array<{ path: string; schedule: string }> };

    expect(config.crons.filter(
      (entry) => entry.path === "/api/cron/ai-log-retention",
    )).toEqual([{
      path: "/api/cron/ai-log-retention",
      schedule: "30 18 * * *",
    }]);
  });
});
