import type { ChecklistItem, ProgressItem } from "@/types/database.types";

export interface ChecklistItemMutation {
  categoryKey: string;
  itemId: string;
  done: boolean;
  expectedDone: boolean;
}

export interface ChecklistItemMutationResult {
  progress: Record<string, unknown>;
  categoryKey: string;
  itemId: string;
  item: ChecklistItem;
}

export class ChecklistItemConflictError extends Error {
  readonly progress: Record<string, unknown>;

  constructor(message: string, progress: Record<string, unknown>) {
    super(message);
    this.name = "ChecklistItemConflictError";
    this.progress = progress;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isChecklistItem(value: unknown): value is ChecklistItem {
  return isRecord(value) &&
    typeof value.id === "string" && value.id.length > 0 &&
    typeof value.label === "string" && value.label.length > 0 &&
    typeof value.done === "boolean";
}

function getChecklist(
  progress: unknown,
  categoryKey: string,
): ChecklistItem[] | null {
  if (!isRecord(progress)) return null;
  const category = progress[categoryKey];
  if (!isRecord(category) || category.category !== categoryKey) return null;
  if (
    category.status !== "not_started" &&
    category.status !== "in_progress" &&
    category.status !== "completed"
  ) {
    return null;
  }
  const checklist = (category as unknown as ProgressItem).checklist;
  if (!Array.isArray(checklist) || !checklist.every(isChecklistItem)) return null;
  const ids = checklist.map((item) => item.id);
  return new Set(ids).size === ids.length ? checklist : null;
}

function getConfirmedResult(
  body: unknown,
  mutation: ChecklistItemMutation,
): ChecklistItemMutationResult | null {
  if (
    !isRecord(body) ||
    !isRecord(body.progress) ||
    body.categoryKey !== mutation.categoryKey ||
    body.itemId !== mutation.itemId ||
    !isChecklistItem(body.item)
  ) {
    return null;
  }
  const checklist = getChecklist(body.progress, mutation.categoryKey);
  const stored = checklist?.find((item) => item.id === mutation.itemId);
  if (
    !stored ||
    stored.done !== mutation.done ||
    body.item.id !== stored.id ||
    body.item.label !== stored.label ||
    body.item.done !== stored.done
  ) {
    return null;
  }
  return body as unknown as ChecklistItemMutationResult;
}

export async function mutateChecklistItem(
  mutation: ChecklistItemMutation,
  fetcher: typeof fetch = fetch,
): Promise<ChecklistItemMutationResult> {
  const response = await fetcher("/api/journey/checklist-items", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(mutation),
  });
  const body = await response.json().catch(() => null) as unknown;

  if (!response.ok) {
    const message = isRecord(body) && typeof body.error === "string"
      ? body.error
      : "체크리스트를 저장하지 못했습니다.";
    if (
      response.status === 409 &&
      isRecord(body) &&
      isRecord(body.progress) &&
      getChecklist(body.progress, mutation.categoryKey)
    ) {
      throw new ChecklistItemConflictError(message, body.progress);
    }
    throw new Error(message);
  }

  const result = getConfirmedResult(body, mutation);
  if (!result) {
    throw new Error("저장된 체크리스트 상태를 확인하지 못했습니다. 새로고침 후 다시 시도해 주세요.");
  }
  return result;
}
