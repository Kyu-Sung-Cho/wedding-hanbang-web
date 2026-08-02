import { AdminNextResponse as NextResponse } from "@/lib/admin/privateResponse";
import { getServiceClient, verifyAdmin } from "@/lib/utils/adminAuth";
import { readBoundedUtf8Text } from "@/utils/requestValidation";
import { checkRateLimitPersistent, rateLimitKey } from "@/utils/rateLimit";
import { isTrustedMutationRequest } from "@/utils/trustedMutation";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BATCH_LIMIT = 25;
const CONTRACT_VERSION = 1;
const MAX_BODY_BYTES = 2 * 1024;
const COUNT_RPC = "get_vendor_disclosure_bulk_approval_eligibility";
const APPROVE_RPC = "approve_vendor_disclosure_validated_batch";
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const PRIVATE_VARY = "Origin, Sec-Fetch-Site, Authorization";
const LOCK_RETRY_DELAY_MS = 40;

const eligibilitySchema = z.strictObject({
  eligibility_contract_version: z.literal(CONTRACT_VERSION),
  batch_eligible_count: z.number().int().min(0).max(BATCH_LIMIT),
  has_more: z.boolean(),
  eligibility_sha256: z.string().regex(SHA256_PATTERN).nullable(),
}).superRefine((value, context) => {
  if ((value.batch_eligible_count === 0) !== (value.eligibility_sha256 === null)) {
    context.addIssue({
      code: "custom",
      path: ["eligibility_sha256"],
      message: "empty eligibility must not carry an execution fingerprint",
    });
  }
  if (value.has_more && value.batch_eligible_count !== BATCH_LIMIT) {
    context.addIssue({
      code: "custom",
      path: ["has_more"],
      message: "has_more is valid only when the current batch is full",
    });
  }
});

const approvalRequestSchema = z.strictObject({
  eligibility_contract_version: z.literal(CONTRACT_VERSION),
  confirmation: z.literal("approve_automatically_validated_pending"),
  expected_eligible_count: z.number().int().min(1).max(BATCH_LIMIT),
  expected_eligibility_sha256: z.string().regex(SHA256_PATTERN),
});

const approvalResultSchema = z.strictObject({
  eligibility_contract_version: z.literal(CONTRACT_VERSION),
  approved_count: z.number().int().min(1).max(BATCH_LIMIT),
  approved_price_ids: z.array(z.string().uuid()).min(1).max(BATCH_LIMIT),
  approval_receipt_sha256: z.string().regex(SHA256_PATTERN),
}).superRefine((value, context) => {
  if (
    value.approved_price_ids.length !== value.approved_count
    || new Set(value.approved_price_ids).size !== value.approved_price_ids.length
  ) {
    context.addIssue({
      code: "custom",
      path: ["approved_price_ids"],
      message: "approval result must contain one unique id per approved row",
    });
  }
});

function privateJson(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { Vary: PRIVATE_VARY },
  });
}

function rpcFingerprint(error: unknown): string {
  if (!error || typeof error !== "object" || Array.isArray(error)) return "";
  const record = error as Record<string, unknown>;
  return [record.code, record.message, record.details, record.hint]
    .filter((value): value is string => typeof value === "string")
    .join("\n")
    .slice(0, 4_096);
}

function rpcErrorCode(error: unknown): string {
  if (!error || typeof error !== "object" || Array.isArray(error)) return "";
  const code = (error as Record<string, unknown>).code;
  return typeof code === "string" ? code : "";
}

function supportUnavailable(error: unknown): boolean {
  const code = rpcErrorCode(error);
  return code === "PGRST202" || code === "42883";
}

function blockedCountResponse(
  code: "BULK_APPROVAL_DB_SUPPORT_UNAVAILABLE" | "BULK_APPROVAL_COUNT_UNAVAILABLE",
  status = 503,
) {
  return privateJson({
    batch_eligible_count: null,
    has_more: null,
    count_verified: false,
    can_execute: false,
    batch_limit: BATCH_LIMIT,
    eligibility_contract_version: CONTRACT_VERSION,
    eligibility_sha256: null,
    blocked_code: code,
    blocked_reason: code === "BULK_APPROVAL_DB_SUPPORT_UNAVAILABLE"
      ? "안전 조건을 원자적으로 검증하는 데이터베이스 기능이 아직 적용되지 않아 일괄 승인을 실행할 수 없습니다."
      : "승인 가능 건수를 안전하게 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.",
  }, status);
}

function approvalErrorResponse(error: unknown) {
  const fingerprint = rpcFingerprint(error);
  if (
    fingerprint.includes("BULK_APPROVAL_ELIGIBILITY_CHANGED")
    || fingerprint.includes("40001")
  ) {
    return privateJson({
      error: "승인 대상이 변경되었습니다. 최신 건수를 다시 확인해 주세요.",
      code: "BULK_APPROVAL_ELIGIBILITY_CHANGED",
    }, 409);
  }
  if (supportUnavailable(error)) {
    return privateJson({
      error: "안전 조건을 원자적으로 검증하는 데이터베이스 기능이 아직 적용되지 않았습니다.",
      code: "BULK_APPROVAL_DB_SUPPORT_UNAVAILABLE",
    }, 503);
  }
  if (rpcErrorCode(error) === "55P03") {
    return privateJson({
      error: "다른 검수 또는 적재 작업이 진행 중입니다. 잠시 후 승인 가능 건수를 다시 확인해 주세요.",
      code: "BULK_APPROVAL_BUSY",
      retryable: true,
    }, 503);
  }
  return privateJson({
    error: "일괄 승인을 안전하게 완료하지 못했습니다. 승인 가능 건수를 다시 확인해 주세요.",
    code: "BULK_APPROVAL_FAILED",
  }, 503);
}

