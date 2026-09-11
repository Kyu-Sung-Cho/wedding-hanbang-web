import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), client: vi.fn(), error: vi.fn() }));
vi.mock("@/lib/utils/adminAuth", () => ({ verifyAdmin: mocks.auth, getServiceClient: mocks.client }));
vi.mock("@/utils/log", () => ({ log: { error: mocks.error } }));
import { GET } from "./route";

const JOB = "11111111-1111-4111-8111-111111111111";
const row = {
  id: JOB, status: "manual_review", created_at: "2026-09-01T00:00:00Z", updated_at: "2026-09-01T01:00:00Z",
  storage_verified_at: null, auth_deleted_at: null, completed_at: null,
};
function request(query = "") { return new Request(`https://hanbang.ai/api/admin/account-deletion${query}`); }
function harness(data: unknown = [row], count = 1, error: unknown = null) {
  const limit = vi.fn(async () => ({ data, count, error }));
  const single = vi.fn(async () => ({ data, error }));
  const order = vi.fn();
  order.mockReturnValue({ order, limit });
  const eq = vi.fn(() => ({ order, maybeSingle: single }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));
  mocks.client.mockReturnValue({ from });
  return { from, select, eq, limit };
}
describe("administrator deletion operations read boundary", () => {
  beforeEach(() => { vi.resetAllMocks(); mocks.auth.mockResolvedValue({ authorized: true }); });
  it("requires the existing administrator guard before opening the data client", async () => {
    mocks.auth.mockResolvedValue({ authorized: false });
    const response = await GET(request());
    expect(response.status).toBe(401);
    expect(mocks.client).not.toHaveBeenCalled();
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
  it("lists bounded manual review references, never private payload or automatic resume", async () => {
    const h = harness([{ ...row, user_id: "private-user", reason: "private-reason", path: "private/path", last_error_code: "private_note" }]);
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ outstanding: 1, limit: 50, truncated: false, jobs: [{
      id: JOB, status: "manual_review", createdAt: row.created_at, updatedAt: row.updated_at,
      storageVerifiedAt: null, authDeletedAt: null, completedAt: null, completedInLedger: false,
    }] });
    expect(h.eq).toHaveBeenCalledWith("status", "manual_review");
    expect(h.limit).toHaveBeenCalledWith(50);
    expect(h.select).toHaveBeenCalledWith("id,status,created_at,updated_at,storage_verified_at,auth_deleted_at,completed_at", { count: "exact" });
  });
  it("a resumed job is pending, and only the same job's three checkpoints verify completion in the ledger", async () => {
    harness({ ...row, status: "inventorying" });
    const pending = await GET(request(`?jobId=${JOB}`));
    expect(await pending.json()).toMatchObject({ job: { status: "inventorying", completedInLedger: false } });
    harness({ ...row, status: "completed", storage_verified_at: "2026-09-01T00:30:00Z", auth_deleted_at: "2026-09-01T00:40:00Z", completed_at: "2026-09-01T00:50:00Z" });
    const complete = await GET(request(`?jobId=${JOB}`));
    expect(await complete.json()).toMatchObject({ job: { id: JOB, completedInLedger: true } });
  });
  it.each(["?jobId=bad", `?jobId=${JOB}&jobId=${JOB}`, "?status=completed", "?resume=true"])("rejects unsupported input %s", async (query) => {
    expect((await GET(request(query))).status).toBe(400);
    expect(mocks.client).not.toHaveBeenCalled();
  });
  it("missing is not completed", async () => {
    harness(null);
    expect((await GET(request(`?jobId=${JOB}`))).status).toBe(404);
  });
  it.each([
    { ...row, status: "completed" },
    { ...row, id: "22222222-2222-4222-8222-222222222222" },
    { ...row, completed_at: "2026-09-01T00:50:00Z" },
    { ...row, status: "unknown" },
  ])("fails closed for mismatched or incomplete job evidence", async (data) => {
    harness(data);
    expect((await GET(request(`?jobId=${JOB}`))).status).toBe(503);
  });
  it("does not report a partial list as the complete backlog", async () => {
    harness([row], 51);
    expect((await GET(request())).status).toBe(503);
  });
  it("makes a larger backlog explicit while returning only its oldest bounded page", async () => {
    const jobs = Array.from({ length: 50 }, (_, index) => ({
      ...row, id: `${String(index + 1).padStart(8, "0")}-1111-4111-8111-111111111111`,
    }));
    harness(jobs, 51);
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ outstanding: 51, limit: 50, truncated: true });
  });
  it("redacts database errors from response and telemetry", async () => {
    harness(null, 0, new Error("private@example.com"));
    const response = await GET(request());
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("private@example.com");
    expect(mocks.error.mock.calls.map((call) => String(call[1])).join()).not.toContain("private@example.com");
  });
});
