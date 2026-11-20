import type { AmoraTaskKind } from "@hanbang/shared/amora-tasks";
import type { AiToolDefinition } from "@/lib/ai/toolDefinition";
import type { ToolExecutionContext } from "@/lib/ai/tools/toolTypes";
import { createAdminClient } from "@/lib/supabase/admin";
import { ymdInKst } from "@/lib/utils/kstDate";
import type { ToolExecutionResult } from "@/types/database.types";
import { defaultAmoraTaskAdapters, type AmoraTaskAdapters } from "./adapters";
import { AMORA_TASK_OFFER_TTL_SECONDS, isAmoraTasksEnabled } from "./config";
import { AMORA_TASK_KIND_SPECS, DATE_PREFERENCES, DATE_PURPOSES, SDM_FIELDS, cleanTaskText, normalizeAmoraTaskInput } from "./taskKinds";
import { createSupabaseAmoraTaskStore, isAmoraTaskStorageUnavailable, type AmoraTaskStore } from "./taskStore";

/**
 * 대화의 시작 카드 "이 일을 맡을게요"(25장 2절, 허락 규칙 "물어보고 · 카드 한 번").
 *
 * 이 도구는 **카드만 만든다.** 맡은 일은 사람이 카드를 눌러야 시작한다(`POST /api/amora/tasks/:id`).
 * 계획(예산·일정·할 일)은 바꾸지 않으므로 쓰기 도구 목록(`mutationTools.ts`)에 넣지 않는다.
 *
 * - 공유 대화에서만 준다. 결과를 두 사람이 함께 보기 때문이다(I8). DB 도 그 턴의 선점 기록을 다시 본다.
 * - 스위치(`AMORA_TASKS_ENABLED`)가 꺼져 있으면 도구를 주지 않는다.
 * - 찾기가 드는 종류는 갈래 3 이, 편지·답장은 D-83 1단계가 있을 때만 목록에 넣는다.
 */

export const OFFER_AMORA_TASK_TOOL_NAME = "offer_amora_task";

export function availableAmoraTaskKinds(adapters: AmoraTaskAdapters): AmoraTaskKind[] {
  return (Object.keys(AMORA_TASK_KIND_SPECS) as AmoraTaskKind[]).filter((kind) => {
    const needs = AMORA_TASK_KIND_SPECS[kind].needs;
    return needs === "none"
      || (needs === "web_search" && adapters.webSearch !== null)
      || (needs === "inquiry" && adapters.inquiry !== null);
  });
}

const WON = { type: "integer", minimum: 0, maximum: 10_000_000_000 } as const;
const YMD = { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" } as const;

export function buildOfferAmoraTaskTool(kinds: readonly AmoraTaskKind[]): AiToolDefinition {
  return {
    name: OFFER_AMORA_TASK_TOOL_NAME,
    description: [
      "커플이 여러 걸음이 드는 일을 아모라에게 맡기려 할 때 '이 일을 맡을게요' 카드를 만든다.",
      "예: 웨딩홀이나 스드메 후보 찾아 줘, 받은 견적 비교해 줘, 할 일과 마감 정리해 줘, 상견례 날짜 후보 모아 줘.",
      "날짜 후보나 날짜를 골라 달라는 부탁(상견례, 웨딩홀 투어, 스드메 상담, 가족 모임)은 date_candidates 카드다. 주말·평일 바람은 prefer 에 넣는다.",
      "카드만 만들고 시작하지 않는다. 사람이 카드를 눌러야 시작한다. 그래서 '시작했다'고 말하지 않는다.",
      "조건(지역, 하객 수, 날짜 범위, 견적 금액)은 사용자가 이번 대화에서 말한 값만 넣는다. 모르는 값은 넣지 않는다.",
      "결과는 같은 기준으로 모은 표이고 추천이나 순위가 아니다. 계획을 바꾸는 요청이나 업체에 연락하는 요청에는 쓰지 않는다.",
      "kind 별 칸: hall_candidates(region 필수, guest_count, budget_won, date_hint), sdm_candidates(region 필수, field, budget_won),",
      "quote_compare(quotes 2~5개 필수, category), todo_deadlines(horizon_days), date_candidates(purpose, prefer, from_date, to_date),",
      "inquiry_letters(recipients 필수), reply_digest(칸 없음).",
    ].join(" "),
    input_schema: {
      type: "object",
      additionalProperties: false,
      required: ["kind"],
      properties: {
        kind: { type: "string", enum: [...kinds] },
        region: { type: "string", maxLength: 20 },
        guest_count: { type: "integer", minimum: 10, maximum: 2000 },
        budget_won: WON,
        date_hint: { type: "string", maxLength: 20 },
        field: { type: "string", enum: [...SDM_FIELDS] },
        horizon_days: { type: "integer", minimum: 14, maximum: 120 },
        purpose: { type: "string", enum: [...DATE_PURPOSES] },
        prefer: { type: "string", enum: [...DATE_PREFERENCES] },
        from_date: YMD,
        to_date: YMD,
        category: { type: "string", maxLength: 20 },
        quotes: {
          type: "array",
          minItems: 2,
          maxItems: 5,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["label"],
            properties: {
              label: { type: "string", maxLength: 30 },
              total_won: WON,
              items: {
                type: "array",
                maxItems: 12,
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: ["name"],
                  properties: { name: { type: "string", maxLength: 30 }, won: WON },
                },
              },
            },
          },
        },
        recipients: { type: "array", minItems: 1, maxItems: 5, items: { type: "string", maxLength: 30 } },
      },
    },
  };
}

