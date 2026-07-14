import { NextResponse } from "next/server";
import {
  CourtApiError,
  courtErrorResponse,
  noStoreJson,
  readCourtJson,
} from "@/app/api/couple-court/_shared";
import { recoverOneCourtProviderAudit } from "@/lib/coupleCourt/providerAuditRecovery";
import { getServiceClient, verifyAdmin } from "@/lib/utils/adminAuth";
import { checkRateLimitPersistent, rateLimitKey } from "@/utils/rateLimit";
import { isRecord } from "@/utils/requestValidation";

const QUEUE_LIMIT = 50;
const ADMIN_MUTATION_RATE_LIMIT = {
  maxRequests: 120,
  windowMs: 60 * 60 * 1000,
} as const;
const ADMIN_REQUEST_KEY_REVEAL_RATE_LIMIT = {
  maxRequests: 20,
  windowMs: 60 * 60 * 1000,
} as const;
const POST_FIELDS = [
  "id",
  "sanitized_snapshot_json",
  "snapshot_version",
  "status",
  "moderation_status",
  "moderation_reason_code",
  "comments_enabled",
  "published_at",
  "created_at",
  "updated_at",
].join(",");

const COMMENT_FIELDS = [
  "id",
  "public_post_id",
  "comment_type",
  "body",
  "moderation_status",
  "created_at",
].join(",");

const REPORT_FIELDS = [
  "id",
  "public_post_id",
  "comment_id",
  "target_type",
  "reason_code",
  "status",
  "created_at",
].join(",");

// This is the complete browser-visible audit recovery allowlist. It excludes
// verdict/case IDs, request keys/hashes, user/couple IDs, audit metadata,
// token usage, and staged verdict/mission payloads.
const PROVIDER_AUDIT_RECOVERY_FIELDS = [
  "provider_state",
  "provider_error_code",
  "provider_audit_pending_at",
  "provider_audit_recovery_attempt_count",
  "provider_audit_recovery_last_error_code",
  "provider_audit_recovery_last_error_at",
].join(",");

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REASON_CODES = new Set([
  "pii",
  "harassment",
  "threat",
  "hate",
  "spam",
  "minor_safety",
  "unsafe_content",
  "consent_issue",
  "abusive_content",
  "off_topic",
  "duplicate",
  "policy_violation",
  "no_violation",
  "other",
]);

const POST_DECISIONS = new Set(["approve", "reject", "hidden"]);
const COMMENT_DECISIONS = new Set(["approve", "hide", "reject"]);
const REPORT_DECISIONS = new Set(["start_review", "dismiss", "hide_content"]);
const PROVIDER_RECONCILIATION_REASONS = new Set([
  "provider_dashboard_not_found",
  "provider_dashboard_failed",
  "provider_support_approved_retry",
]);
const PROVIDER_RETRY_CONFIRMATION = "ALLOW_RETRY_AFTER_PROVIDER_REVIEW";
const PROVIDER_NO_CHARGE_CONFIRMATION = "CONFIRM_PROVIDER_NO_CHARGE";
const PROVIDER_PAID_CONFIRMATION = "CONFIRM_PROVIDER_PAID";
const PROVIDER_REQUEST_KEY_REVEAL_CONFIRMATION = "REVEAL_PROVIDER_REQUEST_KEY";
const PROVIDER_DELETION_DECISIONS = new Set(["confirm_no_charge", "record_paid"]);
const PROVIDER_MODEL_PATTERN = /^[A-Za-z0-9._:/-]{1,128}$/;
const PROVIDER_DELETION_HANDOFF_FIELDS_ALLOWED = new Set([
  "target",
  "id",
  "decision",
  "confirmation",
  "auditModel",
  "inputTokens",
  "outputTokens",
  "cachedInputTokens",
  "cacheWriteInputTokens",
  "costUsd",
]);
const PROVIDER_REQUEST_KEY_REVEAL_FIELDS_ALLOWED = new Set([
  "target",
  "id",
  "decision",
  "confirmation",
]);

function requireUuid(value: unknown): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw new CourtApiError(400, "INVALID_TARGET_ID", "검토 대상 ID를 확인해 주세요.");
  }
  return value;
}

function optionalReasonCode(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || !REASON_CODES.has(value)) {
    throw new CourtApiError(400, "INVALID_REASON_CODE", "검토 사유 코드를 확인해 주세요.");
  }
  return value;
}

