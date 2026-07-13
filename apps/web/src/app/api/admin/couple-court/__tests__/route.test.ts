import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  verifyAdmin: vi.fn(),
  getServiceClient: vi.fn(),
  from: vi.fn(),
  rpc: vi.fn(),
  logRecoveredCourtVerdictAudit: vi.fn(),
}));

vi.mock("@/lib/utils/adminAuth", () => ({
  verifyAdmin: mocks.verifyAdmin,
  getServiceClient: mocks.getServiceClient,
}));

vi.mock("@/lib/coupleCourt/judge", () => ({
  logRecoveredCourtVerdictAudit: mocks.logRecoveredCourtVerdictAudit,
}));

import {
  COURT_VERDICT_PROMPT_VERSION,
  COURT_VERDICT_SCHEMA_VERSION,
} from "@/lib/coupleCourt/config";
import { GET, POST } from "../route";

const ADMIN_ID = "00000000-0000-4000-8000-000000000001";
const POST_ID = "00000000-0000-4000-8000-000000000002";
const COMMENT_ID = "00000000-0000-4000-8000-000000000003";
const REPORT_ID = "00000000-0000-4000-8000-000000000004";
const VERDICT_ID = "00000000-0000-4000-8000-000000000005";
const AUDIT_USER_ID = "00000000-0000-4000-8000-000000000006";
const AUDIT_COUPLE_ID = "00000000-0000-4000-8000-000000000007";
const RECOVERY_LEASE_TOKEN = "00000000-0000-4000-8000-000000000008";
const PROVIDER_REQUEST_KEY = "a".repeat(64);
const INPUT_HASH = "b".repeat(64);
const HISTORICAL_PROMPT_VERSION = "court-verdict-2026-06-01.9";

function providerAuditClaim(overrides: Record<string, unknown> = {}) {
  return {
    claim_status: "execute",
    verdict_id: VERDICT_ID,
    case_id: "private-case-id",
    provider_state: "result_staged",
    provider_audit_state: "pending",
    provider_error_code: null,
    provider_audit_pending_at: "2026-07-13T03:02:00.000Z",
    recovery_attempt_count: 1,
    recovery_lease_token: RECOVERY_LEASE_TOKEN,
    recovery_lease_expires_at: "2026-07-13T03:04:00.000Z",
    request_key: PROVIDER_REQUEST_KEY,
    audit_user_id: AUDIT_USER_ID,
    audit_couple_id: AUDIT_COUPLE_ID,
    audit_preflight_safety_level: "normal",
    audit_model: "gpt-5.6-terra",
    input_hash: INPUT_HASH,
    mode: "couple",
    category: "budget",
    tone: "practical",
    prompt_version: COURT_VERDICT_PROMPT_VERSION,
    schema_version: COURT_VERDICT_SCHEMA_VERSION,
    high_risk_categories: null,
    usage: {
      input_tokens: 301,
      output_tokens: 410,
      cached_input_tokens: 25,
      cache_write_input_tokens: 0,
    },
    ...overrides,
  };
}

function queryResult(data: unknown[]) {
  const result = { data, error: null };
  const query: Record<string, ReturnType<typeof vi.fn>> & {
    then?: PromiseLike<typeof result>["then"];
  } = {};
  for (const method of ["select", "eq", "is", "in", "order"]) {
    query[method] = vi.fn(() => query);
  }
  query.limit = vi.fn().mockResolvedValue(result);
  query.then = (resolve, reject) => Promise.resolve(result).then(resolve, reject);
  return query;
}

function mutationRequest(body: Record<string, unknown>, origin = "https://hanbang.ai") {
  return new Request("https://hanbang.ai/api/admin/couple-court", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: origin,
      "Sec-Fetch-Site": origin === "https://hanbang.ai" ? "same-origin" : "cross-site",
    },
    body: JSON.stringify(body),
  });
}

