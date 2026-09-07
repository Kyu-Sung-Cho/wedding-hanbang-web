import type {
  AmoraActionPriority,
  AmoraActionSource,
  AmoraActionStatus,
  ProgressItem,
} from "@/types/database.types";

export type { AmoraActionPriority, AmoraActionSource, AmoraActionStatus };

export interface AmoraActionItem {
  id: string;
  title: string;
  description?: string;
  dueDate?: string;
  categoryKey?: string;
  priority: AmoraActionPriority;
  status: AmoraActionStatus;
  source: AmoraActionSource;
  href?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export type ProgressWithAmoraActions = Record<string, ProgressItem | unknown>;

const ACTIONS_KEY = "__amora_actions";
export const MAX_ACTIONS = 80;

function isAction(value: unknown): value is AmoraActionItem {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<AmoraActionItem>;
  return typeof item.id === "string" && typeof item.title === "string";
}

export function normalizeAmoraAction(item: AmoraActionItem): AmoraActionItem {
  return {
    ...item,
    priority: item.priority ?? "medium",
    status: item.status ?? "open",
    source: item.source ?? "chat",
    createdAt: item.createdAt ?? new Date().toISOString(),
    updatedAt: item.updatedAt ?? new Date().toISOString(),
  };
}

export function sortAmoraActions(actions: AmoraActionItem[]): AmoraActionItem[] {
  return [...actions].sort((a, b) => {
    const statusOrder: Record<AmoraActionStatus, number> = { open: 0, done: 1, dismissed: 2 };
    const priorityOrder: Record<AmoraActionPriority, number> = { high: 0, medium: 1, low: 2 };
    const statusDiff = statusOrder[a.status] - statusOrder[b.status];
    if (statusDiff !== 0) return statusDiff;
    const dueA = a.dueDate ?? "9999-12-31";
    const dueB = b.dueDate ?? "9999-12-31";
    if (dueA !== dueB) return dueA.localeCompare(dueB);
    const priorityDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
    if (priorityDiff !== 0) return priorityDiff;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });
}

export function mergeAmoraActions(
  primary: AmoraActionItem[],
  fallback: AmoraActionItem[]
): AmoraActionItem[] {
  const byId = new Map<string, AmoraActionItem>();
  for (const action of [...fallback, ...primary]) {
    byId.set(action.id, normalizeAmoraAction(action));
  }
  return sortAmoraActions([...byId.values()]);
}

export function createAmoraActionId() {
  return `act_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

export function getAmoraActions(progress: ProgressWithAmoraActions | null | undefined): AmoraActionItem[] {
  const raw = (progress?.[ACTIONS_KEY] as unknown[] | undefined) ?? [];
  return sortAmoraActions(raw.filter(isAction).map(normalizeAmoraAction));
}

export function getOpenAmoraActions(progress: ProgressWithAmoraActions | null | undefined): AmoraActionItem[] {
  return getAmoraActions(progress).filter((item) => item.status === "open");
}

export function withAddedAmoraAction(
  progress: ProgressWithAmoraActions,
  action: Omit<AmoraActionItem, "id" | "createdAt" | "updatedAt" | "status"> & {
    id?: string;
    status?: AmoraActionStatus;
    createdAt?: string;
    updatedAt?: string;
  }
) {
  const now = new Date().toISOString();
  const current = getAmoraActions(progress);
  const newAction: AmoraActionItem = normalizeAmoraAction({
    ...action,
    id: action.id ?? createAmoraActionId(),
    status: action.status ?? "open",
    createdAt: action.createdAt ?? now,
    updatedAt: action.updatedAt ?? now,
  });

  return {
    ...progress,
    [ACTIONS_KEY]: [newAction, ...current.filter((item) => item.id !== newAction.id)].slice(0, MAX_ACTIONS),
  };
}

export function withUpdatedAmoraAction(
  progress: ProgressWithAmoraActions,
  actionId: string,
  updates: Partial<Pick<AmoraActionItem, "title" | "description" | "dueDate" | "categoryKey" | "priority" | "status" | "href">>
) {
  const now = new Date().toISOString();
  const current = getAmoraActions(progress);
  const next = current.map((item) => {
    if (item.id !== actionId) return item;
    const completedAt =
      updates.status === "done"
        ? item.status === "done" ? item.completedAt : now
        : updates.status ? undefined : item.completedAt;
    return normalizeAmoraAction({
      ...item,
      ...updates,
      completedAt,
      updatedAt: now,
    });
  });

  return {
    ...progress,
    [ACTIONS_KEY]: next.slice(0, MAX_ACTIONS),
  };
}

export function getActionStatusLabel(status: AmoraActionStatus) {
  if (status === "done") return "완료";
  if (status === "dismissed") return "숨김";
  return "진행 전";
}

export function getActionPriorityLabel(priority: AmoraActionPriority) {
  if (priority === "high") return "중요";
  if (priority === "low") return "가벼움";
  return "보통";
}
