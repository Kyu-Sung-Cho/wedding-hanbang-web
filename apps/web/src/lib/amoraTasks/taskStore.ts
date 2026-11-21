import type { SupabaseClient } from "@supabase/supabase-js";
import {
  AMORA_TASK_ID_PATTERN,
  AMORA_TASK_KINDS,
  AMORA_TASK_REVIEW_REASONS,
  AMORA_TASK_STATUSES,
  type AmoraTaskKind,
  type AmoraTaskReviewReason,
  type AmoraTaskStatus,
} from "@hanbang/shared/amora-tasks";

/**
 * 맡은 일 표(`amora_tasks`)와 그 함수들. 쓰기는 모두 service_role 함수(`supabase/migrations/20261120160000_amora_tasks.sql`)로 한다.
 *
 * 표가 아직 없으면(앱이 DB 보다 먼저 나간 경우, 42P01·PGRST205) `AmoraTaskStorageUnavailableError` 를 던진다.
 * 화면 쪽 API 는 그것을 `{ available:false }` 로 바꿔 홈이 깨지지 않게 한다(기억 prod-schema-drift-42703).
 */

export class AmoraTaskStorageUnavailableError extends Error {
  constructor() {
    super("amora_tasks storage is unavailable");
    this.name = "AmoraTaskStorageUnavailableError";
  }
}

export class AmoraTaskStoreError extends Error {
  constructor(readonly operation: string, readonly code: string | null) {
    super(`amora_tasks ${operation} failed`);
    this.name = "AmoraTaskStoreError";
  }
}

