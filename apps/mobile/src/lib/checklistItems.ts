export interface MobileChecklistItem {
  id: string;
  label: string;
  done: boolean;
}

interface ChecklistItemMutation {
  categoryKey: string;
  itemId: string;
  done: boolean;
  expectedDone: boolean;
}

export interface ChecklistItemMutationResult {
  progress: Record<string, unknown>;
  categoryKey: string;
  itemId: string;
  item: MobileChecklistItem;
}

type ApiFetcher = (path: string, options?: RequestInit) => Promise<Response>;

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

function isChecklistItem(value: unknown): value is MobileChecklistItem {
  return isRecord(value) &&
    typeof value.id === "string" && value.id.length > 0 &&
    typeof value.label === "string" && value.label.length > 0 &&
    typeof value.done === "boolean";
}

function getChecklist(progress: unknown, categoryKey: string): MobileChecklistItem[] | null {
  if (!isRecord(progress)) return null;
  const category = progress[categoryKey];
  if (
    !isRecord(category) ||
    category.category !== categoryKey ||
    !["not_started", "in_progress", "completed"].includes(String(category.status)) ||
    !Array.isArray(category.checklist) ||
    !category.checklist.every(isChecklistItem)
  ) {
    return null;
  }
  const ids = category.checklist.map((item) => item.id);
  return new Set(ids).size === ids.length ? category.checklist : null;
}

export async function mutateChecklistItem(
  mutation: ChecklistItemMutation,
  apiFetch: ApiFetcher,
): Promise<ChecklistItemMutationResult> {
  const response = await apiFetch("/api/journey/checklist-items", {
    method: "POST",
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

  if (
    !isRecord(body) ||
    !isRecord(body.progress) ||
    body.categoryKey !== mutation.categoryKey ||
    body.itemId !== mutation.itemId ||
    !isChecklistItem(body.item)
  ) {
    throw new Error("저장된 체크리스트 상태를 확인하지 못했습니다.");
  }
  const checklist = getChecklist(body.progress, mutation.categoryKey);
  const item = checklist?.find((candidate) => candidate.id === mutation.itemId);
  if (
    !item ||
    item.done !== mutation.done ||
    item.id !== body.item.id ||
    item.label !== body.item.label ||
    item.done !== body.item.done
  ) {
    throw new Error("저장된 체크리스트 상태를 확인하지 못했습니다.");
  }

  return body as unknown as ChecklistItemMutationResult;
}