function requireProviderReasonCode(value: unknown): string {
  if (typeof value !== "string" || !PROVIDER_RECONCILIATION_REASONS.has(value)) {
    throw new CourtApiError(
      400,
      "INVALID_PROVIDER_RECONCILIATION_REASON",
      "제공사 확인 결과에 맞는 재시도 사유를 선택해 주세요.",
    );
  }
  return value;
}

function requireDecision(value: unknown, allowed: Set<string>): string {
  if (typeof value !== "string" || !allowed.has(value)) {
    throw new CourtApiError(400, "INVALID_MODERATION_DECISION", "검토 결정을 확인해 주세요.");
  }
  return value;
}

function requireReason(reasonCode: string | null): string {
  if (!reasonCode) {
    throw new CourtApiError(400, "MODERATION_REASON_REQUIRED", "이 조치에는 검토 사유가 필요합니다.");
  }
  return reasonCode;
}

function stringField(row: Record<string, unknown>, key: string): string | null {
  const value = row[key];
  return typeof value === "string" ? value : null;
}

function sanitizePublicSnapshot(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value)) return null;

  const safeTitle = typeof value.safeTitle === "string" ? value.safeTitle : null;
  const oneLine = typeof value.oneLine === "string" ? value.oneLine : null;
  const resultLabel = typeof value.resultLabel === "string" ? value.resultLabel : null;
  const category = typeof value.category === "string" ? value.category : null;
  const mode = typeof value.mode === "string" ? value.mode : null;
  const snapshotVersion = typeof value.snapshotVersion === "string"
    ? value.snapshotVersion
    : null;
  if (!safeTitle || !oneLine || !resultLabel || !category || !mode || !snapshotVersion) {
    return null;
  }

  return {
    snapshotVersion,
    category,
    mode,
    provisional: value.provisional === true,
    safeTitle,
    oneLine,
    resultLabel,
    hashtags: Array.isArray(value.hashtags)
      ? value.hashtags.filter((item): item is string => typeof item === "string").slice(0, 5)
      : [],
  };
}

function mapPost(value: unknown) {
  if (!isRecord(value)) return null;
  const id = stringField(value, "id");
  const snapshot = sanitizePublicSnapshot(value.sanitized_snapshot_json);
  if (!id || !snapshot) return null;

  return {
    id,
    snapshot,
    snapshotVersion: typeof value.snapshot_version === "number" ? value.snapshot_version : null,
    status: stringField(value, "status"),
    moderationStatus: stringField(value, "moderation_status"),
    moderationReasonCode: stringField(value, "moderation_reason_code"),
    commentsEnabled: value.comments_enabled === true,
    publishedAt: stringField(value, "published_at"),
    createdAt: stringField(value, "created_at"),
    updatedAt: stringField(value, "updated_at"),
  };
}

function mapPendingComment(value: unknown) {
  if (!isRecord(value)) return null;
  const id = stringField(value, "id");
  const publicPostId = stringField(value, "public_post_id");
  const body = stringField(value, "body");
  if (!id || !publicPostId || !body) return null;

  return {
    id,
    publicPostId,
    commentType: stringField(value, "comment_type"),
    body: body.slice(0, 1000),
    moderationStatus: stringField(value, "moderation_status"),
    createdAt: stringField(value, "created_at"),
  };
}

function mapOpenReport(value: unknown) {
  if (!isRecord(value)) return null;
  const id = stringField(value, "id");
  const publicPostId = stringField(value, "public_post_id");
  if (!id || !publicPostId) return null;

  return {
    id,
    publicPostId,
    commentId: stringField(value, "comment_id"),
    targetType: stringField(value, "target_type"),
    reasonCode: stringField(value, "reason_code"),
    status: stringField(value, "status"),
    createdAt: stringField(value, "created_at"),
  };
}

function mapProviderReconciliation(value: unknown) {
  if (!isRecord(value)) return null;
  const verdictId = stringField(value, "verdict_id");
  if (!verdictId || !UUID_PATTERN.test(verdictId)) return null;
  return {
    verdictId,
    providerState: stringField(value, "provider_state"),
    startedAt: stringField(value, "started_at"),
    failedAt: stringField(value, "failed_at"),
    errorCode: stringField(value, "provider_error_code"),
    createdAt: stringField(value, "created_at"),
    updatedAt: stringField(value, "updated_at"),
  };
}

