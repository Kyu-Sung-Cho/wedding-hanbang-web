import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  processAccountDeletionJob: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mocks.createAdminClient,
}));
vi.mock("@/lib/accountDeletion/communityStorageSaga", () => ({
  processAccountDeletionJob: mocks.processAccountDeletionJob,
}));

import { GET } from "./route";

const JOB_ONE = "11111111-1111-4111-8111-111111111111";
const JOB_TWO = "22222222-2222-4222-8222-222222222222";

function request(secret = "cron-secret") {
  return new Request("http://localhost/api/cron/account-deletion", {
    headers: { Authorization: `Bearer ${secret}` },
  });
}

function adminHarness(rows: unknown[] = []) {
  const limit = vi.fn(async () => ({ data: rows, error: null }));
  const order = vi.fn(() => ({ limit }));
  const readyFilter = vi.fn(() => ({ order }));
  const inFilter = vi.fn(() => ({ or: readyFilter }));
  const select = vi.fn(() => ({ in: inFilter }));
  const from = vi.fn(() => ({ select }));
  const admin = { from };
  mocks.createAdminClient.mockReturnValue(admin);
  return { admin, from, select, inFilter, readyFilter, order, limit };
}

describe("GET /api/cron/account-deletion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = "cron-secret";
    process.env.ACCOUNT_DELETION_CRON_ENABLED = "true";
  });

  it("rejects an unauthorized request before creating a service client", async () => {
    const response = await GET(request("wrong"));

    expect(response.status).toBe(401);
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it("is a complete database no-op unless the worker is explicitly enabled", async () => {
    delete process.env.ACCOUNT_DELETION_CRON_ENABLED;

    const missing = await GET(request());
    expect(missing.status).toBe(200);
    await expect(missing.json()).resolves.toEqual({
      ok: true,
      enabled: false,
      status: "disabled",
    });
    expect(mocks.createAdminClient).not.toHaveBeenCalled();

    process.env.ACCOUNT_DELETION_CRON_ENABLED = "false";
    const disabled = await GET(request());
    expect(disabled.status).toBe(200);
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it("processes only a bounded durable-job batch and returns aggregate status", async () => {
    const test = adminHarness([
      { id: JOB_ONE, status: "inventorying", ready_after: null },
      { id: JOB_TWO, status: "deleting", ready_after: "2026-07-17T00:00:00Z" },
    ]);
    mocks.processAccountDeletionJob
      .mockResolvedValueOnce({ status: "pending" })
      .mockResolvedValueOnce({ status: "completed" });

    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      processed: 2,
      completed: 1,
      pending: 1,
      manualReview: 0,
      retry: 0,
    });
    expect(test.inFilter).toHaveBeenCalledWith("status", [
      "inventorying",
      "inventory_ready",
      "deleting",
      "auth_deleting",
    ]);
    expect(test.readyFilter).toHaveBeenCalledWith(
      expect.stringMatching(
        /^status\.neq\.inventory_ready,ready_after\.lte\.[0-9TZ:.+-]+$/,
      ),
    );
    expect(test.limit).toHaveBeenCalledWith(3);
    expect(mocks.processAccountDeletionJob).toHaveBeenNthCalledWith(
      1,
      test.admin,
      JOB_ONE,
    );
  });

  it("returns a retryable failure without leaking job identifiers", async () => {
    adminHarness([{ id: JOB_ONE, status: "deleting", ready_after: null }]);
    mocks.processAccountDeletionJob.mockResolvedValue({ status: "retry" });

    const response = await GET(request());
    const serialized = JSON.stringify(await response.json());

    expect(response.status).toBe(503);
    expect(serialized).not.toContain(JOB_ONE);
    expect(serialized).toContain('"retry":1');
  });

  it("contains an unexpected per-job exception as a retry", async () => {
    adminHarness([{ id: JOB_ONE, status: "deleting", ready_after: null }]);
    mocks.processAccountDeletionJob.mockRejectedValue(
      new Error(`private job detail ${JOB_ONE}`),
    );

    const response = await GET(request());
    const serialized = JSON.stringify(await response.json());

    expect(response.status).toBe(503);
    expect(serialized).toContain('"retry":1');
    expect(serialized).not.toContain(JOB_ONE);
  });

  it("registers exactly one five-minute Vercel schedule", () => {
    const config = JSON.parse(fs.readFileSync(
      path.resolve(process.cwd(), "vercel.json"),
      "utf8",
    )) as { crons: Array<{ path: string; schedule: string }> };

    expect(config.crons.filter(
      (entry) => entry.path === "/api/cron/account-deletion",
    )).toEqual([{
      path: "/api/cron/account-deletion",
      schedule: "*/5 * * * *",
    }]);
  });
});
