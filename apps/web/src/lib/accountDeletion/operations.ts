import type { SupabaseClient } from "@supabase/supabase-js";
import { log } from "@/utils/log";
import * as Sentry from "@sentry/nextjs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STATUSES = ["inventorying", "inventory_ready", "deleting", "auth_deleting", "manual_review", "completed"] as const;
const JOB_FIELDS = "id,status,created_at,updated_at,storage_verified_at,auth_deleted_at,completed_at";
export const ACCOUNT_DELETION_REVIEW_LIMIT = 50;
export const isDeletionJobId = (value: string) => UUID_RE.test(value);

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function timestamp(value: unknown): value is string {
  return typeof value === "string"
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    && Number.isFinite(Date.parse(value));
}
function count(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

export async function readManualReviewBacklog(admin: SupabaseClient) {
  const result = await admin.from("account_deletion_jobs")
    .select("created_at", { count: "exact" })
    .eq("status", "manual_review")
    .order("created_at", { ascending: true }).limit(1);
  if (result.error || !count(result.count) || !Array.isArray(result.data)
    || result.data.length !== (result.count === 0 ? 0 : 1)
    || (result.count > 0 && (!record(result.data[0]) || !timestamp(result.data[0].created_at)))) {
    throw new Error("ACCOUNT_DELETION_MONITOR_UNAVAILABLE");
  }
  return { outstanding: result.count, oldestCreatedAt: result.count > 0 ? String(result.data[0].created_at) : null };
}

export function reportDeletionOperationsFailure(step: "client" | "inventory" | "worker" | "monitor" | "admin-read") {
  try {
    // SDK 예외·대상 식별자·요청 경로를 알림에 넣지 않는다.
    log.error(`account-deletion/${step}`, new Error(step === "monitor"
      ? "ACCOUNT_DELETION_MONITOR_UNAVAILABLE" : "ACCOUNT_DELETION_OPERATION_FAILED"));
  } catch {
    // 알림 장애가 삭제를 재실행하거나 이미 저장한 결과를 바꾸면 안 된다.
  }
}

export function reportManualReviewBacklog(backlog: Awaited<ReturnType<typeof readManualReviewBacklog>>) {
  try {
    console.log(JSON.stringify({
      event: "account_deletion_manual_review", version: 1,
      observedAt: new Date().toISOString(),
      outstanding: backlog.outstanding, oldestCreatedAt: backlog.oldestCreatedAt,
    }));
  } catch {
    // 집계 출력과 Sentry를 분리하여 한쪽 실패가 다른 경로를 막지 않는다.
  }
  if (backlog.outstanding > 0) {
    try {
      Sentry.withScope((scope) => {
        scope.setFingerprint(["account-deletion", "manual-review"]);
        log.error("account-deletion/manual-review", new Error("ACCOUNT_DELETION_MANUAL_REVIEW_REQUIRED"));
      });
    } catch {
      // 다음 정상 예약 실행에서 다시 관측한다. 수신 성공으로 기록하지 않는다.
    }
  }
}

function safeJob(value: unknown) {
  if (!record(value) || typeof value.id !== "string" || !isDeletionJobId(value.id)
    || !STATUSES.some((status) => status === value.status)
    || !timestamp(value.created_at) || !timestamp(value.updated_at)
    || ![value.storage_verified_at, value.auth_deleted_at, value.completed_at].every((date) => date === null || timestamp(date))) {
    throw new Error("ACCOUNT_DELETION_STATUS_UNAVAILABLE");
  }
  const completedInLedger = value.status === "completed"
    && value.storage_verified_at !== null && value.auth_deleted_at !== null && value.completed_at !== null;
  if ((value.status === "completed" && !completedInLedger)
    || (value.status !== "completed" && value.completed_at !== null)) {
    throw new Error("ACCOUNT_DELETION_STATUS_UNAVAILABLE");
  }
  // 선택한 필드만 새로 만든다. 데이터 응답에 섞인 회원/사유/경로는 반환하지 않는다.
  return {
    id: value.id, status: value.status, createdAt: value.created_at, updatedAt: value.updated_at,
    storageVerifiedAt: value.storage_verified_at, authDeletedAt: value.auth_deleted_at,
    completedAt: value.completed_at, completedInLedger,
  };
}

export async function readDeletionOperations(admin: SupabaseClient, jobId: string | null) {
  if (jobId !== null) {
    if (!isDeletionJobId(jobId)) throw new Error("ACCOUNT_DELETION_JOB_ID_INVALID");
    const result = await admin.from("account_deletion_jobs").select(JOB_FIELDS).eq("id", jobId).maybeSingle();
    if (result.error) throw new Error("ACCOUNT_DELETION_STATUS_UNAVAILABLE");
    if (result.data === null) return { job: null };
    const job = safeJob(result.data);
    if (job.id.toLowerCase() !== jobId.toLowerCase()) throw new Error("ACCOUNT_DELETION_STATUS_UNAVAILABLE");
    return { job };
  }
  const result = await admin.from("account_deletion_jobs").select(JOB_FIELDS, { count: "exact" })
    .eq("status", "manual_review").order("created_at", { ascending: true })
    .order("id", { ascending: true }).limit(ACCOUNT_DELETION_REVIEW_LIMIT);
  if (result.error || !count(result.count) || !Array.isArray(result.data)
    || result.data.length !== Math.min(result.count, ACCOUNT_DELETION_REVIEW_LIMIT)) {
    throw new Error("ACCOUNT_DELETION_STATUS_UNAVAILABLE");
  }
  const jobs = result.data.map(safeJob);
  if (jobs.some((job) => job.status !== "manual_review") || new Set(jobs.map((job) => job.id)).size !== jobs.length) {
    throw new Error("ACCOUNT_DELETION_STATUS_UNAVAILABLE");
  }
  return { outstanding: result.count, jobs, limit: ACCOUNT_DELETION_REVIEW_LIMIT, truncated: result.count > jobs.length };
}