function mapProviderAuditRecovery(value: unknown) {
  if (!isRecord(value)) return null;
  const providerState = stringField(value, "provider_state");
  const pendingAt = stringField(value, "provider_audit_pending_at");
  const attemptCount = value.provider_audit_recovery_attempt_count;
  if (
    (providerState !== "result_staged" && providerState !== "failed_invalid")
    || !pendingAt
    || !Number.isFinite(Date.parse(pendingAt))
    || typeof attemptCount !== "number"
    || !Number.isSafeInteger(attemptCount)
    || attemptCount < 0
    || attemptCount > 10_000
  ) return null;
  return {
    providerState,
    errorCode: stringField(value, "provider_error_code"),
    pendingAt,
    attemptCount,
    lastErrorCode: stringField(value, "provider_audit_recovery_last_error_code"),
    lastErrorAt: stringField(value, "provider_audit_recovery_last_error_at"),
  };
}

function mapProviderDeletionHandoff(value: unknown) {
  if (!isRecord(value)) return null;
  const verdictId = stringField(value, "verdict_id");
  const createdAt = stringField(value, "created_at");
  const expiresAt = stringField(value, "expires_at");
  const createdAtMs = createdAt ? Date.parse(createdAt) : Number.NaN;
  const expiresAtMs = expiresAt ? Date.parse(expiresAt) : Number.NaN;
  if (
    !verdictId
    || !UUID_PATTERN.test(verdictId)
    || !createdAt
    || !Number.isFinite(createdAtMs)
    || !expiresAt
    || !Number.isFinite(expiresAtMs)
    || expiresAtMs <= createdAtMs
  ) return null;
  return { verdictId, createdAt, expiresAt };
}

function providerRequestKeyRevealArguments(
  body: Record<string, unknown>,
  verdictId: string,
  adminUserId: string,
): Record<string, unknown> {
  for (const field of Object.keys(body)) {
    if (!PROVIDER_REQUEST_KEY_REVEAL_FIELDS_ALLOWED.has(field)) {
      throw new CourtApiError(
        400,
        "INVALID_PROVIDER_REQUEST_KEY_REVEAL_FIELD",
        "OpenAI 요청 키 공개에는 허용된 운영 정보만 입력할 수 있습니다.",
      );
    }
  }
  if (body.decision !== "reveal_request_key"
    || body.confirmation !== PROVIDER_REQUEST_KEY_REVEAL_CONFIRMATION
  ) {
    throw new CourtApiError(
      400,
      "PROVIDER_REQUEST_KEY_REVEAL_CONFIRMATION_REQUIRED",
      "요청 키 공개 범위를 확인한 뒤 고정 확인 문구를 정확히 입력해 주세요.",
    );
  }
  return {
    p_verdict_id: verdictId,
    p_admin_user_id: adminUserId,
    p_confirmation: PROVIDER_REQUEST_KEY_REVEAL_CONFIRMATION,
  };
}

function optionalProviderToken(value: unknown, field: string): number | null {
  if (value === undefined || value === null) return null;
  if (
    typeof value !== "number"
    || !Number.isSafeInteger(value)
    || value < 0
    || value > 10_000_000
  ) {
    throw new CourtApiError(
      400,
      "INVALID_PROVIDER_USAGE",
      `${field} 값은 0~10,000,000 범위의 정수여야 합니다.`,
    );
  }
  return value;
}

function optionalProviderCost(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  if (
    typeof value !== "number"
    || !Number.isFinite(value)
    || value < 0
    || value > 9_999.999999
  ) {
    throw new CourtApiError(
      400,
      "INVALID_PROVIDER_COST",
      "제공사 비용은 0 이상 9,999.999999 이하의 숫자여야 합니다.",
    );
  }
  const canonical = Math.round(value * 1_000_000) / 1_000_000;
  if (Math.abs(value - canonical) > Number.EPSILON * Math.max(1, Math.abs(value))) {
    throw new CourtApiError(
      400,
      "INVALID_PROVIDER_COST",
      "제공사 비용은 소수점 아래 6자리까지만 입력할 수 있습니다.",
    );
  }
  return canonical;
}

