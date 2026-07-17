// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));

import { GET } from "./route";

const oldSecret = process.env.CRON_SECRET;
const USER_ID = "11111111-1111-4111-8111-111111111111";
const UPLOAD_ID = "33333333-3333-4333-8333-333333333333";
const FINAL_UPLOAD_ID = "44444444-4444-4444-8444-444444444444";
const STAGING_PATH = `${USER_ID}/${UPLOAD_ID}.png`;
const FINAL_PATH = `${USER_ID}/${FINAL_UPLOAD_ID}.webp`;

function request(secret = "cron-secret") {
  return new Request("http://localhost/api/cron/community-upload-cleanup", {
    headers: { authorization: `Bearer ${secret}` },
  });
}

interface HarnessOptions {
  queryError?: boolean;
  candidates?: unknown[];
  stagingRemoveError?: boolean;
  stagingExists?: boolean;
  claimError?: boolean;
  claimed?: boolean;
  claimedStatus?: "completed" | "rejected" | "expired";
  finalRemoveError?: boolean;
  finalExists?: boolean;
  checkpointResult?: boolean;
  finalizeResult?: boolean;
}

function adminHarness(options: HarnessOptions = {}) {
  const candidates = options.candidates ?? [{
    id: UPLOAD_ID,
    user_id: USER_ID,
    staging_path: STAGING_PATH,
    status: "completed",
    expires_at: "2026-07-16T00:00:00.000Z",
  }];
  const limit = vi.fn(async () => options.queryError
    ? { data: null, error: { message: "db failed" } }
    : { data: candidates, error: null });
  const order = vi.fn(() => ({ limit }));
  const lte = vi.fn(() => ({ order }));
  const is = vi.fn(() => ({ lte }));
  const select = vi.fn(() => ({ is }));
  const fromTable = vi.fn(() => ({ select }));

  const stagingRemove = vi.fn(async () => options.stagingRemoveError
    ? { data: null, error: { message: "staging remove failed" } }
    : { data: [], error: null });
  const stagingExists = vi.fn(async () => ({ data: options.stagingExists ?? false, error: null }));
  const finalRemove = vi.fn(async () => options.finalRemoveError
    ? { data: null, error: { message: "final remove failed" } }
    : { data: [], error: null });
  const finalExists = vi.fn(async () => ({ data: options.finalExists ?? false, error: null }));
  const storageFrom = vi.fn((bucket: string) => bucket === "community-media-staging"
    ? { remove: stagingRemove, exists: stagingExists }
    : { remove: finalRemove, exists: finalExists });

  const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
    if (name === "checkpoint_community_upload_token_cleanup") {
      return { data: options.checkpointResult ?? true, error: null };
    }
    if (name === "claim_unattached_community_upload_sessions") {
      if (options.claimError) return { data: null, error: { message: "claim failed" } };
      return {
        data: options.claimed === false ? [] : [{
          id: FINAL_UPLOAD_ID,
          user_id: USER_ID,
          final_bucket: "community-images",
          final_path: FINAL_PATH,
          status: options.claimedStatus ?? "completed",
          attachment_cleanup_token: args.p_claim_token,
        }],
        error: null,
      };
    }
    if (name === "finalize_unattached_community_upload_cleanup") {
      return { data: options.finalizeResult ?? true, error: null };
    }
    throw new Error(`unexpected RPC ${name}`);
  });

  const admin = { from: fromTable, storage: { from: storageFrom }, rpc };
  mocks.createAdminClient.mockReturnValue(admin);
  return {
    candidates,
    select,
    is,
    lte,
    order,
    limit,
    storageFrom,
    stagingRemove,
    stagingExists,
    finalRemove,
    finalExists,
    rpc,
  };
}

