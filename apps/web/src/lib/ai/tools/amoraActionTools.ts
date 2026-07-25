import { createAdminClient } from "@/lib/supabase/admin";
import {
  createAmoraActionId,
  getActionStatusLabel,
  getAmoraActions,
  mergeAmoraActions,
  normalizeAmoraAction,
  withAddedAmoraAction,
  withUpdatedAmoraAction,
  type AmoraActionItem,
  type AmoraActionPriority,
  type AmoraActionSource,
  type AmoraActionStatus,
} from "@/lib/amora/actions";
import {
  insertAmoraActionRecord,
  isAmoraActionStorageUnavailable,
  listAmoraActionRecords,
  updateAmoraActionRecord,
  type AmoraActionUpdate,
} from "@/lib/amora/actionRepository";
import { weddingPath } from "@/lib/weddingPaths";
import { saveProgress } from "@/lib/ai/tools/progressTools";
import {
  objectParticle,
  type ToolExecutionContext,
} from "@/lib/ai/tools/toolTypes";
import type { ToolExecutionResult } from "@/types/database.types";

function getAdminClient() {
  return createAdminClient();
}

function normalizeActionPriority(value: unknown): AmoraActionPriority {
  return value === "high" || value === "low" || value === "medium" ? value : "medium";
}

function normalizeActionSource(value: unknown): AmoraActionSource {
  if (
    value === "quote" ||
    value === "schedule" ||
    value === "budget" ||
    value === "guardrail" ||
    value === "manual" ||
    value === "chat"
  ) {
    return value;
  }
  return "chat";
}

function normalizeActionStatus(value: unknown): AmoraActionStatus | undefined {
  if (value === "open" || value === "done" || value === "dismissed") return value;
  return undefined;
}

function getDefaultActionHref(categoryKey?: string, source?: AmoraActionSource) {
  if (source === "quote") return weddingPath("/community/quote-check");
  if (source === "budget") return weddingPath("/budget");
  if (source === "schedule") return weddingPath("/schedule");
  if (categoryKey === "invitation") return weddingPath("/schedule");
  // 가족 조율 페이지는 제거됐다(2026-07-25) — 사회·답례품처럼 가족 합의가 필요한
  // 항목은 일반 안내보다 아모라와 상황을 정리하는 쪽으로 보낸다.
  if (categoryKey === "mc" || categoryKey === "gift") return weddingPath("/chat");
  return weddingPath("/lounge");
}

async function listStoredAmoraActions(ctx: ToolExecutionContext): Promise<AmoraActionItem[] | null> {
  try {
    return await listAmoraActionRecords(getAdminClient(), ctx.coupleId, { status: "all" });
  } catch (error) {
    if (!isAmoraActionStorageUnavailable(error)) {
      console.warn("amora action table read skipped:", error instanceof Error ? error.message : String(error));
    }
    return null;
  }
}

async function getAmoraActionSnapshot(ctx: ToolExecutionContext): Promise<AmoraActionItem[]> {
  const legacy = getAmoraActions(ctx.weddingContext.progress as Record<string, unknown>);
  const stored = await listStoredAmoraActions(ctx);
  return stored ? mergeAmoraActions(stored, legacy) : legacy;
}

async function mirrorAmoraActionToProgress(
  ctx: ToolExecutionContext,
  action: AmoraActionItem,
  mode: "add" | "update"
): Promise<void> {
  try {
    const currentProgress = ctx.weddingContext.progress as Record<string, unknown>;
    const legacyHasAction = getAmoraActions(currentProgress).some((item) => item.id === action.id);
    const shouldAddToLegacy = mode === "add" || !legacyHasAction;
    const newProgress = shouldAddToLegacy
      ? withAddedAmoraAction(currentProgress, action)
      : withUpdatedAmoraAction(currentProgress, action.id, {
          title: action.title,
          description: action.description,
          dueDate: action.dueDate,
          categoryKey: action.categoryKey,
          priority: action.priority,
          status: action.status,
          href: action.href,
        });

    await saveProgress(ctx, newProgress);
  } catch (error) {
    console.warn("amora action progress mirror skipped:", error instanceof Error ? error.message : String(error));
  }
}

export async function executeAddAmoraAction(
  input: Record<string, unknown>,
  ctx: ToolExecutionContext
): Promise<ToolExecutionResult> {
  const title = String(input.title ?? "").trim();
  if (!title) {
    return {
      toolName: "add_amora_action",
      toolInput: input,
      toolOutput: { error: "title is required" },
      success: false,
      displayMessage: "저장할 행동 제목이 필요합니다.",
    };
  }

  const categoryKey = input.category_key && input.category_key !== "general"
    ? String(input.category_key)
    : undefined;
  const source = normalizeActionSource(input.source);
  const href = typeof input.href === "string" && input.href.startsWith("/")
    ? input.href
    : getDefaultActionHref(categoryKey, source);
  const actionId = createAmoraActionId();
  const now = new Date().toISOString();
  const draftAction = normalizeAmoraAction({
    id: actionId,
    title: title.slice(0, 80),
    description: typeof input.description === "string" ? input.description.slice(0, 300) : undefined,
    dueDate: typeof input.due_date === "string" ? input.due_date : undefined,
    categoryKey,
    priority: normalizeActionPriority(input.priority),
    source,
    href,
    status: "open",
    createdAt: now,
    updatedAt: now,
  });

  let action = draftAction;
  try {
    action = await insertAmoraActionRecord(getAdminClient(), ctx.coupleId, draftAction);
  } catch (error) {
    if (!isAmoraActionStorageUnavailable(error)) {
      console.warn("amora action table insert skipped:", error instanceof Error ? error.message : String(error));
    }
  }

  await mirrorAmoraActionToProgress(ctx, action, "add");
  const actions = await getAmoraActionSnapshot(ctx);

  return {
    toolName: "add_amora_action",
    toolInput: input,
    toolOutput: { action, actions_count: actions.filter((item) => item.status === "open").length },
    success: true,
    displayMessage: `"${title}"${objectParticle(title)} 아모라 행동 카드에 저장했습니다.`,
  };
}

