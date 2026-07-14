import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  verifyAdmin: vi.fn(),
  getServiceClient: vi.fn(),
  from: vi.fn(),
  rpc: vi.fn(),
  checkRateLimitPersistent: vi.fn(),
  rateLimitKey: vi.fn(),
  logRecoveredCourtVerdictAudit: vi.fn(),
  logAIInteraction: vi.fn(),
}));

vi.mock("@/lib/utils/adminAuth", () => ({
  verifyAdmin: mocks.verifyAdmin,
  getServiceClient: mocks.getServiceClient,
}));

vi.mock("@/lib/coupleCourt/judge", () => ({
  logRecoveredCourtVerdictAudit: mocks.logRecoveredCourtVerdictAudit,
}));

vi.mock("@/lib/compliance/ai-log", () => ({
  logAIInteraction: mocks.logAIInteraction,
}));

vi.mock("@/utils/rateLimit", () => ({
  checkRateLimitPersistent: mocks.checkRateLimitPersistent,
  rateLimitKey: mocks.rateLimitKey,
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
const DELETED_VERDICT_ID = "00000000-0000-4000-8000-000000000009";
const AUDIT_USER_ID = "00000000-0000-4000-8000-000000000006";
const AUDIT_COUPLE_ID = "00000000-0000-4000-8000-000000000007";
const RECOVERY_LEASE_TOKEN = "00000000-0000-4000-8000-000000000008";
const PROVIDER_REQUEST_KEY = "a".repeat(64);
const INPUT_HASH = "b".repeat(64);
const HISTORICAL_PROMPT_VERSION = "court-verdict-2026-06-01.9";

function providerAuditClaim(overrides: Record<string, unknown> = {}) {
  return {
    claim_status: "execute",
    subject_deleted: false,
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

function deletedProviderAuditClaim(overrides: Record<string, unknown> = {}) {
  return {
    claim_status: "execute",
    subject_deleted: true,
    verdict_id: VERDICT_ID,
    provider_audit_state: "pending",
    provider_audit_pending_at: "2026-07-13T03:02:00.000Z",
    recovery_attempt_count: 1,
    recovery_lease_token: RECOVERY_LEASE_TOKEN,
    recovery_lease_expires_at: "2026-07-13T03:04:00.000Z",
    request_key: PROVIDER_REQUEST_KEY,
    audit_model: "gpt-5.6-terra",
    audit_cost_usd: 0.0042,
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
  for (const method of ["select", "eq", "is", "in", "or", "order"]) {
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
    mocks.checkRateLimitPersistent.mockResolvedValue(null);
    mocks.rateLimitKey.mockImplementation((prefix: string, _request: Request, userId?: string) => (
      userId ? `${prefix}:${userId}` : `${prefix}:anonymous`
    ));
    mocks.logRecoveredCourtVerdictAudit.mockResolvedValue(undefined);
    mocks.logAIInteraction.mockResolvedValue(undefined);
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
    const providerDeletionHandoff = {
      verdict_id: DELETED_VERDICT_ID,
      request_key: "d".repeat(64),
      handoff_state: "provider_unknown",
      created_at: "2026-07-13T03:05:00.000Z",
      expires_at: "2026-10-11T03:05:00.000Z",
      lease_token: "private-lease-token",
      audit_model: "private-provider-model",
      provider_input_tokens: 999,
      audit_cost_usd: 99,
      case_id: "deleted-private-case",
      user_id: "deleted-private-user",
      statement: "deleted private statement",
      verdict_payload: { private: "deleted-private-verdict" },
    };
    let providerAuditQuery: ReturnType<typeof queryResult> | undefined;
    mocks.rpc.mockImplementation(async (name: string) => {
      if (name === "list_court_provider_reconciliations") {
        return { data: [providerReconciliation], error: null };
      }
      if (name === "list_court_provider_deletion_handoffs") {
        return { data: [providerDeletionHandoff], error: null };
      }
      throw new Error(`unexpected RPC ${name}`);
    });
    mocks.from.mockImplementation((table: string) => {
      if (table === "court_public_posts") return queryResult([post]);
      if (table === "court_comments") return queryResult([comment]);
      if (table === "court_reports") return queryResult([report]);
      if (table === "court_provider_reservations") {
        providerAuditQuery = queryResult([providerAuditRecovery]);
        return providerAuditQuery;
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
    expect(body.providerDeletionHandoffs[0]).toEqual({
      verdictId: DELETED_VERDICT_ID,
      createdAt: "2026-07-13T03:05:00.000Z",
      expiresAt: "2026-10-11T03:05:00.000Z",
    });
    expect(mocks.rpc).toHaveBeenCalledWith(
      "list_court_provider_reconciliations",
      { p_actor_id: ADMIN_ID, p_limit: 50 },
    );
    expect(mocks.rpc).toHaveBeenCalledWith(
      "list_court_provider_deletion_handoffs",
      { p_actor_id: ADMIN_ID, p_limit: 50 },
    );
    expect(providerAuditQuery?.select).toHaveBeenCalled();
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
    expect(serialized).not.toContain("private-lease-token");
    expect(serialized).not.toContain("private-provider-model");
    expect(serialized).not.toContain("deleted-private-case");
    expect(serialized).not.toContain("deleted-private-user");
    expect(serialized).not.toContain("deleted private statement");
    expect(serialized).not.toContain("deleted-private-verdict");
    expect(serialized).not.toContain("handoff_state");
    expect(serialized).not.toContain("audit_cost_usd");
    expect(serialized).not.toContain(PROVIDER_REQUEST_KEY);
    expect(serialized).not.toContain("d".repeat(64));
    expect(serialized).not.toMatch(/[a-f0-9]{64}/);
  });

  it("rejects unauthenticated access before creating a service query", async () => {
    mocks.verifyAdmin.mockResolvedValue({ authorized: false });

    const response = await GET(new Request("https://hanbang.ai/api/admin/couple-court"));

    expect(response.status).toBe(401);
    expect(mocks.getServiceClient).not.toHaveBeenCalled();
  });

  it("rejects an unauthenticated mutation without consuming the admin rate limit", async () => {
    mocks.verifyAdmin.mockResolvedValue({ authorized: false });

    const response = await POST(mutationRequest({
      target: "post",
      id: POST_ID,
      decision: "approve",
    }));

    expect(response.status).toBe(401);
    expect(mocks.checkRateLimitPersistent).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("blocks cross-site JSON mutations before calling a moderation RPC", async () => {
    const response = await POST(mutationRequest(
      { target: "post", id: POST_ID, decision: "approve" },
      "https://attacker.example",
    ));

    expect(response.status).toBe(403);
    expect(mocks.checkRateLimitPersistent).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("returns a persistent rate-limit response without invoking a moderation RPC", async () => {
    mocks.checkRateLimitPersistent.mockResolvedValueOnce(Response.json(
      { error: "요청이 너무 많습니다." },
      { status: 429 },
    ));

    const request = mutationRequest({
      target: "post",
      id: POST_ID,
      decision: "approve",
    });
    const response = await POST(request);

    expect(response.status).toBe(429);
    expect(mocks.rateLimitKey).toHaveBeenCalledWith(
      "couple-court:admin:mutation",
      request,
      ADMIN_ID,
    );
    expect(mocks.checkRateLimitPersistent).toHaveBeenCalledWith(
      `couple-court:admin:mutation:${ADMIN_ID}`,
      { maxRequests: 120, windowMs: 60 * 60 * 1000 },
      ADMIN_ID,
    );
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

  it.each([
    "provider_reconciliation_reveal",
    "provider_deletion_handoff_reveal",
  ])("requires two-step confirmation before revealing one request key for %s", async (target) => {
    const response = await POST(mutationRequest({
      target,
      id: VERDICT_ID,
      decision: "reveal_request_key",
      confirmation: "SHOW_ME_EVERY_KEY",
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual(expect.objectContaining({
      code: "PROVIDER_REQUEST_KEY_REVEAL_CONFIRMATION_REQUIRED",
    }));
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it.each([
    {
      target: "provider_reconciliation_reveal",
      rpc: "reveal_court_provider_reconciliation_request_key",
    },
    {
      target: "provider_deletion_handoff_reveal",
      rpc: "reveal_court_provider_deletion_handoff_request_key",
    },
  ])("reveals exactly one audited request key through $rpc", async ({ target, rpc }) => {
    mocks.rpc.mockResolvedValueOnce({
      data: {
        verdict_id: VERDICT_ID,
        request_key: PROVIDER_REQUEST_KEY,
        revealed_at: "2026-07-14T04:00:00.000Z",
        audit_id: "private-server-audit-id",
        case_id: "private-case-id",
      },
      error: null,
    });

    const response = await POST(mutationRequest({
      target,
      id: VERDICT_ID,
      decision: "reveal_request_key",
      confirmation: "REVEAL_PROVIDER_REQUEST_KEY",
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith(rpc, {
      p_verdict_id: VERDICT_ID,
      p_admin_user_id: ADMIN_ID,
      p_confirmation: "REVEAL_PROVIDER_REQUEST_KEY",
    });
    expect(mocks.rateLimitKey).toHaveBeenCalledWith(
      "couple-court:admin:request-key-reveal",
      expect.any(Request),
      ADMIN_ID,
    );
    expect(mocks.checkRateLimitPersistent).toHaveBeenCalledWith(
      `couple-court:admin:request-key-reveal:${ADMIN_ID}`,
      { maxRequests: 20, windowMs: 60 * 60 * 1000 },
      ADMIN_ID,
    );
    expect(body).toEqual({
      ok: true,
      target,
      action: rpc,
      requestKey: PROVIDER_REQUEST_KEY,
      revealedAt: "2026-07-14T04:00:00.000Z",
    });
    expect(JSON.stringify(body)).not.toContain("private-server-audit-id");
    expect(JSON.stringify(body)).not.toContain("private-case-id");
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
  });

  it("fails closed without exposing a key when the reveal RPC contract is malformed", async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: {
        verdict_id: "00000000-0000-4000-8000-000000000099",
        request_key: PROVIDER_REQUEST_KEY,
        revealed_at: "2026-07-14T04:00:00.000Z",
      },
      error: null,
    });

    const response = await POST(mutationRequest({
      target: "provider_reconciliation_reveal",
      id: VERDICT_ID,
      decision: "reveal_request_key",
      confirmation: "REVEAL_PROVIDER_REQUEST_KEY",
    }));
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toEqual(expect.objectContaining({
      code: "PROVIDER_REQUEST_KEY_REVEAL_CONTRACT_INVALID",
    }));
    expect(JSON.stringify(body)).not.toContain(PROVIDER_REQUEST_KEY);
  });

  it.each([
    {
      label: "uses the wrong paid confirmation",
      body: {
        target: "provider_deletion_handoff",
        id: DELETED_VERDICT_ID,
        decision: "record_paid",
        confirmation: "CONFIRM_PROVIDER_NO_CHARGE",
        auditModel: "gpt-5.6-terra",
      },
      code: "PROVIDER_DELETION_HANDOFF_CONFIRMATION_REQUIRED",
    },
    {
      label: "omits the model for a paid call",
      body: {
        target: "provider_deletion_handoff",
        id: DELETED_VERDICT_ID,
        decision: "record_paid",
        confirmation: "CONFIRM_PROVIDER_PAID",
      },
      code: "INVALID_PROVIDER_MODEL",
    },
    {
      label: "provides only one side of token usage",
      body: {
        target: "provider_deletion_handoff",
        id: DELETED_VERDICT_ID,
        decision: "record_paid",
        confirmation: "CONFIRM_PROVIDER_PAID",
        auditModel: "gpt-5.6-terra",
        inputTokens: 10,
      },
      code: "INVALID_PROVIDER_USAGE",
    },
    {
      label: "omits all usage needed by deleted audit recovery",
      body: {
        target: "provider_deletion_handoff",
        id: DELETED_VERDICT_ID,
        decision: "record_paid",
        confirmation: "CONFIRM_PROVIDER_PAID",
        auditModel: "gpt-5.6-terra",
        costUsd: 0.0042,
      },
      code: "INVALID_PROVIDER_USAGE",
    },
    {
      label: "provides a fractional token count",
      body: {
        target: "provider_deletion_handoff",
        id: DELETED_VERDICT_ID,
        decision: "record_paid",
        confirmation: "CONFIRM_PROVIDER_PAID",
        auditModel: "gpt-5.6-terra",
        inputTokens: 10.5,
        outputTokens: 3,
      },
      code: "INVALID_PROVIDER_USAGE",
    },
    {
      label: "provides cached usage larger than input usage",
      body: {
        target: "provider_deletion_handoff",
        id: DELETED_VERDICT_ID,
        decision: "record_paid",
        confirmation: "CONFIRM_PROVIDER_PAID",
        auditModel: "gpt-5.6-terra",
        inputTokens: 10,
        outputTokens: 3,
        cachedInputTokens: 11,
      },
      code: "INVALID_PROVIDER_USAGE",
    },
    {
      label: "provides more than six cost decimals",
      body: {
        target: "provider_deletion_handoff",
        id: DELETED_VERDICT_ID,
        decision: "record_paid",
        confirmation: "CONFIRM_PROVIDER_PAID",
        auditModel: "gpt-5.6-terra",
        costUsd: 0.1234567,
      },
      code: "INVALID_PROVIDER_COST",
    },
    {
      label: "provides a cost outside the numeric ledger domain",
      body: {
        target: "provider_deletion_handoff",
        id: DELETED_VERDICT_ID,
        decision: "record_paid",
        confirmation: "CONFIRM_PROVIDER_PAID",
        auditModel: "gpt-5.6-terra",
        costUsd: 10_000,
      },
      code: "INVALID_PROVIDER_COST",
    },
    {
      label: "mixes paid evidence into a no-charge decision",
      body: {
        target: "provider_deletion_handoff",
        id: DELETED_VERDICT_ID,
        decision: "confirm_no_charge",
        confirmation: "CONFIRM_PROVIDER_NO_CHARGE",
        auditModel: "gpt-5.6-terra",
      },
      code: "PROVIDER_DELETION_HANDOFF_NO_CHARGE_FIELDS_REJECTED",
    },
    {
      label: "includes an unapproved free-form field",
      body: {
        target: "provider_deletion_handoff",
        id: DELETED_VERDICT_ID,
        decision: "confirm_no_charge",
        confirmation: "CONFIRM_PROVIDER_NO_CHARGE",
        privateNote: "must never cross the boundary",
      },
      code: "INVALID_PROVIDER_DELETION_HANDOFF_FIELD",
    },
  ])("rejects a deleted-subject resolution that $label", async ({ body, code }) => {
    const response = await POST(mutationRequest(body));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual(expect.objectContaining({ code }));
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

  it("recovers a deleted subject with a payload-free audit and exposes no identity", async () => {
    const events: string[] = [];
    mocks.rpc.mockImplementation(async (name: string) => {
      if (name === "claim_court_provider_audit_recovery") {
        events.push("claim");
        return { data: deletedProviderAuditClaim(), error: null };
      }
      if (name === "finalize_court_provider_audit") {
        events.push("finalize");
        return {
          data: {
            verdict_id: VERDICT_ID,
            provider_audit_state: "audited",
            subject_deleted: true,
          },
          error: null,
        };
      }
      throw new Error(`unexpected RPC ${name}`);
    });
    mocks.logAIInteraction.mockImplementation(async () => {
      events.push("audit");
    });

    const response = await POST(mutationRequest({
      target: "provider_audit_recovery",
      decision: "recover_one",
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(events).toEqual(["claim", "audit", "finalize"]);
    expect(mocks.logRecoveredCourtVerdictAudit).not.toHaveBeenCalled();
    expect(mocks.logAIInteraction).toHaveBeenCalledWith({
      userId: null,
      coupleId: null,
      sessionId: null,
      messageId: null,
      interactionType: "couple_court_verdict",
      specialistType: null,
      userInput: null,
      aiOutput: null,
      toolName: null,
      toolInput: null,
      toolOutput: null,
      latencyMs: 0,
      success: true,
      errorMessage: null,
      model: "gpt-5.6-terra",
      tokensInput: 301,
      tokensOutput: 410,
      cacheReadTokens: 25,
      cacheWriteTokens: 0,
      costUsd: 0.0042,
      metadata: null,
      idempotencyKey: PROVIDER_REQUEST_KEY,
      required: true,
      expectedSubjectDeleted: true,
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
      providerState: null,
    });
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain(VERDICT_ID);
    expect(serialized).not.toContain(PROVIDER_REQUEST_KEY);
    expect(serialized).not.toContain("gpt-5.6-terra");
  });

  it("rejects extra deleted-claim payload fields and records a bounded failure", async () => {
    mocks.rpc.mockImplementation(async (name: string) => {
      if (name === "claim_court_provider_audit_recovery") {
        return {
          data: deletedProviderAuditClaim({
            staged_result_json: { private: "must-not-be-consumed" },
          }),
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
    expect(mocks.logAIInteraction).not.toHaveBeenCalled();
    expect(mocks.rpc).toHaveBeenCalledWith(
      "record_court_provider_audit_recovery_failure",
      expect.objectContaining({ p_error_code: "recovery_claim_invalid" }),
    );
  });

  it("rejects a deleted-claim cost outside the numeric(10,6) ledger boundary", async () => {
    mocks.rpc.mockImplementation(async (name: string) => {
      if (name === "claim_court_provider_audit_recovery") {
        return {
          data: deletedProviderAuditClaim({ audit_cost_usd: 10_000 }),
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
    expect(mocks.logAIInteraction).not.toHaveBeenCalled();
    expect(mocks.rpc).toHaveBeenCalledWith(
      "record_court_provider_audit_recovery_failure",
      expect.objectContaining({ p_error_code: "recovery_claim_invalid" }),
    );
  });

  it("derives a deleted-subject audit cost when no exact stored cost exists", async () => {
    mocks.rpc.mockImplementation(async (name: string) => {
      if (name === "claim_court_provider_audit_recovery") {
        return {
          data: deletedProviderAuditClaim({ audit_cost_usd: null }),
          error: null,
        };
      }
      if (name === "finalize_court_provider_audit") {
        return {
          data: {
            verdict_id: VERDICT_ID,
            provider_audit_state: "audited",
            subject_deleted: true,
          },
          error: null,
        };
      }
      throw new Error(`unexpected RPC ${name}`);
    });

    const response = await POST(mutationRequest({
      target: "provider_audit_recovery",
      decision: "recover_one",
    }));

    expect(response.status).toBe(200);
    const auditInput = mocks.logAIInteraction.mock.calls[0]?.[0] as
      | Record<string, unknown>
      | undefined;
    expect(auditInput).toBeDefined();
    expect(Object.prototype.hasOwnProperty.call(auditInput, "costUsd")).toBe(false);
  });

  it("records a deleted-subject audit-write failure without finalizing", async () => {
    mocks.rpc.mockImplementation(async (name: string) => {
      if (name === "claim_court_provider_audit_recovery") {
        return { data: deletedProviderAuditClaim(), error: null };
      }
      if (name === "record_court_provider_audit_recovery_failure") {
        return { data: { provider_audit_state: "pending" }, error: null };
      }
      throw new Error(`unexpected RPC ${name}`);
    });
    mocks.logAIInteraction.mockRejectedValueOnce(new Error("deleted audit unavailable"));

    const response = await POST(mutationRequest({
      target: "provider_audit_recovery",
      decision: "recover_one",
    }));

    expect(response.status).toBe(503);
    expect(mocks.rpc).toHaveBeenCalledWith(
      "record_court_provider_audit_recovery_failure",
      expect.objectContaining({ p_error_code: "required_audit_write_failed" }),
    );
    expect(mocks.rpc).not.toHaveBeenCalledWith(
      "finalize_court_provider_audit",
      expect.anything(),
    );
  });

  it("fails closed when deleted-subject finalization crosses back to a live row", async () => {
    mocks.rpc.mockImplementation(async (name: string) => {
      if (name === "claim_court_provider_audit_recovery") {
        return { data: deletedProviderAuditClaim(), error: null };
      }
      if (name === "finalize_court_provider_audit") {
        return {
          data: {
            verdict_id: VERDICT_ID,
            provider_audit_state: "audited",
            subject_deleted: false,
          },
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
    expect(mocks.rpc).toHaveBeenCalledWith(
      "record_court_provider_audit_recovery_failure",
      expect.objectContaining({ p_error_code: "audit_finalize_failed" }),
    );
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
    {
      body: {
        target: "provider_deletion_handoff",
        id: DELETED_VERDICT_ID,
        decision: "confirm_no_charge",
        confirmation: "CONFIRM_PROVIDER_NO_CHARGE",
      },
      rpc: "resolve_court_provider_deletion_handoff",
      args: {
        p_verdict_id: DELETED_VERDICT_ID,
        p_admin_user_id: ADMIN_ID,
        p_action: "confirm_no_charge",
        p_confirmation: "CONFIRM_PROVIDER_NO_CHARGE",
        p_audit_model: null,
        p_input_tokens: null,
        p_output_tokens: null,
        p_cached_input_tokens: null,
        p_cache_write_input_tokens: null,
        p_cost_usd: null,
      },
    },
    {
      body: {
        target: "provider_deletion_handoff",
        id: DELETED_VERDICT_ID,
        decision: "record_paid",
        confirmation: "CONFIRM_PROVIDER_PAID",
        auditModel: "gpt-5.6-terra",
        inputTokens: 301,
        outputTokens: 410,
        cachedInputTokens: 25,
        cacheWriteInputTokens: 0,
        costUsd: 0.0042,
      },
      rpc: "resolve_court_provider_deletion_handoff",
      args: {
        p_verdict_id: DELETED_VERDICT_ID,
        p_admin_user_id: ADMIN_ID,
        p_action: "record_paid",
        p_confirmation: "CONFIRM_PROVIDER_PAID",
        p_audit_model: "gpt-5.6-terra",
        p_input_tokens: 301,
        p_output_tokens: 410,
        p_cached_input_tokens: 25,
        p_cache_write_input_tokens: 0,
        p_cost_usd: 0.0042,
      },
    },
  ])("routes $rpc through the service-only RPC with the authenticated reviewer", async ({ body, rpc, args }) => {
    const response = await POST(mutationRequest(body));

    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith(rpc, args);
    await expect(response.json()).resolves.toEqual({ ok: true, target: body.target, action: rpc });
  });

  it("fails closed when a deleted-subject settlement changed or expired concurrently", async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: { private_database_value: "must-not-return" },
      error: { code: "55000" },
    });

    const response = await POST(mutationRequest({
      target: "provider_deletion_handoff",
      id: DELETED_VERDICT_ID,
      decision: "confirm_no_charge",
      confirmation: "CONFIRM_PROVIDER_NO_CHARGE",
    }));
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toEqual(expect.objectContaining({
      code: "PROVIDER_DELETION_HANDOFF_RESOLUTION_REJECTED",
    }));
    expect(JSON.stringify(body)).not.toContain("private_database_value");
  });
});
