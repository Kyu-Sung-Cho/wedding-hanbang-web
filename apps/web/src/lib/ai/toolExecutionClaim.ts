import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ToolExecutionResult } from "@/types/database.types";

const TOOL_IDEMPOTENCY_NAMESPACE = "amora-tool-execution-v1";

type ChatVisibility = "shared" | "bride_private" | "groom_private";

interface ClaimBase {
  key: string;
  userId: string;
  coupleId: string;
  clientRequestId: string;
  callId: string;
  toolName: string;
  toolInput: Record<string, unknown>;
  visibility: ChatVisibility;
}

export type ToolExecutionClaim =
  | { action: "execute"; claimId: string; key: string }
  | { action: "reuse"; result: ToolExecutionResult; key: string };

export class ToolExecutionClaimError extends Error {
  constructor(
    message: string,
    readonly code:
      | "claim_unavailable"
      | "claim_in_progress"
      | "claim_result_unavailable"
      | "claim_completion_failed"
  ) {
    super(message);
    this.name = "ToolExecutionClaimError";
  }
}

function canonicalize(value: unknown): string {
  if (value === null) return "null";

  switch (typeof value) {
    case "string":
    case "boolean":
      return JSON.stringify(value);
    case "number":
      return Number.isFinite(value) ? JSON.stringify(value) : JSON.stringify(`[non-finite:${String(value)}]`);
    case "undefined":
      return '"[undefined]"';
    case "bigint":
      return JSON.stringify(`[bigint:${value.toString()}]`);
    case "symbol":
    case "function":
      return JSON.stringify(`[unsupported:${typeof value}]`);
    case "object":
      if (Array.isArray(value)) {
        return `[${value.map(canonicalize).join(",")}]`;
      }
      return `{${Object.keys(value as Record<string, unknown>)
        .sort()
        .map((key) => `${JSON.stringify(key)}:${canonicalize((value as Record<string, unknown>)[key])}`)
        .join(",")}}`;
  }

  return '"[unsupported]"';
}

export function createToolExecutionKey(params: {
  userId: string;
  coupleId: string;
  clientRequestId: string;
  visibility: ChatVisibility;
  toolName: string;
  toolInput: Record<string, unknown>;
  occurrence: number;
}): string {
  const canonicalInput = canonicalize(params.toolInput);
  return createHash("sha256")
    .update(
      [
        TOOL_IDEMPOTENCY_NAMESPACE,
        params.userId,
        params.coupleId,
        params.clientRequestId,
        params.visibility,
        params.toolName,
        canonicalInput,
        String(params.occurrence),
      ].join("\u0000"),
      "utf8"
    )
    .digest("hex");
}

function isUniqueViolation(error: { code?: string; message?: string } | null): boolean {
  return Boolean(
    error &&
      (error.code === "23505" || /duplicate|unique/i.test(error.message ?? ""))
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readStoredResult(value: unknown): ToolExecutionResult | null {
  if (!isRecord(value) || !isRecord(value.result)) return null;
  const result = value.result;
  if (
    typeof result.toolName !== "string" ||
    !isRecord(result.toolInput) ||
    !isRecord(result.toolOutput) ||
    typeof result.success !== "boolean" ||
    typeof result.displayMessage !== "string"
  ) {
    return null;
  }
  return result as unknown as ToolExecutionResult;
}

/**
 * Claims a tool execution before any external or database side effect occurs.
 * Only the request that inserts the unique ledger row may execute the tool.
 */
export async function claimToolExecution(
  admin: SupabaseClient,
  params: ClaimBase
): Promise<ToolExecutionClaim> {
  const metadata = {
    tool_idempotency_key: params.key,
    execution_status: "in_progress",
    client_request_id: params.clientRequestId,
    call_id: params.callId,
    visibility: params.visibility,
  };

  const { data: inserted, error: insertError } = await admin
    .from("ai_interactions_log")
    .insert({
      user_id: params.userId,
      couple_id: params.coupleId,
      interaction_type: "tool_call",
      tool_name: params.toolName,
      tool_input: params.toolInput,
      success: false,
      error_message: "tool_execution_in_progress",
      metadata,
    })
    .select("id")
    .single();

  if (!insertError && inserted?.id) {
    return { action: "execute", claimId: inserted.id as string, key: params.key };
  }

  if (!isUniqueViolation(insertError)) {
    throw new ToolExecutionClaimError(
      "도구 중복 실행 방지 장부를 기록하지 못했습니다.",
      "claim_unavailable"
    );
  }

  const { data: existing, error: selectError } = await admin
    .from("ai_interactions_log")
    .select("tool_output, metadata")
    .eq("couple_id", params.coupleId)
    .eq("interaction_type", "tool_call")
    .eq("metadata->>tool_idempotency_key", params.key)
    .maybeSingle();

  if (selectError || !existing) {
    throw new ToolExecutionClaimError(
      "기존 도구 실행 상태를 확인하지 못했습니다.",
      "claim_unavailable"
    );
  }

  const existingMetadata = isRecord(existing.metadata) ? existing.metadata : {};
  if (existingMetadata.execution_status !== "completed") {
    throw new ToolExecutionClaimError(
      "같은 요청의 도구 처리가 아직 진행 중이거나 결과가 확정되지 않았습니다.",
      "claim_in_progress"
    );
  }

  const storedResult = readStoredResult(existing.tool_output);
  if (!storedResult) {
    throw new ToolExecutionClaimError(
      "기존 도구 실행 결과를 안전하게 복원할 수 없습니다.",
      "claim_result_unavailable"
    );
  }

  return { action: "reuse", result: storedResult, key: params.key };
}

/**
 * Completes a previously claimed execution. Failure is fatal: leaving the row
 * in-progress deliberately blocks an unsafe retry after an uncertain mutation.
 */
export async function completeToolExecutionClaim(
  admin: SupabaseClient,
  params: ClaimBase & { claimId: string; result: ToolExecutionResult; latencyMs: number }
): Promise<void> {
  const errorMessage = params.result.success
    ? null
    : typeof params.result.toolOutput.error === "string"
      ? params.result.toolOutput.error
      : "tool_execution_failed";

  const { data, error } = await admin
    .from("ai_interactions_log")
    .update({
      tool_output: { result: params.result },
      latency_ms: params.latencyMs,
      success: params.result.success,
      error_message: errorMessage,
      metadata: {
        tool_idempotency_key: params.key,
        execution_status: "completed",
        client_request_id: params.clientRequestId,
        call_id: params.callId,
        visibility: params.visibility,
      },
    })
    .eq("id", params.claimId)
    .eq("couple_id", params.coupleId)
    .eq("interaction_type", "tool_call")
    .eq("metadata->>tool_idempotency_key", params.key)
    .select("id")
    .maybeSingle();

  if (error || !data) {
    throw new ToolExecutionClaimError(
      "도구 실행 결과를 중복 방지 장부에 확정하지 못했습니다.",
      "claim_completion_failed"
    );
  }
}
