import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ rpc: mocks.rpc }),
}));

import {
  finalizeCourtProviderAudit,
  settleCourtHighRiskProviderResultForUser,
  settleCourtUnstagedProviderResult,
  stageCourtVerdictProviderResultForUser,
} from "@/lib/coupleCourt/repository";

const VERDICT_ID = "00000000-0000-4000-8000-000000000001";
const USER_ID = "00000000-0000-4000-8000-000000000002";
const LEASE_TOKEN = "00000000-0000-4000-8000-000000000003";
const INPUT_HASH = "a".repeat(64);
const REQUEST_KEY = "b".repeat(64);

describe("court provider settlement repository contracts", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("rejects a missing staging acknowledgement row", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null });

    await expect(stageCourtVerdictProviderResultForUser({
      verdictId: VERDICT_ID,
      userId: USER_ID,
      leaseToken: LEASE_TOKEN,
      inputHash: INPUT_HASH,
      result: {},
      missions: [],
      model: "gpt-5.6-terra",
      auditModel: "gpt-5.6-terra",
    })).rejects.toMatchObject({ code: "COUPLE_COURT_STORAGE_FAILED" });
  });

  it("accepts only a known payload-free unstaged settlement state", async () => {
    mocks.rpc.mockResolvedValue({
      data: {
        verdict_id: VERDICT_ID,
        provider_state: "failed_invalid",
        provider_audit_state: "pending",
        provider_error_code: "provider_result_unstaged",
        subject_deleted: true,
      },
      error: null,
    });

    await expect(settleCourtUnstagedProviderResult({
      verdictId: VERDICT_ID,
      leaseToken: LEASE_TOKEN,
      inputHash: INPUT_HASH,
      requestKey: REQUEST_KEY,
      auditModel: "gpt-5.6-terra",
    })).resolves.toMatchObject({
      verdict_id: VERDICT_ID,
      provider_state: "failed_invalid",
      provider_audit_state: "pending",
      subject_deleted: true,
    });
  });

  it("rejects a settlement that does not prove whether the private graph was deleted", async () => {
    mocks.rpc.mockResolvedValue({
      data: {
        verdict_id: VERDICT_ID,
        provider_state: "failed_invalid",
        provider_audit_state: "pending",
        provider_error_code: "provider_result_unstaged",
      },
      error: null,
    });

    await expect(settleCourtUnstagedProviderResult({
      verdictId: VERDICT_ID,
      leaseToken: LEASE_TOKEN,
      inputHash: INPUT_HASH,
      requestKey: REQUEST_KEY,
      auditModel: "gpt-5.6-terra",
    })).rejects.toMatchObject({ code: "COUPLE_COURT_STORAGE_FAILED" });
  });

  it("rejects a high-risk settlement that does not prove the request identity", async () => {
    mocks.rpc.mockResolvedValue({
      data: {
        verdict_id: VERDICT_ID,
        request_key: "c".repeat(64),
        provider_state: "failed_invalid",
        provider_audit_state: "pending",
        safety_level: "high_risk",
        safety_categories: ["violence"],
        subject_deleted: false,
      },
      error: null,
    });

    await expect(settleCourtHighRiskProviderResultForUser({
      verdictId: VERDICT_ID,
      userId: USER_ID,
      leaseToken: LEASE_TOKEN,
      inputHash: INPUT_HASH,
      requestKey: REQUEST_KEY,
      categories: ["violence"],
      auditModel: "gpt-5.6-terra",
    })).rejects.toMatchObject({ code: "COUPLE_COURT_STORAGE_FAILED" });
  });

  it("accepts a high-risk settlement only when every requested category is durable", async () => {
    mocks.rpc.mockResolvedValue({
      data: {
        verdict_id: VERDICT_ID,
        request_key: REQUEST_KEY,
        provider_state: "failed_invalid",
        provider_audit_state: "audited",
        safety_level: "high_risk",
        safety_categories: ["coercive_control", "violence"],
        subject_deleted: false,
      },
      error: null,
    });

    await expect(settleCourtHighRiskProviderResultForUser({
      verdictId: VERDICT_ID,
      userId: USER_ID,
      leaseToken: LEASE_TOKEN,
      inputHash: INPUT_HASH,
      requestKey: REQUEST_KEY,
      categories: ["violence"],
      auditModel: "gpt-5.6-terra",
    })).resolves.toMatchObject({
      request_key: REQUEST_KEY,
      safety_level: "high_risk",
    });
  });

  it("rejects finalization unless the database returns audited evidence", async () => {
    mocks.rpc.mockResolvedValue({
      data: {
        verdict_id: VERDICT_ID,
        provider_state: "result_staged",
        provider_audit_state: "pending",
        subject_deleted: false,
      },
      error: null,
    });

    await expect(finalizeCourtProviderAudit({
      verdictId: VERDICT_ID,
      requestKey: REQUEST_KEY,
    })).rejects.toMatchObject({ code: "COUPLE_COURT_STORAGE_FAILED" });
  });
});