describe("GET /api/cron/community-upload-cleanup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = "cron-secret";
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("rejects missing or wrong cron credentials before opening the admin client", async () => {
    const response = await GET(request("wrong") as never);
    expect(response.status).toBe(401);
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it("checkpoints an exact completed-session token path and removes an old unattached final", async () => {
    const harness = adminHarness();
    const response = await GET(request() as never);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body).toEqual({
      ok: true,
      tokenCleanup: { scanned: 1, checkpointed: 1, pendingRetry: 0 },
      unattachedCleanup: { claimed: 1, deleted: 1, pendingRetry: 0 },
    });
    expect(harness.is).toHaveBeenCalledWith("token_cleanup_at", null);
    expect(harness.stagingRemove).toHaveBeenCalledWith([STAGING_PATH]);
    expect(harness.stagingExists).toHaveBeenCalledWith(STAGING_PATH);
    expect(harness.rpc).toHaveBeenCalledWith(
      "checkpoint_community_upload_token_cleanup",
      { p_upload_id: UPLOAD_ID, p_staging_path: STAGING_PATH },
    );

    const claimCall = harness.rpc.mock.calls.find(([name]) =>
      name === "claim_unattached_community_upload_sessions"
    );
    expect(claimCall?.[1]).toEqual(expect.objectContaining({
      p_claim_token: expect.stringMatching(/^[0-9a-f-]{36}$/i),
      p_completed_before: expect.any(String),
      p_stale_before: expect.any(String),
      p_limit: 25,
    }));
    expect(harness.storageFrom).toHaveBeenCalledWith("community-images");
    expect(harness.finalRemove).toHaveBeenCalledWith([FINAL_PATH]);
    expect(harness.finalExists).toHaveBeenCalledWith(FINAL_PATH);
    expect(harness.rpc).toHaveBeenCalledWith(
      "finalize_unattached_community_upload_cleanup",
      { p_upload_id: FINAL_UPLOAD_ID, p_claim_token: claimCall?.[1].p_claim_token },
    );
    const checkpointCallIndex = harness.rpc.mock.calls.findIndex(([name]) =>
      name === "checkpoint_community_upload_token_cleanup"
    );
    expect(harness.stagingExists.mock.invocationCallOrder[0]).toBeLessThan(
      harness.rpc.mock.invocationCallOrder[checkpointCallIndex],
    );
    expect(harness.finalExists.mock.invocationCallOrder[0]).toBeLessThan(
      harness.rpc.mock.invocationCallOrder.at(-1)!,
    );
  });

  it("does not checkpoint a staging token when deletion absence is unconfirmed", async () => {
    const harness = adminHarness({ stagingExists: true, claimed: false });

    const response = await GET(request() as never);
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.tokenCleanup).toEqual({ scanned: 1, checkpointed: 0, pendingRetry: 1 });
    expect(harness.rpc).not.toHaveBeenCalledWith(
      "checkpoint_community_upload_token_cleanup",
      expect.anything(),
    );
    expect(JSON.stringify(body)).not.toContain(STAGING_PATH);
  });

  it("keeps the unattached lease retryable when final deletion is unconfirmed", async () => {
    const harness = adminHarness({ candidates: [], finalRemoveError: true, finalExists: true });

    const response = await GET(request() as never);
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.unattachedCleanup).toEqual({ claimed: 1, deleted: 0, pendingRetry: 1 });
    expect(harness.rpc).not.toHaveBeenCalledWith(
      "finalize_unattached_community_upload_cleanup",
      expect.anything(),
    );
  });

  it("cleans a token-checkpointed terminal path left by an incomplete final publish", async () => {
    const harness = adminHarness({ candidates: [], claimedStatus: "expired" });

    const response = await GET(request() as never);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.unattachedCleanup).toEqual({ claimed: 1, deleted: 1, pendingRetry: 0 });
    expect(harness.finalRemove).toHaveBeenCalledWith([FINAL_PATH]);
    expect(harness.rpc).toHaveBeenCalledWith(
      "finalize_unattached_community_upload_cleanup",
      expect.objectContaining({ p_upload_id: FINAL_UPLOAD_ID }),
    );
  });

  it("fails closed before storage mutation when token inventory is invalid", async () => {
    const harness = adminHarness({
      candidates: [{
        id: UPLOAD_ID,
        staging_path: `${USER_ID}/99999999-9999-4999-8999-999999999999.png`,
        status: "completed",
        expires_at: "2026-07-16T00:00:00.000Z",
      }],
    });

    const response = await GET(request() as never);

    expect(response.status).toBe(500);
    expect(harness.stagingRemove).not.toHaveBeenCalled();
    expect(harness.rpc).not.toHaveBeenCalled();
  });

  it("fails closed when either durable inventory cannot be read", async () => {
    const tokenFailure = adminHarness({ queryError: true });
    expect((await GET(request() as never)).status).toBe(500);
    expect(tokenFailure.stagingRemove).not.toHaveBeenCalled();

    vi.clearAllMocks();
    const claimFailure = adminHarness({ candidates: [], claimError: true });
    expect((await GET(request() as never)).status).toBe(500);
    expect(claimFailure.finalRemove).not.toHaveBeenCalled();
  });

  it("keeps every existing cron and adds exactly one cleanup schedule", () => {
    const config = JSON.parse(readFileSync(resolve(process.cwd(), "vercel.json"), "utf8")) as {
      crons: Array<{ path: string; schedule: string }>;
    };
    const paths = config.crons.map((entry) => entry.path);
    expect(paths).toContain("/api/cron/amora-memory");
    expect(paths).toContain("/api/cron/care-moments");
    expect(paths).toContain("/api/cron/booking-projections");
    expect(config.crons.filter((entry) =>
      entry.path === "/api/cron/community-upload-cleanup"
    )).toEqual([{
      path: "/api/cron/community-upload-cleanup",
      schedule: "*/15 * * * *",
    }]);
    expect(new Set(paths).size).toBe(paths.length);
  });
});

if (oldSecret === undefined) delete process.env.CRON_SECRET;
else process.env.CRON_SECRET = oldSecret;