function providerDeletionResolutionArguments(
  body: Record<string, unknown>,
  verdictId: string,
  adminUserId: string,
): Record<string, unknown> {
  for (const field of Object.keys(body)) {
    if (!PROVIDER_DELETION_HANDOFF_FIELDS_ALLOWED.has(field)) {
      throw new CourtApiError(
        400,
        "INVALID_PROVIDER_DELETION_HANDOFF_FIELD",
        "삭제된 사건의 제공사 정산에는 허용된 운영 정보만 입력할 수 있습니다.",
      );
    }
  }

  const decision = requireDecision(body.decision, PROVIDER_DELETION_DECISIONS);
  const expectedConfirmation = decision === "confirm_no_charge"
    ? PROVIDER_NO_CHARGE_CONFIRMATION
    : PROVIDER_PAID_CONFIRMATION;
  if (body.confirmation !== expectedConfirmation) {
    throw new CourtApiError(
      400,
      "PROVIDER_DELETION_HANDOFF_CONFIRMATION_REQUIRED",
      "OpenAI 제공사 기록을 확인한 뒤 고정 확인 문구를 정확히 입력해 주세요.",
    );
  }

  const auditModel = body.auditModel === undefined || body.auditModel === null
    ? null
    : body.auditModel;
  const inputTokens = optionalProviderToken(body.inputTokens, "입력 토큰");
  const outputTokens = optionalProviderToken(body.outputTokens, "출력 토큰");
  const cachedInputTokens = optionalProviderToken(body.cachedInputTokens, "캐시 입력 토큰");
  const cacheWriteInputTokens = optionalProviderToken(
    body.cacheWriteInputTokens,
    "캐시 쓰기 입력 토큰",
  );
  const costUsd = optionalProviderCost(body.costUsd);

  if (decision === "confirm_no_charge") {
    if (
      auditModel !== null
      || inputTokens !== null
      || outputTokens !== null
      || cachedInputTokens !== null
      || cacheWriteInputTokens !== null
      || costUsd !== null
    ) {
      throw new CourtApiError(
        400,
        "PROVIDER_DELETION_HANDOFF_NO_CHARGE_FIELDS_REJECTED",
        "청구 없음 정산에는 모델, 사용량, 비용을 함께 기록할 수 없습니다.",
      );
    }
  } else {
    if (typeof auditModel !== "string" || !PROVIDER_MODEL_PATTERN.test(auditModel)) {
      throw new CourtApiError(
        400,
        "INVALID_PROVIDER_MODEL",
        "유료 호출로 기록할 때는 OpenAI 제공사 모델명이 필요합니다.",
      );
    }
    if (inputTokens === null || outputTokens === null) {
      throw new CourtApiError(
        400,
        "INVALID_PROVIDER_USAGE",
        "유료 호출로 기록할 때는 입력 토큰과 출력 토큰이 모두 필요합니다.",
      );
    }
    if (
      (cachedInputTokens !== null && cachedInputTokens > inputTokens)
      || (cacheWriteInputTokens !== null && cacheWriteInputTokens > inputTokens)
    ) {
      throw new CourtApiError(
        400,
        "INVALID_PROVIDER_USAGE",
        "캐시 토큰은 입력 토큰보다 클 수 없습니다.",
      );
    }
  }

  return {
    p_verdict_id: verdictId,
    p_admin_user_id: adminUserId,
    p_action: decision,
    p_confirmation: expectedConfirmation,
    p_audit_model: auditModel,
    p_input_tokens: inputTokens,
    p_output_tokens: outputTokens,
    p_cached_input_tokens: cachedInputTokens,
    p_cache_write_input_tokens: cacheWriteInputTokens,
    p_cost_usd: costUsd,
  };
}

function unauthorizedResponse(): NextResponse {
  return noStoreJson(
    { code: "ADMIN_AUTH_REQUIRED", error: "관리자 인증이 필요합니다." },
    { status: 401 },
  );
}