export function isAmoraTaskStorageUnavailable(error: unknown): boolean {
  if (error instanceof AmoraTaskStorageUnavailableError) return true;
  if (!error || typeof error !== "object") return false;
  const err = error as { code?: unknown; message?: unknown };
  const message = typeof err.message === "string" ? err.message : "";
  return (
    err.code === "42P01"
    || err.code === "42883"
    || err.code === "PGRST202"
    || err.code === "PGRST205"
    || /relation\s+["']?(public\.)?amora_task/i.test(message)
    || /could not find .*amora_task.*schema cache/i.test(message)
  );
}

function fail(operation: string, error: unknown): never {
  if (isAmoraTaskStorageUnavailable(error)) throw new AmoraTaskStorageUnavailableError();
  const code = error && typeof error === "object" && typeof (error as { code?: unknown }).code === "string"
    ? (error as { code: string }).code
    : null;
  throw new AmoraTaskStoreError(operation, code);
}

export type AmoraTaskRow = {
  id: string;
  couple_id: string;
  requested_by: string | null;
  kind: AmoraTaskKind;
  status: AmoraTaskStatus;
  title: string;
  input: Record<string, unknown>;
  progress: Record<string, unknown>;
  steps: unknown[];
  result: Record<string, unknown> | null;
  review_reason: AmoraTaskReviewReason | null;
  error_code: string | null;
  model_steps: number;
  web_searches: number;
  input_tokens: number;
  output_tokens: number;
  reserved_cost_microusd: number;
  cost_microusd: number;
  run_count: number;
  failure_count: number;
  lease_token: string | null;
  leased_until: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
  updated_at: string;
};

const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

function toNumber(value: unknown): number {
  const parsed = typeof value === "string" ? Number(value) : value;
  return typeof parsed === "number" && Number.isFinite(parsed) ? parsed : 0;
}

export function parseAmoraTaskRow(value: unknown): AmoraTaskRow | null {
  if (!object(value)) return null;
  if (typeof value.id !== "string" || !AMORA_TASK_ID_PATTERN.test(value.id)) return null;
  if (typeof value.couple_id !== "string" || !AMORA_TASK_ID_PATTERN.test(value.couple_id)) return null;
  if (!AMORA_TASK_KINDS.includes(value.kind as AmoraTaskKind)) return null;
  if (!AMORA_TASK_STATUSES.includes(value.status as AmoraTaskStatus)) return null;
  if (typeof value.title !== "string") return null;
  return {
    id: value.id,
    couple_id: value.couple_id,
    requested_by: typeof value.requested_by === "string" ? value.requested_by : null,
    kind: value.kind as AmoraTaskKind,
    status: value.status as AmoraTaskStatus,
    title: value.title,
    input: object(value.input) ? value.input : {},
    progress: object(value.progress) ? value.progress : {},
    steps: Array.isArray(value.steps) ? value.steps : [],
    result: object(value.result) ? value.result : null,
    review_reason: AMORA_TASK_REVIEW_REASONS.includes(value.review_reason as AmoraTaskReviewReason)
      ? value.review_reason as AmoraTaskReviewReason
      : null,
    error_code: typeof value.error_code === "string" ? value.error_code : null,
    model_steps: toNumber(value.model_steps),
    web_searches: toNumber(value.web_searches),
    input_tokens: toNumber(value.input_tokens),
    output_tokens: toNumber(value.output_tokens),
    reserved_cost_microusd: toNumber(value.reserved_cost_microusd),
    cost_microusd: toNumber(value.cost_microusd),
    run_count: toNumber(value.run_count),
    failure_count: toNumber(value.failure_count),
    lease_token: typeof value.lease_token === "string" ? value.lease_token : null,
    leased_until: typeof value.leased_until === "string" ? value.leased_until : null,
    started_at: typeof value.started_at === "string" ? value.started_at : null,
    finished_at: typeof value.finished_at === "string" ? value.finished_at : null,
    created_at: typeof value.created_at === "string" ? value.created_at : "",
    updated_at: typeof value.updated_at === "string" ? value.updated_at : "",
  };
}

export type AmoraTaskRpcResult = { ok: boolean; code: string; status: AmoraTaskStatus | null; taskId: string | null; offerExpiresAt: string | null };

function parseRpcResult(value: unknown): AmoraTaskRpcResult {
  const record = object(value) ? value : {};
  return {
    ok: record.ok === true,
    code: typeof record.code === "string" ? record.code : "unknown",
    status: AMORA_TASK_STATUSES.includes(record.status as AmoraTaskStatus) ? record.status as AmoraTaskStatus : null,
    taskId: typeof record.task_id === "string" && AMORA_TASK_ID_PATTERN.test(record.task_id) ? record.task_id : null,
    offerExpiresAt: typeof record.offer_expires_at === "string" ? record.offer_expires_at : null,
  };
}

export type AmoraTaskUsageKind = "model_step" | "web_search";
export type AmoraTaskUsageReservation = { allowed: boolean; reason: string | null };

export type AmoraTaskNotificationClaim = {
  taskId: string;
  coupleId: string;
  requestedBy: string | null;
  kind: AmoraTaskKind;
  attempts: number;
};

export interface AmoraTaskStore {
  offer(input: {
    coupleId: string;
    requestedBy: string;
    sourceLane: string;
    sourceRequestKey: string;
    kind: AmoraTaskKind;
    title: string;
    input: Record<string, unknown>;
    offerTtlSeconds: number;
  }): Promise<AmoraTaskRpcResult>;
  start(taskId: string, actor: string, dailyTaskCap: number): Promise<AmoraTaskRpcResult>;
  cancel(taskId: string, actor: string): Promise<AmoraTaskRpcResult>;
  resume(taskId: string, actor: string): Promise<AmoraTaskRpcResult>;
  claim(leaseSeconds: number): Promise<AmoraTaskRow | null>;
  saveProgress(input: {
    taskId: string;
    leaseToken: string;
    status: "searching" | "organizing";
    progress: Record<string, unknown>;
    stepLabel: string | null;
    inputTokens: number;
    outputTokens: number;
    costMicrousd: number;
    leaseSeconds: number;
  }): Promise<boolean>;
  reserveUsage(input: {
    taskId: string;
    leaseToken: string;
    usage: AmoraTaskUsageKind;
    costMicrousd: number;
    taskCap: number;
    coupleDailyCap: number;
    globalCostCapMicrousd: number;
  }): Promise<AmoraTaskUsageReservation>;
  release(taskId: string, leaseToken: string, delaySeconds: number): Promise<boolean>;
  finish(input: {
    taskId: string;
    leaseToken: string;
    status: "done" | "needs_review";
    reviewReason: AmoraTaskReviewReason | null;
    result: Record<string, unknown> | null;
    errorCode: string | null;
    stepLabel: string | null;
  }): Promise<boolean>;
  claimNotifications(limit: number): Promise<AmoraTaskNotificationClaim[]>;
  /** 알림 함수의 결과를 남긴다. reason 은 그 함수가 돌려준 짧은 코드(`^[a-z_]{1,40}$`). */
  finishNotification(taskId: string, state: "sent" | "skipped", reason: string): Promise<boolean>;
}

export function createSupabaseAmoraTaskStore(admin: SupabaseClient): AmoraTaskStore {
  async function rpc(name: string, args: Record<string, unknown>): Promise<unknown> {
    const { data, error } = await admin.rpc(name, args);
    if (error) fail(name, error);
    return data;
  }
  return {
    async offer(input) {
      return parseRpcResult(await rpc("offer_amora_task", {
        p_couple_id: input.coupleId,
        p_requested_by: input.requestedBy,
        p_source_lane: input.sourceLane,
        p_source_request_key: input.sourceRequestKey,
        p_kind: input.kind,
        p_title: input.title,
        p_input: input.input,
        p_offer_ttl_seconds: input.offerTtlSeconds,
      }));
    },
    async start(taskId, actor, dailyTaskCap) {
      return parseRpcResult(await rpc("start_amora_task", {
        p_task_id: taskId, p_actor: actor, p_daily_task_cap: dailyTaskCap,
      }));
    },
    async cancel(taskId, actor) {
      return parseRpcResult(await rpc("cancel_amora_task", { p_task_id: taskId, p_actor: actor }));
    },
    async resume(taskId, actor) {
      return parseRpcResult(await rpc("resume_amora_task", { p_task_id: taskId, p_actor: actor }));
    },
    async claim(leaseSeconds) {
      const data = await rpc("claim_amora_task", { p_lease_seconds: leaseSeconds });
      const row = Array.isArray(data) ? data[0] : data;
      return row ? parseAmoraTaskRow(row) : null;
    },
    async saveProgress(input) {
      return (await rpc("save_amora_task_progress", {
        p_task_id: input.taskId,
        p_lease_token: input.leaseToken,
        p_status: input.status,
        p_progress: input.progress,
        p_step_label: input.stepLabel,
        p_input_tokens: Math.max(0, Math.round(input.inputTokens)),
        p_output_tokens: Math.max(0, Math.round(input.outputTokens)),
        p_cost_microusd: Math.max(0, Math.round(input.costMicrousd)),
        p_lease_seconds: input.leaseSeconds,
      })) === true;
    },
    async reserveUsage(input) {
      const data = await rpc("reserve_amora_task_usage", {
        p_task_id: input.taskId,
        p_lease_token: input.leaseToken,
        p_usage: input.usage,
        p_cost_microusd: input.costMicrousd,
        p_task_cap: input.taskCap,
        p_couple_daily_cap: input.coupleDailyCap,
        p_global_cost_cap_microusd: input.globalCostCapMicrousd,
      });
      const record = object(data) ? data : {};
      return {
        allowed: record.allowed === true,
        reason: typeof record.reason === "string" ? record.reason : null,
      };
    },
    async release(taskId, leaseToken, delaySeconds) {
      return (await rpc("release_amora_task", {
        p_task_id: taskId, p_lease_token: leaseToken, p_delay_seconds: delaySeconds,
      })) === true;
    },
    async finish(input) {
      return (await rpc("finish_amora_task", {
        p_task_id: input.taskId,
        p_lease_token: input.leaseToken,
        p_status: input.status,
        p_review_reason: input.reviewReason,
        p_result: input.result,
        p_error_code: input.errorCode,
        p_step_label: input.stepLabel,
      })) === true;
    },
    async claimNotifications(limit) {
      const data = await rpc("claim_amora_task_notifications", { p_limit: limit });
      return (Array.isArray(data) ? data : [])
        .map((row): AmoraTaskNotificationClaim | null => {
          if (!object(row) || typeof row.task_id !== "string" || typeof row.couple_id !== "string") return null;
          if (!AMORA_TASK_KINDS.includes(row.kind as AmoraTaskKind)) return null;
          return {
            taskId: row.task_id,
            coupleId: row.couple_id,
            requestedBy: typeof row.requested_by === "string" ? row.requested_by : null,
            kind: row.kind as AmoraTaskKind,
            attempts: toNumber(row.notify_attempts),
          };
        })
        .filter((row): row is AmoraTaskNotificationClaim => row !== null);
    },
    async finishNotification(taskId, state, reason) {
      return (await rpc("finish_amora_task_notification", {
        p_task_id: taskId, p_state: state, p_reason: /^[a-z_]{1,40}$/.test(reason) ? reason : "unknown",
      })) === true;
    },
  };
}

/** 회원이 읽는 칸. 마이그레이션의 칸 권한(GRANT SELECT (...))과 같아야 한다. */
export const AMORA_TASK_MEMBER_COLUMNS =
  "id, couple_id, kind, status, title, steps, result, review_reason, offer_expires_at, created_at, started_at, finished_at, updated_at";

export type AmoraTaskMemberRow = {
  id: string;
  couple_id: string;
  kind: string;
  status: string;
  title: string;
  steps: unknown;
  result: unknown;
  review_reason: string | null;
  offer_expires_at: string | null;
  created_at: string | null;
  started_at: string | null;
  finished_at: string | null;
  updated_at: string | null;
};

/** 회원 클라이언트(RLS)로 커플의 최근 일을 읽는다. 카드만 나온 일과 닫힌 일은 빼고 읽는다. */
export async function listAmoraTasksForMember(
  client: SupabaseClient,
  coupleId: string,
): Promise<AmoraTaskMemberRow[]> {
  const { data, error } = await client
    .from("amora_tasks")
    .select(AMORA_TASK_MEMBER_COLUMNS)
    .eq("couple_id", coupleId)
    .in("status", ["queued", "searching", "organizing", "needs_review", "done"])
    .order("updated_at", { ascending: false })
    .limit(10);
  if (error) fail("list", error);
  return (data ?? []) as AmoraTaskMemberRow[];
}

export async function getAmoraTaskForMember(
  client: SupabaseClient,
  taskId: string,
): Promise<AmoraTaskMemberRow | null> {
  const { data, error } = await client
    .from("amora_tasks")
    .select(AMORA_TASK_MEMBER_COLUMNS)
    .eq("id", taskId)
    .maybeSingle();
  if (error) fail("get", error);
  return (data ?? null) as AmoraTaskMemberRow | null;
}
