import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ rpc: mocks.rpc }),
}));

import { claimCourtVerdictForUser } from "@/lib/coupleCourt/repository";

const CASE_ID = "00000000-0000-4000-8000-000000000001";
const USER_ID = "00000000-0000-4000-8000-000000000002";
const VERDICT_ID = "00000000-0000-4000-8000-000000000003";
const INPUT_HASH = "a".repeat(64);

function claim(allowNewClaim: boolean) {
  return claimCourtVerdictForUser({
    caseId: CASE_ID,
    userId: USER_ID,
    inputHash: INPUT_HASH,
    promptVersion: "court-verdict-2026-07-13.4",
    schemaVersion: "1.0",
    model: "gpt-5.6-terra",
    leaseSeconds: 180,
    allowNewClaim,
  });
}

describe("claimCourtVerdictForUser", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("passes the new-claim fence and accepts a mutation-free unavailable result", async () => {
    mocks.rpc.mockResolvedValue({
      data: {
        verdict_id: null,
        generation_version: null,
        claim_status: "unavailable",
        result_json: null,
      },
      error: null,
    });

    await expect(claim(false)).resolves.toEqual(expect.objectContaining({
      verdictId: null,
      generationVersion: null,
      claimStatus: "unavailable",
      leaseToken: null,
      result: null,
    }));
    expect(mocks.rpc).toHaveBeenCalledWith("claim_court_verdict", {
      p_case_id: CASE_ID,
      p_user_id: USER_ID,
      p_input_hash: INPUT_HASH,
      p_prompt_version: "court-verdict-2026-07-13.4",
      p_schema_version: "1.0",
      p_model: "gpt-5.6-terra",
      p_lease_seconds: 180,
      p_allow_new_claim: false,
    });
  });

  it("accepts an expired retry identity without treating it as an executable lease", async () => {
    mocks.rpc.mockResolvedValue({
      data: {
        verdict_id: VERDICT_ID,
        generation_version: 2,
        claim_status: "unavailable",
        result_json: null,
      },
      error: null,
    });

    await expect(claim(false)).resolves.toEqual(expect.objectContaining({
      verdictId: VERDICT_ID,
      generationVersion: 2,
      claimStatus: "unavailable",
      leaseToken: null,
    }));
  });

  it("rejects an unavailable response that smuggles staged provider data", async () => {
    mocks.rpc.mockResolvedValue({
      data: {
        verdict_id: null,
        generation_version: null,
        claim_status: "unavailable",
        result_json: { headline: "must not cross this boundary" },
      },
      error: null,
    });

    await expect(claim(false)).rejects.toMatchObject({
      code: "COUPLE_COURT_STORAGE_FAILED",
      status: 500,
    });
  });
});
