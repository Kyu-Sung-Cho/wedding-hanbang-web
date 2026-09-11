import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ admin: vi.fn(), process: vi.fn(), error: vi.fn(), fingerprint: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.admin }));
vi.mock("@/lib/accountDeletion/communityStorageSaga", () => ({ processAccountDeletionJob: mocks.process }));
vi.mock("@/utils/log", () => ({ log: { error: mocks.error } }));
vi.mock("@sentry/nextjs", () => ({
  withScope: (callback: (scope: { setFingerprint: typeof mocks.fingerprint }) => void) => callback({ setFingerprint: mocks.fingerprint }),
}));
import { GET } from "./route";

const JOB = "11111111-1111-4111-8111-111111111111";
const OLD = "2026-09-01T00:00:00.000Z";
function setup(active: unknown[] = [], count = 2) {
  const reviewLimit = vi.fn(async () => ({ data: count ? [{ created_at: OLD }] : [], count, error: null }));
  const reviewOrder = vi.fn(() => ({ limit: reviewLimit }));
  const eq = vi.fn(() => ({ order: reviewOrder }));
  const limit = vi.fn(async () => ({ data: active, error: null }));
  const inFilter = vi.fn(() => ({ or: vi.fn(() => ({ order: vi.fn(() => ({ limit })) })) }));
  const select = vi.fn(() => ({ in: inFilter, eq }));
  const from = vi.fn(() => ({ select }));
  mocks.admin.mockReturnValue({ from });
  return { select, inFilter, eq, reviewLimit };
}
function request() { return new Request("https://hanbang.ai/api/cron/account-deletion", { headers: { authorization: "Bearer test-secret" } }); }

describe("account deletion operator observation", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("CRON_SECRET", "test-secret");
    vi.stubEnv("ACCOUNT_DELETION_CRON_ENABLED", "true");
    vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

  it("finds an existing manual review with no eligible jobs and reminds on the next run", async () => {
    const h = setup();
    expect((await GET(request())).status).toBe(200);
    expect((await GET(request())).status).toBe(200);
    expect(h.eq).toHaveBeenCalledWith("status", "manual_review");
    expect(h.reviewLimit).toHaveBeenCalledTimes(2);
    expect(mocks.process).not.toHaveBeenCalled();
    expect(mocks.error).toHaveBeenCalledTimes(2);
    expect(mocks.fingerprint).toHaveBeenNthCalledWith(1, ["account-deletion", "manual-review"]);
    expect(mocks.fingerprint).toHaveBeenNthCalledWith(2, ["account-deletion", "manual-review"]);
    expect(mocks.error).toHaveBeenCalledWith("account-deletion/manual-review", expect.objectContaining({ message: "ACCOUNT_DELETION_MANUAL_REVIEW_REQUIRED" }));
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('"outstanding":2'));
    expect(h.inFilter.mock.calls.flat(2)).not.toContain("manual_review");
  });

  it("observes a newly stopped job after processing without retrying or reporting completion", async () => {
    setup([{ id: JOB, status: "deleting", ready_after: null }], 1);
    mocks.process.mockResolvedValue({ status: "manual_review" });
    const response = await GET(request());
    expect(await response.json()).toMatchObject({ manualReview: 1, completed: 0, retry: 0 });
    expect(mocks.process).toHaveBeenCalledTimes(1);
    expect(mocks.error).toHaveBeenCalledWith("account-deletion/manual-review", expect.any(Error));
    expect(JSON.stringify(vi.mocked(console.log).mock.calls)).not.toContain(JOB);
  });

  it("does not declare an unreadable backlog empty and redacts SDK failures", async () => {
    const h = setup();
    h.reviewLimit.mockRejectedValue(new Error(`private ${JOB} contact@example.com`));
    const response = await GET(request());
    expect(response.status).toBe(503);
    const body = await response.text();
    expect(body).toContain("monitoring unavailable");
    expect(body).not.toContain(JOB);
    expect(mocks.error).toHaveBeenCalledWith("account-deletion/monitor", expect.objectContaining({ message: "ACCOUNT_DELETION_MONITOR_UNAVAILABLE" }));
    expect(mocks.error.mock.calls.map((call) => String(call[1])).join()).not.toContain("contact@example.com");
  });

  it("keeps the worker gate a complete database no-op", async () => {
    setup();
    vi.stubEnv("ACCOUNT_DELETION_CRON_ENABLED", "false");
    expect((await GET(request())).status).toBe(200);
    expect(mocks.admin).not.toHaveBeenCalled();
    expect(mocks.error).not.toHaveBeenCalled();
  });

  it("records a clear observation without equating no backlog to completed deletion", async () => {
    setup([], 0);
    const response = await GET(request());
    expect(await response.json()).toMatchObject({ completed: 0, processed: 0 });
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('"outstanding":0'));
    expect(mocks.error).not.toHaveBeenCalled();
  });

  it("still attempts the fixed alert if JSON output fails, without reprocessing the job", async () => {
    setup([{ id: JOB, status: "deleting", ready_after: null }], 1);
    mocks.process.mockResolvedValue({ status: "completed" });
    vi.mocked(console.log).mockImplementation(() => { throw new Error("sink unavailable"); });
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ completed: 1 });
    expect(mocks.process).toHaveBeenCalledTimes(1);
    expect(mocks.error).toHaveBeenCalledWith("account-deletion/manual-review", expect.any(Error));
  });

  it("does not retry deletion or claim alert delivery if the alert sink throws", async () => {
    setup();
    mocks.error.mockImplementation(() => { throw new Error("alert unavailable"); });
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(await response.text()).not.toMatch(/sent|delivered|notified/);
    expect(mocks.process).not.toHaveBeenCalled();
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('"outstanding":2'));
  });

  it("rejects an inconsistent count instead of reporting no outstanding work", async () => {
    const h = setup();
    h.reviewLimit.mockResolvedValue({ data: [], count: 2, error: null });
    expect((await GET(request())).status).toBe(503);
    expect(console.log).not.toHaveBeenCalled();
  });
});