/**
 * 대화 라우트가 이번 턴에 줄 시작 카드 도구. 범위 판정(`filterAmoraToolsByQuestionScope`)은 라우트가 한 번 더 건다.
 */
export function selectAmoraTaskChatTools(input: {
  visibility: string;
  requestKind: string;
  durable: boolean;
  isDemo: boolean;
  env?: NodeJS.ProcessEnv;
  adapters?: AmoraTaskAdapters;
}): AiToolDefinition[] {
  if (!isAmoraTasksEnabled(input.env)) return [];
  if (input.isDemo || !input.durable || input.requestKind !== "chat" || input.visibility !== "shared") return [];
  const kinds = availableAmoraTaskKinds(input.adapters ?? defaultAmoraTaskAdapters());
  return kinds.length > 0 ? [buildOfferAmoraTaskTool(kinds)] : [];
}

const OFFER_FAILURES: Record<string, string> = {
  too_many_offers: "열려 있는 카드가 많아서 새 카드를 만들지 않았어요. 열린 카드를 먼저 맡기거나 그냥 두면 하루 뒤 닫혀요.",
  shared_lane_only: "맡은 일은 함께 쓰는 대화에서만 맡길 수 있어요.",
  deletion_pending: "지금은 이 일을 맡을 수 없어요.",
  not_member: "지금은 이 일을 맡을 수 없어요.",
  request_not_found: "이번 대화를 확인하지 못해서 카드를 만들지 않았어요. 한 번 더 말씀해 주세요.",
};

function failure(input: Record<string, unknown>, errorCode: string, displayMessage: string): ToolExecutionResult {
  return {
    toolName: OFFER_AMORA_TASK_TOOL_NAME,
    toolInput: input,
    toolOutput: { error_code: errorCode },
    success: false,
    displayMessage,
  };
}

export async function executeOfferAmoraTask(
  toolInput: Record<string, unknown>,
  context: ToolExecutionContext,
  deps: { store?: AmoraTaskStore; adapters?: AmoraTaskAdapters; env?: NodeJS.ProcessEnv; todayYmd?: string } = {},
): Promise<ToolExecutionResult> {
  if (!isAmoraTasksEnabled(deps.env)) {
    return failure(toolInput, "tasks_disabled", "지금은 이 일을 맡을 수 없어요.");
  }
  const kinds = availableAmoraTaskKinds(deps.adapters ?? defaultAmoraTaskAdapters());
  const kind = toolInput.kind as AmoraTaskKind;
  if (!kinds.includes(kind)) {
    return failure(toolInput, "task_kind_unavailable", "지금은 이 일을 맡을 수 없어요.");
  }
  if (!context.actorProfileId || !context.requestKey) {
    return failure(toolInput, "task_request_unbound", "이번 대화를 확인하지 못해서 카드를 만들지 않았어요. 한 번 더 말씀해 주세요.");
  }
  const today = deps.todayYmd ?? ymdInKst(new Date());
  const normalized = normalizeAmoraTaskInput(kind, toolInput, today);
  if (!normalized.ok) {
    return {
      ...failure(toolInput, "task_input_invalid", "맡기려면 조건이 조금 더 필요해요. 어떤 조건으로 할지 알려 주세요."),
      toolOutput: { error_code: "task_input_invalid", field: normalized.reason },
    };
  }
  // 찾기 일은 커플이 친 요청 문장을 함께 둔다. 갈래 3 의 검색어 검사(`userTexts`)가 이 문장에 있는 낱말만 네이버로 보낸다.
  const requestText = cleanTaskText(context.currentUserText, 300);
  const taskInput = AMORA_TASK_KIND_SPECS[kind].needs === "web_search" && requestText
    ? { ...normalized.input, request_text: requestText }
    : normalized.input;
  try {
    const store = deps.store ?? createSupabaseAmoraTaskStore(createAdminClient());
    const result = await store.offer({
      coupleId: context.coupleId,
      requestedBy: context.actorProfileId,
      sourceLane: "shared",
      sourceRequestKey: context.requestKey,
      kind,
      title: normalized.title,
      input: taskInput,
      offerTtlSeconds: AMORA_TASK_OFFER_TTL_SECONDS,
    });
    if (!result.ok || !result.taskId) {
      return failure(toolInput, `task_offer_${result.code}`, OFFER_FAILURES[result.code] ?? "지금은 이 일을 맡을 수 없어요.");
    }
    return {
      toolName: OFFER_AMORA_TASK_TOOL_NAME,
      toolInput,
      toolOutput: {
        offer_kind: "amora_task_offer_v1",
        task_id: result.taskId,
        kind,
        title: normalized.title,
        plan: [...AMORA_TASK_KIND_SPECS[kind].plan],
        status: result.status ?? "offered",
        offer_expires_at: result.offerExpiresAt,
        started: false,
      },
      success: true,
      displayMessage: "카드를 만들었어요. 사람이 카드를 눌러야 시작해요.",
    };
  } catch (error) {
    if (isAmoraTaskStorageUnavailable(error)) {
      return failure(toolInput, "tasks_unavailable", "지금은 이 일을 맡을 수 없어요.");
    }
    console.error("[amora-tasks] offer failed", { name: error instanceof Error ? error.name : "UnknownError" });
    return failure(toolInput, "task_offer_failed", "카드를 만들지 못했어요. 잠시 뒤에 다시 말씀해 주세요.");
  }
}