export async function GET(request: Request) {
  try {
    const { authorized, userId } = await verifyAdmin(request);
    if (!authorized || !userId) return unauthorizedResponse();

    const service = getServiceClient();
    const [
      postResult,
      commentResult,
      reportResult,
      providerResult,
      providerAuditResult,
      providerDeletionHandoffResult,
    ] = await Promise.all([
      service
        .from("court_public_posts")
        .select(POST_FIELDS)
        .eq("status", "pending_review")
        .eq("moderation_status", "pending")
        .order("created_at", { ascending: true })
        .limit(QUEUE_LIMIT),
      service
        .from("court_comments")
        .select(COMMENT_FIELDS)
        .eq("moderation_status", "pending")
        .is("deleted_at", null)
        .order("created_at", { ascending: true })
        .limit(QUEUE_LIMIT),
      service
        .from("court_reports")
        .select(REPORT_FIELDS)
        .in("status", ["open", "reviewing"])
        .order("created_at", { ascending: true })
        .limit(QUEUE_LIMIT),
      service.rpc("list_court_provider_reconciliations", {
        p_actor_id: userId,
        p_limit: QUEUE_LIMIT,
      }),
      service
        .from("court_provider_reservations")
        .select(PROVIDER_AUDIT_RECOVERY_FIELDS)
        .eq("provider_audit_state", "pending")
        .order("provider_audit_pending_at", { ascending: true })
        .limit(QUEUE_LIMIT),
      service.rpc("list_court_provider_deletion_handoffs", {
        p_actor_id: userId,
        p_limit: QUEUE_LIMIT,
      }),
    ]);

    if (
      postResult.error
      || commentResult.error
      || reportResult.error
      || providerResult.error
      || providerAuditResult.error
      || providerDeletionHandoffResult.error
    ) {
      throw new CourtApiError(
        503,
        "MODERATION_QUEUE_UNAVAILABLE",
        "검토 대기열을 불러올 수 없습니다. 잠시 후 다시 시도해 주세요.",
      );
    }

    const posts = ((postResult.data ?? []) as unknown[])
      .map(mapPost)
      .filter((item): item is NonNullable<ReturnType<typeof mapPost>> => item !== null);
    const comments = ((commentResult.data ?? []) as unknown[])
      .map(mapPendingComment)
      .filter((item): item is NonNullable<ReturnType<typeof mapPendingComment>> => item !== null);
    const reports = ((reportResult.data ?? []) as unknown[])
      .map(mapOpenReport)
      .filter((item): item is NonNullable<ReturnType<typeof mapOpenReport>> => item !== null);
    const providerReconciliations = ((providerResult.data ?? []) as unknown[])
      .map(mapProviderReconciliation)
      .filter((item): item is NonNullable<ReturnType<typeof mapProviderReconciliation>> => item !== null);
    const providerAuditRecoveries = ((providerAuditResult.data ?? []) as unknown[])
      .map(mapProviderAuditRecovery)
      .filter((item): item is NonNullable<ReturnType<typeof mapProviderAuditRecovery>> => item !== null);
    const providerDeletionHandoffs = ((providerDeletionHandoffResult.data ?? []) as unknown[])
      .map(mapProviderDeletionHandoff)
      .filter((item): item is NonNullable<ReturnType<typeof mapProviderDeletionHandoff>> => item !== null);
    const reportedCommentIds = reports
      .map((report) => report.commentId)
      .filter((id): id is string => Boolean(id));
    let reportedComments: NonNullable<ReturnType<typeof mapPendingComment>>[] = [];
    if (reportedCommentIds.length > 0) {
      const reportedCommentResult = await service
        .from("court_comments")
        .select(COMMENT_FIELDS)
        .in("id", reportedCommentIds.slice(0, QUEUE_LIMIT))
        .is("deleted_at", null);
      if (reportedCommentResult.error) {
        throw new CourtApiError(
          503,
          "MODERATION_QUEUE_UNAVAILABLE",
          "신고된 댓글 내용을 불러올 수 없습니다. 잠시 후 다시 시도해 주세요.",
        );
      }
      reportedComments = ((reportedCommentResult.data ?? []) as unknown[])
        .map(mapPendingComment)
        .filter((item): item is NonNullable<ReturnType<typeof mapPendingComment>> => item !== null);
    }

    const loadedPostIds = new Set(posts.map((post) => post.id));
    const referencedPostIds = [
      ...comments.map((comment) => comment.publicPostId),
      ...reports.map((report) => report.publicPostId),
    ].filter((id, index, values) => !loadedPostIds.has(id) && values.indexOf(id) === index);

    for (let offset = 0; offset < referencedPostIds.length; offset += QUEUE_LIMIT) {
      const ids = referencedPostIds.slice(offset, offset + QUEUE_LIMIT);
      const referencedResult = await service
        .from("court_public_posts")
        .select(POST_FIELDS)
        .in("id", ids);
      if (referencedResult.error) {
        throw new CourtApiError(
          503,
          "MODERATION_QUEUE_UNAVAILABLE",
          "검토 대기열을 불러올 수 없습니다. 잠시 후 다시 시도해 주세요.",
        );
      }
      for (const row of (referencedResult.data ?? []) as unknown[]) {
        const post = mapPost(row);
        if (post && !loadedPostIds.has(post.id)) {
          posts.push(post);
          loadedPostIds.add(post.id);
        }
      }
    }

    return noStoreJson({
      posts,
      comments,
      reports,
      reportedComments,
      providerReconciliations,
      providerAuditRecoveries,
      providerDeletionHandoffs,
      truncated: {
        posts: (postResult.data?.length ?? 0) >= QUEUE_LIMIT,
        comments: (commentResult.data?.length ?? 0) >= QUEUE_LIMIT,
        reports: (reportResult.data?.length ?? 0) >= QUEUE_LIMIT,
        providerReconciliations: (providerResult.data?.length ?? 0) >= QUEUE_LIMIT,
        providerAuditRecoveries: (providerAuditResult.data?.length ?? 0) >= QUEUE_LIMIT,
        providerDeletionHandoffs: (providerDeletionHandoffResult.data?.length ?? 0) >= QUEUE_LIMIT,
      },
    });
  } catch (error) {
    return courtErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const { authorized, userId } = await verifyAdmin(request);
    if (!authorized || !userId) return unauthorizedResponse();

    const body = await readCourtJson(request, 4 * 1024);
    const target = body.target;
    const isRequestKeyReveal = target === "provider_deletion_handoff_reveal"
      || target === "provider_reconciliation_reveal";
    const rateLimitScope = isRequestKeyReveal
      ? "couple-court:admin:request-key-reveal"
      : "couple-court:admin:mutation";
    const limited = await checkRateLimitPersistent(
      rateLimitKey(rateLimitScope, request, userId),
      isRequestKeyReveal
        ? ADMIN_REQUEST_KEY_REVEAL_RATE_LIMIT
        : ADMIN_MUTATION_RATE_LIMIT,
      userId,
    );
    if (limited) return limited;

    if (target === "provider_audit_recovery") {
      requireDecision(body.decision, new Set(["recover_one"]));
      const recovery = await recoverOneCourtProviderAudit(userId);
      return noStoreJson({
        ok: true,
        target,
        action: "recover_court_provider_audit",
        recovered: recovery.recovered,
        providerState: recovery.providerState,
      });
    }

    const id = requireUuid(body.id);
    const reasonCode = target === "provider_reconciliation"
      || target === "provider_deletion_handoff"
      || target === "provider_deletion_handoff_reveal"
      || target === "provider_reconciliation_reveal"
      ? null
      : optionalReasonCode(body.reasonCode);

    let rpcName: string;
    let rpcArguments: Record<string, unknown>;

    if (target === "post") {
      const decision = requireDecision(body.decision, POST_DECISIONS);
      const requiredReason = decision === "approve" ? reasonCode : requireReason(reasonCode);
      rpcName = "review_court_public_post";
      rpcArguments = {
        p_public_post_id: id,
        p_reviewer_user_id: userId,
        p_decision: decision,
        p_reason_code: requiredReason,
      };
    } else if (target === "comment") {
      const decision = requireDecision(body.decision, COMMENT_DECISIONS);
      const requiredReason = decision === "approve" ? reasonCode : requireReason(reasonCode);
      rpcName = "review_court_public_comment";
      rpcArguments = {
        p_comment_id: id,
        p_reviewer_user_id: userId,
        p_decision: decision,
        p_reason_code: requiredReason,
      };
    } else if (target === "comments") {
      if (typeof body.enabled !== "boolean") {
        throw new CourtApiError(400, "INVALID_COMMENTS_SETTING", "댓글 설정을 확인해 주세요.");
      }
      const requiredReason = body.enabled ? reasonCode : requireReason(reasonCode);
      rpcName = "set_court_public_comments_enabled";
      rpcArguments = {
        p_public_post_id: id,
        p_reviewer_user_id: userId,
        p_enabled: body.enabled,
        p_reason_code: requiredReason,
      };
    } else if (target === "report") {
      const decision = requireDecision(body.decision, REPORT_DECISIONS);
      const requiredReason = decision === "start_review" ? reasonCode : requireReason(reasonCode);
      rpcName = "review_court_public_report";
      rpcArguments = {
        p_report_id: id,
        p_reviewer_user_id: userId,
        p_decision: decision,
        p_reason_code: requiredReason,
      };
    } else if (target === "provider_reconciliation") {
      const decision = requireDecision(body.decision, new Set(["allow_retry"]));
      const providerReasonCode = requireProviderReasonCode(body.reasonCode);
      if (body.confirmation !== PROVIDER_RETRY_CONFIRMATION) {
        throw new CourtApiError(
          400,
          "PROVIDER_RECONCILIATION_CONFIRMATION_REQUIRED",
          "제공사 처리 결과를 직접 확인한 뒤 고정 확인 문구를 입력해 주세요.",
        );
      }
      rpcName = "reconcile_court_provider_failure";
      rpcArguments = {
        p_verdict_id: id,
        p_admin_user_id: userId,
        p_action: decision,
        p_reason_code: providerReasonCode,
        p_confirmation: PROVIDER_RETRY_CONFIRMATION,
      };
    } else if (target === "provider_deletion_handoff") {
      rpcName = "resolve_court_provider_deletion_handoff";
      rpcArguments = providerDeletionResolutionArguments(body, id, userId);
    } else if (target === "provider_deletion_handoff_reveal") {
      rpcName = "reveal_court_provider_deletion_handoff_request_key";
      rpcArguments = providerRequestKeyRevealArguments(body, id, userId);
    } else if (target === "provider_reconciliation_reveal") {
      rpcName = "reveal_court_provider_reconciliation_request_key";
      rpcArguments = providerRequestKeyRevealArguments(body, id, userId);
    } else {
      throw new CourtApiError(400, "INVALID_MODERATION_TARGET", "검토 대상을 확인해 주세요.");
    }

    const service = getServiceClient();
    const { data: rpcData, error } = await service.rpc(rpcName, rpcArguments);
    if (error) {
      if (target === "provider_reconciliation") {
        throw new CourtApiError(
          409,
          "PROVIDER_RECONCILIATION_REJECTED",
          "현재 상태에서는 재시도를 허용할 수 없습니다. 제공사 기록과 대기열을 다시 확인해 주세요.",
        );
      }
      if (target === "provider_deletion_handoff") {
        throw new CourtApiError(
          409,
          "PROVIDER_DELETION_HANDOFF_RESOLUTION_REJECTED",
          "삭제된 사건의 제공사 정산 상태가 변경되었거나 만료되었습니다. 대기열을 새로고침해 주세요.",
        );
      }
      if (target === "provider_deletion_handoff_reveal"
        || target === "provider_reconciliation_reveal"
      ) {
        throw new CourtApiError(
          409,
          "PROVIDER_REQUEST_KEY_REVEAL_REJECTED",
          "요청 키를 공개할 수 없거나 항목 상태가 변경되었습니다. 대기열을 새로고침해 주세요.",
        );
      }
      throw new CourtApiError(
        409,
        "MODERATION_ACTION_REJECTED",
        "현재 상태에서는 이 검토 조치를 완료할 수 없습니다. 대기열을 새로고침해 주세요.",
      );
    }

    if (target === "provider_deletion_handoff_reveal"
      || target === "provider_reconciliation_reveal"
    ) {
      const result = Array.isArray(rpcData) ? rpcData[0] : rpcData;
      const requestKey = isRecord(result) ? stringField(result, "request_key") : null;
      const verdictId = isRecord(result) ? stringField(result, "verdict_id") : null;
      const revealedAt = isRecord(result) ? stringField(result, "revealed_at") : null;
      if (
        verdictId !== id
        || !requestKey
        || !/^[a-f0-9]{64}$/.test(requestKey)
        || !revealedAt
        || !Number.isFinite(Date.parse(revealedAt))
      ) {
        throw new CourtApiError(
          503,
          "PROVIDER_REQUEST_KEY_REVEAL_CONTRACT_INVALID",
          "감사 기록이 확인되지 않아 OpenAI 요청 키를 공개하지 않았습니다.",
        );
      }
      return noStoreJson({
        ok: true,
        target,
        action: rpcName,
        requestKey,
        revealedAt,
      });
    }

    return noStoreJson({ ok: true, target, action: rpcName });
  } catch (error) {
    return courtErrorResponse(error);
  }
}