export async function executeGetAmoraActions(
  input: Record<string, unknown>,
  ctx: ToolExecutionContext
): Promise<ToolExecutionResult> {
  const status = typeof input.status === "string" ? input.status : "open";
  const allActions = await getAmoraActionSnapshot(ctx);
  const actions = status === "all"
    ? allActions
    : allActions.filter((item) => item.status === status);

  return {
    toolName: "get_amora_actions",
    toolInput: input,
    toolOutput: {
      actions,
      count: actions.length,
      open_count: allActions.filter((item) => item.status === "open").length,
    },
    success: true,
    displayMessage: actions.length > 0
      ? `아모라가 기억한 행동 ${actions.length}개: ${actions.slice(0, 5).map((item) => item.title).join(", ")}`
      : "현재 열려 있는 아모라 행동 카드가 없습니다.",
  };
}

export async function executeUpdateAmoraAction(
  input: Record<string, unknown>,
  ctx: ToolExecutionContext
): Promise<ToolExecutionResult> {
  const actionId = String(input.action_id ?? "");
  const currentProgress = ctx.weddingContext.progress as Record<string, unknown>;
  const currentActions = await getAmoraActionSnapshot(ctx);
  const existing = currentActions.find((item) => item.id === actionId);
  const legacyHasAction = getAmoraActions(currentProgress).some((item) => item.id === actionId);

  if (!existing) {
    return {
      toolName: "update_amora_action",
      toolInput: input,
      toolOutput: { error: "action not found", action_id: actionId },
      success: false,
      displayMessage: "수정할 아모라 행동 카드를 찾지 못했습니다.",
    };
  }

  const updates: Partial<Pick<AmoraActionItem, "title" | "description" | "dueDate" | "priority" | "status" | "href">> = {};
  if (typeof input.title === "string") updates.title = input.title.slice(0, 80);
  if (typeof input.description === "string") updates.description = input.description.slice(0, 300);
  if (typeof input.due_date === "string") updates.dueDate = input.due_date;
  if (typeof input.href === "string" && input.href.startsWith("/")) updates.href = input.href;
  if (input.priority !== undefined) updates.priority = normalizeActionPriority(input.priority);
  if (input.status !== undefined) {
    const status = normalizeActionStatus(input.status);
    if (status) updates.status = status;
  }

  let updated: AmoraActionItem | null | undefined = null;
  let storageUnavailable = false;
  const storageUpdates: AmoraActionUpdate = {
    title: updates.title,
    description: updates.description,
    dueDate: updates.dueDate,
    priority: updates.priority,
    status: updates.status,
    href: updates.href,
  };

  try {
    updated = await updateAmoraActionRecord(getAdminClient(), ctx.coupleId, actionId, storageUpdates);
  } catch (error) {
    if (isAmoraActionStorageUnavailable(error)) {
      storageUnavailable = true;
    } else {
      console.error("amora action table update failed:", error instanceof Error ? error.message : String(error));
      return {
        toolName: "update_amora_action",
        toolInput: input,
        toolOutput: { error: "action table update failed", action_id: actionId },
        success: false,
        displayMessage: "아모라 행동 카드를 수정하지 못했습니다. 잠시 후 다시 시도해주세요.",
      };
    }
  }

  if (updated) {
    await mirrorAmoraActionToProgress(ctx, updated, "update");
  } else if (legacyHasAction) {
    const newProgress = withUpdatedAmoraAction(currentProgress, actionId, updates);
    await saveProgress(ctx, newProgress);
    updated = getAmoraActions(newProgress).find((item) => item.id === actionId);
  } else {
    return {
      toolName: "update_amora_action",
      toolInput: input,
      toolOutput: {
        error: storageUnavailable ? "action storage unavailable" : "action not updated",
        action_id: actionId,
      },
      success: false,
      displayMessage: "아모라 행동 카드를 수정하지 못했습니다. 잠시 후 다시 시도해주세요.",
    };
  }

  return {
    toolName: "update_amora_action",
    toolInput: input,
    toolOutput: { action: updated },
    success: true,
    displayMessage: updated
      ? `"${updated.title}" 행동 카드가 ${getActionStatusLabel(updated.status)} 상태로 변경되었습니다.`
      : "아모라 행동 카드가 수정되었습니다.",
  };
}