export async function GET(request: Request) {
  const admin = await verifyAdmin(request);
  if (!admin.authorized || !admin.userId) {
    return privateJson({ error: "Unauthorized" }, 401);
  }
  const limited = await checkRateLimitPersistent(
    rateLimitKey("admin:price-bulk-approval:preview", request, admin.userId),
    { maxRequests: 30, windowMs: 60 * 1000 },
  );
  if (limited) return limited;

  try {
    const { data, error } = await getServiceClient().rpc(COUNT_RPC, {
      p_actor_id: admin.userId,
      p_batch_limit: BATCH_LIMIT,
    });
    if (error) {
      return blockedCountResponse(
        supportUnavailable(error)
          ? "BULK_APPROVAL_DB_SUPPORT_UNAVAILABLE"
          : "BULK_APPROVAL_COUNT_UNAVAILABLE",
      );
    }
    const parsed = eligibilitySchema.safeParse(data);
    if (!parsed.success) {
      return blockedCountResponse("BULK_APPROVAL_COUNT_UNAVAILABLE");
    }
    return privateJson({
      batch_eligible_count: parsed.data.batch_eligible_count,
      has_more: parsed.data.has_more,
      count_verified: true,
      can_execute: parsed.data.batch_eligible_count > 0,
      batch_limit: BATCH_LIMIT,
      eligibility_contract_version: CONTRACT_VERSION,
      eligibility_sha256: parsed.data.eligibility_sha256,
    });
  } catch {
    return blockedCountResponse("BULK_APPROVAL_COUNT_UNAVAILABLE");
  }
}

export async function POST(request: Request) {
  if (!isTrustedMutationRequest(request)) {
    return privateJson({
      error: "요청 출처를 확인할 수 없습니다.",
      code: "UNTRUSTED_MUTATION_ORIGIN",
    }, 403);
  }

  const admin = await verifyAdmin(request);
  if (!admin.authorized || !admin.userId) {
    return privateJson({ error: "Unauthorized" }, 401);
  }
  const limited = await checkRateLimitPersistent(
    rateLimitKey("admin:price-bulk-approval:execute", request, admin.userId),
    { maxRequests: 12, windowMs: 60 * 60 * 1000 },
  );
  if (limited) return limited;

  const body = await readBoundedUtf8Text(request, MAX_BODY_BYTES);
  if (!body.ok) {
    return privateJson({
      error: body.reason === "too_large"
        ? "요청 본문이 너무 큽니다."
        : "요청 본문을 읽을 수 없습니다.",
      code: body.reason === "too_large" ? "REQUEST_TOO_LARGE" : "INVALID_REQUEST_BODY",
    }, body.reason === "too_large" ? 413 : 400);
  }

  let raw: unknown;
  try {
    raw = JSON.parse(body.text);
  } catch {
    return privateJson({ error: "승인 확인 값이 올바르지 않습니다.", code: "INVALID_CONFIRMATION" }, 400);
  }
  const input = approvalRequestSchema.safeParse(raw);
  if (!input.success) {
    return privateJson({ error: "승인 확인 값이 올바르지 않습니다.", code: "INVALID_CONFIRMATION" }, 400);
  }

  try {
    const rpcArgs = {
      p_actor_id: admin.userId,
      p_batch_limit: BATCH_LIMIT,
      p_expected_eligible_count: input.data.expected_eligible_count,
      p_expected_eligibility_sha256: input.data.expected_eligibility_sha256,
    };
    const serviceClient = getServiceClient();
    let { data, error } = await serviceClient.rpc(APPROVE_RPC, rpcArgs);
    if (rpcErrorCode(error) === "55P03") {
      await new Promise((resolve) => setTimeout(resolve, LOCK_RETRY_DELAY_MS));
      ({ data, error } = await serviceClient.rpc(APPROVE_RPC, rpcArgs));
    }
    if (error) return approvalErrorResponse(error);
    const parsed = approvalResultSchema.safeParse(data);
    if (
      !parsed.success
      || parsed.data.approved_count !== input.data.expected_eligible_count
    ) {
      return privateJson({
        error: "데이터베이스 승인 결과를 검증하지 못했습니다.",
        code: "BULK_APPROVAL_RESULT_INVALID",
      }, 503);
    }
    return privateJson({
      batch_eligible_count: input.data.expected_eligible_count,
      approved_count: parsed.data.approved_count,
      conflict_count: 0,
      failed_count: 0,
      batch_limit: BATCH_LIMIT,
      approval_receipt_sha256: parsed.data.approval_receipt_sha256,
      results: parsed.data.approved_price_ids.map((priceId) => ({ price_id: priceId })),
    });
  } catch (error) {
    return approvalErrorResponse(error);
  }
}
