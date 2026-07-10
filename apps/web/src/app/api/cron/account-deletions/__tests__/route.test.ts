import { beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import {
  AccountDeletionError,
  processAccountDeletionJob,
} from "@/lib/accountDeletion";
import { GET, isAccountDeletionCronAuthorized } from "../route";

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(),
}));

vi.mock("@/lib/accountDeletion", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/accountDeletion")>();
  return { ...actual, processAccountDeletionJob: vi.fn() };
});

const JOB = {
  job_id: "123e4567-e89b-42d3-a456-426614174000",
  user_id: "223e4567-e89b-42d3-a456-426614174000",
  reason: "privacy",
  attempts: 1,
  storage_inventory: null,
};

function cronRequest(secret = "test-cron-secret") {
  return new Request("http://localhost/api/cron/account-deletions", {
    headers: { authorization: `Bearer ${secret}` },
  });
}

describe("/api/cron/account-deletions GET", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = "test-cron-secret";
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test-key";
  });

  it("fails closed when the cron secret is absent or wrong", async () => {
    expect(isAccountDeletionCronAuthorized(cronRequest(), undefined)).toBe(false);
    const response = await GET(cronRequest("wrong"));

    expect(response.status).toBe(401);
    expect(createClient).not.toHaveBeenCalled();
  });

  it("claims a bounded batch and reports successful processing", async () => {
    const admin = {
      rpc: vi.fn(async (name: string) => name === "claim_account_deletion_jobs"
        ? { data: [JOB], error: null }
        : {
            data: { dead_letter: 0, overdue: 0, stale_processing: 0 },
            error: null,
          }),
    };
    vi.mocked(createClient).mockReturnValue(admin as unknown as ReturnType<typeof createClient>);
    vi.mocked(processAccountDeletionJob).mockResolvedValue();

    const response = await GET(cronRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ claimed: 1, completed: 1, retry: 0, deadLetter: 0 });
    expect(admin.rpc).toHaveBeenCalledWith(
      "claim_account_deletion_jobs",
      expect.objectContaining({ p_limit: 1, p_lease_seconds: 600 }),
    );
    expect(processAccountDeletionJob).toHaveBeenCalledTimes(1);
  });

  it("records only a bounded machine code and schedules retry", async () => {
    const admin = {
      rpc: vi.fn(async (name: string) => {
        if (name === "claim_account_deletion_jobs") return { data: [JOB], error: null };
        if (name === "fail_account_deletion_job") return { data: "retry", error: null };
        if (name === "account_deletion_queue_health") {
          return {
            data: { dead_letter: 0, overdue: 0, stale_processing: 0 },
            error: null,
          };
        }
        return { data: null, error: { message: "unexpected" } };
      }),
    };
    vi.mocked(createClient).mockReturnValue(admin as unknown as ReturnType<typeof createClient>);
    vi.mocked(processAccountDeletionJob).mockRejectedValue(
      new AccountDeletionError("ACTIVE_PROVIDER_LEASES"),
    );

    const response = await GET(cronRequest());
    const body = await response.json();

    expect(body).toMatchObject({ claimed: 1, completed: 0, retry: 1 });
    expect(admin.rpc).toHaveBeenCalledWith(
      "fail_account_deletion_job",
      expect.objectContaining({
        p_job_id: JOB.job_id,
        p_error_code: "ACTIVE_PROVIDER_LEASES",
      }),
    );
  });

  it("fails the cron health check when a dead letter needs an operator", async () => {
    const admin = {
      rpc: vi.fn(async (name: string) => name === "claim_account_deletion_jobs"
        ? { data: [], error: null }
        : {
            data: { dead_letter: 1, overdue: 0, stale_processing: 0 },
            error: null,
          }),
    };
    vi.mocked(createClient).mockReturnValue(admin as unknown as ReturnType<typeof createClient>);

    const response = await GET(cronRequest());
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toMatchObject({
      ok: false,
      queueHealth: { deadLetter: 1, overdue: 0, staleProcessing: 0 },
    });
  });
});