describe("couple court admin moderation route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.verifyAdmin.mockResolvedValue({ authorized: true, userId: ADMIN_ID });
    mocks.rpc.mockResolvedValue({ data: { ignored_private_field: "never-returned" }, error: null });
    mocks.logRecoveredCourtVerdictAudit.mockResolvedValue(undefined);
    mocks.getServiceClient.mockReturnValue({ from: mocks.from, rpc: mocks.rpc });
  });

  it("maps the GET queue to an explicit public-only response", async () => {
    const post = {
      id: POST_ID,
      case_id: "private-case-id",
      creator_user_id: "private-user-id",
      sanitized_snapshot_json: {
        snapshotVersion: "1.0",
        category: "communication",
        mode: "couple",
        provisional: false,
        safeTitle: "답변 시점을 다시 정한 사건",
        oneLine: "마감 전 확인 시간을 함께 정했어요.",
        resultLabel: "공동 규칙 권고",
        hashtags: ["대화", "준비"],
        injectedPrivateValue: "must-not-leak",
      },
      snapshot_version: 1,
      status: "pending_review",
      moderation_status: "pending",
      moderation_reason_code: null,
      comments_enabled: true,
      published_at: null,
      created_at: "2026-07-13T00:00:00.000Z",
      updated_at: "2026-07-13T00:00:00.000Z",
      statement: "private statement",
    };
    const comment = {
      id: COMMENT_ID,
      public_post_id: POST_ID,
      user_id: "private-comment-author",
      comment_type: "empathy",
      body: "서로의 마감 시간을 정하면 좋겠어요.",
      moderation_status: "pending",
      created_at: "2026-07-13T01:00:00.000Z",
    };
    const report = {
      id: REPORT_ID,
      public_post_id: POST_ID,
      comment_id: null,
      reporter_user_id: "private-reporter",
      target_type: "post",
      reason_code: "pii",
      status: "open",
      created_at: "2026-07-13T02:00:00.000Z",
    };
    const providerReconciliation = {
      verdict_id: VERDICT_ID,
      case_id: "private-provider-case",
      audit_user_id: "private-provider-user",
      request_key: PROVIDER_REQUEST_KEY,
      request_hash: "private-request-hash",
      provider_state: "failed_unknown",
      started_at: "2026-07-13T03:00:00.000Z",
      failed_at: "2026-07-13T03:01:00.000Z",
      provider_error_code: "provider_request_aborted",
      created_at: "2026-07-13T02:59:00.000Z",
      updated_at: "2026-07-13T03:01:00.000Z",
    };
    const providerAuditRecovery = {
      verdict_id: "private-audit-verdict-id",
      case_id: "private-audit-case-id",
      request_key: "c".repeat(64),
      request_hash: "private-audit-request-hash",
      audit_user_id: "private-audit-user-id",
      audit_couple_id: "private-audit-couple-id",
      audit_model: "private-audit-model",
      staged_result_json: { private: "private-staged-verdict" },
      staged_missions_json: [{ private: "private-staged-mission" }],
      provider_input_tokens: 300,
      provider_state: "result_staged",
      provider_error_code: null,
      provider_audit_state: "pending",
      provider_audit_pending_at: "2026-07-13T03:02:00.000Z",
      provider_audit_recovery_attempt_count: 2,
      provider_audit_recovery_last_error_code: "required_audit_write_failed",
      provider_audit_recovery_last_error_at: "2026-07-13T03:03:00.000Z",
    };
    let providerQueryCount = 0;
    mocks.from.mockImplementation((table: string) => {
      if (table === "court_public_posts") return queryResult([post]);
      if (table === "court_comments") return queryResult([comment]);
      if (table === "court_reports") return queryResult([report]);
      if (table === "court_provider_reservations") {
        providerQueryCount += 1;
        return queryResult(providerQueryCount === 1
          ? [providerReconciliation]
          : [providerAuditRecovery]);
      }
      throw new Error(`unexpected table ${table}`);
    });

    const response = await GET(new Request("https://hanbang.ai/api/admin/couple-court"));
    const body = await response.json();
    const serialized = JSON.stringify(body);

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    expect(body.posts[0]).toEqual(expect.objectContaining({
      id: POST_ID,
      snapshot: expect.objectContaining({ safeTitle: "답변 시점을 다시 정한 사건" }),
    }));
    expect(body.comments[0]).toEqual(expect.objectContaining({ id: COMMENT_ID, publicPostId: POST_ID }));
    expect(body.reports[0]).toEqual(expect.objectContaining({ id: REPORT_ID, reasonCode: "pii" }));
    expect(body.providerReconciliations[0]).toEqual({
      verdictId: VERDICT_ID,
      requestKey: PROVIDER_REQUEST_KEY,
      providerState: "failed_unknown",
      startedAt: "2026-07-13T03:00:00.000Z",
      failedAt: "2026-07-13T03:01:00.000Z",
      errorCode: "provider_request_aborted",
      createdAt: "2026-07-13T02:59:00.000Z",
      updatedAt: "2026-07-13T03:01:00.000Z",
    });
    expect(body.providerAuditRecoveries[0]).toEqual({
      providerState: "result_staged",
      errorCode: null,
      pendingAt: "2026-07-13T03:02:00.000Z",
      attemptCount: 2,
      lastErrorCode: "required_audit_write_failed",
      lastErrorAt: "2026-07-13T03:03:00.000Z",
    });
    expect(serialized).not.toContain("private-case-id");
    expect(serialized).not.toContain("private-user-id");
    expect(serialized).not.toContain("private-comment-author");
    expect(serialized).not.toContain("private-reporter");
    expect(serialized).not.toContain("private statement");
    expect(serialized).not.toContain("must-not-leak");
    expect(serialized).not.toContain("private-provider-case");
    expect(serialized).not.toContain("private-provider-user");
    expect(serialized).not.toContain("private-request-hash");
    expect(serialized).not.toContain("private-audit-verdict-id");
    expect(serialized).not.toContain("private-audit-case-id");
    expect(serialized).not.toContain("private-audit-user-id");
    expect(serialized).not.toContain("private-audit-couple-id");
    expect(serialized).not.toContain("private-audit-model");
    expect(serialized).not.toContain("private-audit-request-hash");
    expect(serialized).not.toContain("private-staged-verdict");
    expect(serialized).not.toContain("private-staged-mission");
    expect(serialized).not.toContain("\"provider_input_tokens\"");
  });

  it("rejects unauthenticated access before creating a service query", async () => {
    mocks.verifyAdmin.mockResolvedValue({ authorized: false });

    const response = await GET(new Request("https://hanbang.ai/api/admin/couple-court"));

    expect(response.status).toBe(401);
    expect(mocks.getServiceClient).not.toHaveBeenCalled();
  });

  it("blocks cross-site JSON mutations before calling a moderation RPC", async () => {
    const response = await POST(mutationRequest(
      { target: "post", id: POST_ID, decision: "approve" },
      "https://attacker.example",
    ));

    expect(response.status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("requires an allowlisted reason for a destructive moderation decision", async () => {
    const response = await POST(mutationRequest({
      target: "post",
      id: POST_ID,
      decision: "reject",
    }));

    expect(response.status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("requires the fixed provider-review confirmation before allowing a retry", async () => {
    const response = await POST(mutationRequest({
      target: "provider_reconciliation",
      id: VERDICT_ID,
      decision: "allow_retry",
      reasonCode: "provider_dashboard_failed",
      confirmation: "I clicked a button",
    }));

    expect(response.status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("recovers one pending provider audit server-side without returning its identity", async () => {
    const events: string[] = [];
    mocks.rpc.mockImplementation(async (name: string) => {
      if (name === "claim_court_provider_audit_recovery") {
        events.push("claim");
        return {
          data: providerAuditClaim({ prompt_version: HISTORICAL_PROMPT_VERSION }),
          error: null,
        };
      }
      if (name === "finalize_court_provider_audit") {
        events.push("finalize");
        return {
          data: { verdict_id: VERDICT_ID, provider_audit_state: "audited" },
          error: null,
        };
      }
      throw new Error(`unexpected RPC ${name}`);
    });
    mocks.logRecoveredCourtVerdictAudit.mockImplementation(async () => {
      events.push("audit");
    });

    const response = await POST(mutationRequest({
      target: "provider_audit_recovery",
      decision: "recover_one",
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(events).toEqual(["claim", "audit", "finalize"]);
    expect(mocks.logRecoveredCourtVerdictAudit).toHaveBeenCalledWith({
      userId: AUDIT_USER_ID,
      coupleId: AUDIT_COUPLE_ID,
      mode: "couple",
      category: "budget",
      tone: "practical",
      preflightSafetyLevel: "normal",
      inputHash: INPUT_HASH,
      promptVersion: HISTORICAL_PROMPT_VERSION,
      schemaVersion: COURT_VERDICT_SCHEMA_VERSION,
      model: "gpt-5.6-terra",
      providerRequestKey: PROVIDER_REQUEST_KEY,
      usage: {
        inputTokens: 301,
        outputTokens: 410,
        cachedInputTokens: 25,
        cacheWriteInputTokens: 0,
      },
    });
    expect(mocks.rpc).toHaveBeenCalledWith("finalize_court_provider_audit", {
      p_verdict_id: VERDICT_ID,
      p_request_key: PROVIDER_REQUEST_KEY,
    });
    expect(body).toEqual({
      ok: true,
      target: "provider_audit_recovery",
      action: "recover_court_provider_audit",
      recovered: true,
      providerState: "result_staged",
    });
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain(VERDICT_ID);
    expect(serialized).not.toContain(PROVIDER_REQUEST_KEY);
    expect(serialized).not.toContain(AUDIT_USER_ID);
    expect(serialized).not.toContain(AUDIT_COUPLE_ID);
    expect(serialized).not.toContain(INPUT_HASH);
  });

  it("records a safe recovery failure and leaves finalization pending when the audit write fails", async () => {
    mocks.rpc.mockImplementation(async (name: string) => {
      if (name === "claim_court_provider_audit_recovery") {
        return { data: providerAuditClaim(), error: null };
      }
      if (name === "record_court_provider_audit_recovery_failure") {
        return { data: { provider_audit_state: "pending" }, error: null };
      }
      throw new Error(`unexpected RPC ${name}`);
    });
    mocks.logRecoveredCourtVerdictAudit.mockRejectedValueOnce(new Error("audit unavailable"));

    const response = await POST(mutationRequest({
      target: "provider_audit_recovery",
      decision: "recover_one",
    }));

    expect(response.status).toBe(503);
    expect(mocks.rpc).toHaveBeenCalledWith(
      "record_court_provider_audit_recovery_failure",
      {
        p_verdict_id: VERDICT_ID,
        p_admin_user_id: ADMIN_ID,
        p_recovery_lease_token: RECOVERY_LEASE_TOKEN,
        p_error_code: "required_audit_write_failed",
      },
    );
    expect(mocks.rpc).not.toHaveBeenCalledWith(
      "finalize_court_provider_audit",
      expect.anything(),
    );
    await expect(response.json()).resolves.toEqual(expect.objectContaining({
      code: "PROVIDER_AUDIT_RECOVERY_FAILED",
    }));
  });

  it("records a bounded failure when exact audit evidence cannot be finalized", async () => {
    mocks.rpc.mockImplementation(async (name: string) => {
      if (name === "claim_court_provider_audit_recovery") {
        return { data: providerAuditClaim(), error: null };
      }
      if (name === "finalize_court_provider_audit") {
        return { data: null, error: { code: "55000" } };
      }
      if (name === "record_court_provider_audit_recovery_failure") {
        return { data: { provider_audit_state: "pending" }, error: null };
      }
      throw new Error(`unexpected RPC ${name}`);
    });

    const response = await POST(mutationRequest({
      target: "provider_audit_recovery",
      decision: "recover_one",
    }));

    expect(response.status).toBe(503);
    expect(mocks.logRecoveredCourtVerdictAudit).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).toHaveBeenCalledWith(
      "record_court_provider_audit_recovery_failure",
      expect.objectContaining({ p_error_code: "audit_finalize_failed" }),
    );
  });

  it("rejects an unsupported historical schema and records only a bounded error code", async () => {
    mocks.rpc.mockImplementation(async (name: string) => {
      if (name === "claim_court_provider_audit_recovery") {
        return {
          data: providerAuditClaim({ schema_version: "9.9" }),
          error: null,
        };
      }
      if (name === "record_court_provider_audit_recovery_failure") {
        return { data: { provider_audit_state: "pending" }, error: null };
      }
      throw new Error(`unexpected RPC ${name}`);
    });

    const response = await POST(mutationRequest({
      target: "provider_audit_recovery",
      decision: "recover_one",
    }));

    expect(response.status).toBe(503);
    expect(mocks.logRecoveredCourtVerdictAudit).not.toHaveBeenCalled();
    expect(mocks.rpc).toHaveBeenCalledWith(
      "record_court_provider_audit_recovery_failure",
      expect.objectContaining({ p_error_code: "recovery_claim_invalid" }),
    );
  });

  it("treats an empty audit recovery queue as a safe no-op", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: { claim_status: "empty" }, error: null });

    const response = await POST(mutationRequest({
      target: "provider_audit_recovery",
      decision: "recover_one",
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      target: "provider_audit_recovery",
      action: "recover_court_provider_audit",
      recovered: false,
      providerState: null,
    });
    expect(mocks.logRecoveredCourtVerdictAudit).not.toHaveBeenCalled();
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });

  it.each([
    {
      body: { target: "post", id: POST_ID, decision: "approve" },
      rpc: "review_court_public_post",
      args: {
        p_public_post_id: POST_ID,
        p_reviewer_user_id: ADMIN_ID,
        p_decision: "approve",
        p_reason_code: null,
      },
    },
    {
      body: { target: "comment", id: COMMENT_ID, decision: "hide", reasonCode: "harassment" },
      rpc: "review_court_public_comment",
      args: {
        p_comment_id: COMMENT_ID,
        p_reviewer_user_id: ADMIN_ID,
        p_decision: "hide",
        p_reason_code: "harassment",
      },
    },
    {
      body: { target: "comments", id: POST_ID, enabled: false, reasonCode: "policy_violation" },
      rpc: "set_court_public_comments_enabled",
      args: {
        p_public_post_id: POST_ID,
        p_reviewer_user_id: ADMIN_ID,
        p_enabled: false,
        p_reason_code: "policy_violation",
      },
    },
    {
      body: { target: "report", id: REPORT_ID, decision: "dismiss", reasonCode: "no_violation" },
      rpc: "review_court_public_report",
      args: {
        p_report_id: REPORT_ID,
        p_reviewer_user_id: ADMIN_ID,
        p_decision: "dismiss",
        p_reason_code: "no_violation",
      },
    },
    {
      body: {
        target: "provider_reconciliation",
        id: VERDICT_ID,
        decision: "allow_retry",
        reasonCode: "provider_dashboard_not_found",
        confirmation: "ALLOW_RETRY_AFTER_PROVIDER_REVIEW",
      },
      rpc: "reconcile_court_provider_failure",
      args: {
        p_verdict_id: VERDICT_ID,
        p_admin_user_id: ADMIN_ID,
        p_action: "allow_retry",
        p_reason_code: "provider_dashboard_not_found",
        p_confirmation: "ALLOW_RETRY_AFTER_PROVIDER_REVIEW",
      },
    },
  ])("routes $rpc through the service-only RPC with the authenticated reviewer", async ({ body, rpc, args }) => {
    const response = await POST(mutationRequest(body));

    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith(rpc, args);
    await expect(response.json()).resolves.toEqual({ ok: true, target: body.target, action: rpc });
  });
});
