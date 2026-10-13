import { createAdminClient } from "@/lib/supabase/admin";
import {
  getAmoraActions,
  type AmoraActionStatus,
} from "@/lib/amora/actions";
import { readAmoraActionSnapshot } from "@/lib/amora/actionRepository";
import type { ToolExecutionContext } from "@/lib/ai/tools/toolTypes";
import type { ToolExecutionResult } from "@/types/database.types";

function getAdminClient() {
  return createAdminClient();
}

function normalizeActionStatus(value: unknown): AmoraActionStatus | undefined {
  if (value === "open" || value === "done" || value === "dismissed") return value;
  return undefined;
}

export async function executeAddAmoraAction(
  input: Record<string, unknown>,
  _ctx: ToolExecutionContext
): Promise<ToolExecutionResult> {
  void _ctx;
  // 정상 승인 경로는 atomic dispatcher만 사용한다. 구 직접 쓰기는 재개하지 않는다.
  return {
    toolName: "add_amora_action",
    toolInput: input,
    toolOutput: { error_code: "AMORA_ACTION_NON_ATOMIC_MUTATION_RETIRED" },
    success: false,
    displayMessage: "이전 방식으로는 공유 할 일을 저장하지 않아요. 현재 대화에서 내용을 다시 확인한 뒤 저장해 주세요.",
  };
}

export async function executeGetAmoraActions(
  input: Record<string, unknown>,
  ctx: ToolExecutionContext
): Promise<ToolExecutionResult> {
  const status = input.status === "all" ? "all" : normalizeActionStatus(input.status) ?? "open";
  let snapshot;
  try {
    snapshot = await readAmoraActionSnapshot(
      getAdminClient(),
      ctx.coupleId,
      getAmoraActions(ctx.weddingContext.progress as Record<string, unknown>),
      status,
    );
  } catch {
    return {
      toolName: "get_amora_actions",
      toolInput: input,
      toolOutput: { error: "action_read_failed" },
      success: false,
      displayMessage: "아모라 행동 카드를 불러오지 못했어요. 잠시 후 다시 시도해주세요.",
    };
  }
  const { actions } = snapshot;
  const completeStatusSnapshot = status === "all" && snapshot.source === "table"
    && actions.length === snapshot.count;

  return {
    toolName: "get_amora_actions",
    toolInput: input,
    toolOutput: {
      list_kind: "shared_actions",
      requested_status: status,
      actions,
      count: snapshot.count,
      open_count: snapshot.openCount,
      source: snapshot.source,
      truncated: actions.length < snapshot.count,
      status_counts: completeStatusSnapshot ? {
        open: actions.filter(action => action.status === "open").length,
        done: actions.filter(action => action.status === "done").length,
        dismissed: actions.filter(action => action.status === "dismissed").length,
      } : null,
    },
    success: true,
    displayMessage: actions.length > 0
      ? `이번에 조회한 공유 할 일 ${snapshot.count}개${actions.length < snapshot.count ? " 중 일부" : ""}: ${actions.slice(0, 5).map((item) => item.title).join(", ")}`
      : "이번 조회에서 확인된 공유 할 일이 없습니다.",
  };
}

export async function executeUpdateAmoraAction(
  input: Record<string, unknown>,
  _ctx: ToolExecutionContext
): Promise<ToolExecutionResult> {
  void _ctx;
  // blocked인 AI update에 직접 DML이나 legacy fallback으로 권한을 발명하지 않는다.
  return {
    toolName: "update_amora_action",
    toolInput: input,
    toolOutput: { error_code: "AMORA_ACTION_NON_ATOMIC_MUTATION_RETIRED" },
    success: false,
    displayMessage: "이전 방식으로는 공유 할 일을 수정하지 않아요. 결정보드에서 최신 내용을 확인한 뒤 수정해 주세요.",
  };
}
