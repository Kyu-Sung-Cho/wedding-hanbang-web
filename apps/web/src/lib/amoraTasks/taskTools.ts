import type { SupabaseClient } from "@supabase/supabase-js";
import { executeTool } from "@/lib/ai/toolExecutor";
import { isMutatingTool } from "@/lib/ai/mutationTools";
import type { ToolExecutionContext } from "@/lib/ai/tools/toolTypes";
import type { ToolExecutionResult } from "@/types/database.types";

/**
 * 맡은 일이 계획을 읽는 길. **읽기 도구만 연다.**
 *
 * 지금 코드는 대화가 아닌 요청에 도구를 주지 않는다(10장). 맡은 일은 이 파일로만 도구에 닿는다.
 *
 * - 목록에 있는 읽기 도구만 부른다. 쓰기 도구(`MUTATING_TOOL_NAMES`)는 이름이 목록에 잘못 들어가도
 *   `isMutatingTool` 이 먼저 막는다. 두 겹 모두 시험이 붙잡는다(`taskTools.test.ts`).
 * - 실행 문맥에 확인 카드 번호(`pendingActionId`)를 넣지 않는다. 실행기(`executeTool`)는 카드 번호가 없는
 *   쓰기를 거절하고, DB 의 도구 선점(`claim_amora_tool_execution`)은 `chat:<사용자>:<uuid>` 모양이 아닌
 *   요청 키를 거절한다. 맡은 일의 요청 키는 `task:<맡은 일>:<차례>` 라 그 문에서도 막힌다(세 겹).
 * - 계획은 커플이 함께 쓰는 것(`wedding_journeys`)만 읽는다. 한 사람만 보는 기록(개인 할 일, 견적 체크)은
 *   읽지 않는다. 결과를 두 사람이 함께 보기 때문이다(01장 I8).
 */

export const AMORA_TASK_READ_TOOLS = Object.freeze([
  "get_wedding_info",
  "get_budget_summary",
  "get_schedule_summary",
  "get_schedule_events",
  "get_amora_actions",
  "analyze_quote",
  "simulate_guest_guarantee",
] as const);

export type AmoraTaskReadTool = (typeof AMORA_TASK_READ_TOOLS)[number];

const READ_TOOLS: ReadonlySet<string> = new Set(AMORA_TASK_READ_TOOLS);

export function isAmoraTaskReadTool(name: string): name is AmoraTaskReadTool {
  return !isMutatingTool(name) && READ_TOOLS.has(name);
}

/** 맡은 일의 요청 키. 대화 요청 키(`chat:`)와 섞이지 않는다. */
export function amoraTaskRequestKey(taskId: string, runCount: number): string {
  return `task:${taskId}:${Math.max(0, Math.trunc(runCount))}`;
}

export type AmoraTaskToolContext = {
  coupleId: string;
  taskId: string;
  runCount: number;
  weddingContext: ToolExecutionContext["weddingContext"];
};

function refused(name: string, input: Record<string, unknown>): ToolExecutionResult {
  return {
    toolName: name,
    toolInput: input,
    toolOutput: { error_code: "TASK_TOOL_NOT_ALLOWED" },
    success: false,
    displayMessage: "",
  };
}

export async function executeAmoraTaskReadTool(
  name: string,
  input: Record<string, unknown>,
  context: AmoraTaskToolContext,
): Promise<ToolExecutionResult> {
  if (!isAmoraTaskReadTool(name)) return refused(name, input);
  const executionContext: ToolExecutionContext = {
    coupleId: context.coupleId,
    requestKey: amoraTaskRequestKey(context.taskId, context.runCount),
    weddingContext: context.weddingContext,
  };
  return executeTool(name, input, executionContext);
}

/** 커플이 함께 쓰는 계획을 읽는다. 없으면 빈 계획. */
export async function loadAmoraTaskWeddingContext(
  admin: SupabaseClient,
  coupleId: string,
): Promise<ToolExecutionContext["weddingContext"]> {
  const { data, error } = await admin
    .from("wedding_journeys")
    .select("wedding_date, total_budget, venue, progress")
    .eq("couple_id", coupleId)
    .maybeSingle();
  if (error) throw new Error("AMORA_TASK_PLAN_READ_FAILED");
  const progress = data?.progress && typeof data.progress === "object" && !Array.isArray(data.progress)
    ? data.progress as ToolExecutionContext["weddingContext"]["progress"]
    : {};
  return {
    weddingDate: typeof data?.wedding_date === "string" ? data.wedding_date : null,
    budget: typeof data?.total_budget === "number" ? data.total_budget : 0,
    venue: typeof data?.venue === "string" ? data.venue : null,
    progress,
  };
}
