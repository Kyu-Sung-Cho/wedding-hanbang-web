import type { SupabaseClient } from "@supabase/supabase-js";
import type { AmoraAction } from "@/types/database.types";
import {
  MAX_ACTIONS,
  normalizeAmoraAction,
  sanitizeAmoraActionHref,
  sortAmoraActions,
  type AmoraActionItem,
  type AmoraActionPriority,
  type AmoraActionSource,
  type AmoraActionStatus,
} from "@/lib/amora/actions";

const TABLE = "amora_actions";

export class AmoraActionStorageUnavailableError extends Error {
  constructor(message = "amora_actions storage is unavailable") {
    super(message);
    this.name = "AmoraActionStorageUnavailableError";
  }
}

export function isAmoraActionStorageUnavailable(error: unknown): boolean {
  if (error instanceof AmoraActionStorageUnavailableError) return true;
  if (!error || typeof error !== "object") return false;
  const err = error as { code?: string; message?: string };
  const message = err.message ?? "";
  return (
    err.code === "42P01" ||
    err.code === "PGRST205" ||
    /relation\s+["']?(public\.)?amora_actions["']?\s+does not exist/i.test(message) ||
    /could not find .*amora_actions.*schema cache/i.test(message) ||
    /schema cache.*amora_actions/i.test(message)
  );
}

function assertStorageAvailable(error: unknown): never {
  if (isAmoraActionStorageUnavailable(error)) {
    throw new AmoraActionStorageUnavailableError();
  }
  throw error instanceof Error ? error : new Error("Amora action storage failed");
}

export function rowToAmoraAction(row: AmoraAction): AmoraActionItem {
  return normalizeAmoraAction({
    id: row.id,
    title: row.title,
    description: row.description ?? undefined,
    dueDate: row.due_date ?? undefined,
    categoryKey: row.category_key ?? undefined,
    priority: row.priority,
    status: row.status,
    source: row.source,
    href: row.href ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at ?? undefined,
  });
}

function cleanOptional(value: string | undefined, maxLength: number): string | null {
  const trimmed = value?.trim().slice(0, maxLength);
  return trimmed ? trimmed : null;
}

export function amoraActionToRow(
  coupleId: string,
  action: AmoraActionItem,
  createdBy?: string | null
): Omit<AmoraAction, "dismissed_at"> {
  return {
    id: action.id,
    couple_id: coupleId,
    title: action.title.trim().slice(0, 120),
    description: cleanOptional(action.description, 500),
    due_date: cleanOptional(action.dueDate, 40),
    category_key: cleanOptional(action.categoryKey, 80),
    priority: action.priority,
    status: action.status,
    source: action.source,
    href: sanitizeAmoraActionHref(action.href) ?? null,
    metadata: {},
    created_by: createdBy ?? null,
    created_at: action.createdAt,
    updated_at: action.updatedAt,
    completed_at: action.completedAt ?? null,
  };
}

interface ListOptions {
  status?: AmoraActionStatus | "all";
  limit?: number;
}

export async function listAmoraActionRecords(
  client: SupabaseClient,
  coupleId: string,
  options: ListOptions = {}
): Promise<AmoraActionItem[]> {
  let query = client
    .from(TABLE)
    .select("*")
    .eq("couple_id", coupleId)
    .order("created_at", { ascending: false })
    .limit(Math.min(Math.max(options.limit ?? MAX_ACTIONS, 1), MAX_ACTIONS));

  if (options.status && options.status !== "all") {
    query = query.eq("status", options.status);
  }

  const { data, error } = await query;
  if (error) assertStorageAvailable(error);

  return sortAmoraActions(((data ?? []) as AmoraAction[]).map(rowToAmoraAction));
}

export async function insertAmoraActionRecord(
  client: SupabaseClient,
  coupleId: string,
  action: AmoraActionItem,
  createdBy?: string | null
): Promise<AmoraActionItem> {
  const row = amoraActionToRow(coupleId, action, createdBy);
  const { data, error } = await client
    .from(TABLE)
    .upsert(row, { onConflict: "id" })
    .select("*")
    .single();

  if (error) assertStorageAvailable(error);
  return rowToAmoraAction(data as AmoraAction);
}

export interface AmoraActionUpdate {
  title?: string;
  description?: string;
  dueDate?: string;
  categoryKey?: string;
  priority?: AmoraActionPriority;
  status?: AmoraActionStatus;
  source?: AmoraActionSource;
  href?: string;
}

export async function updateAmoraActionRecord(
  client: SupabaseClient,
  coupleId: string,
  actionId: string,
  updates: AmoraActionUpdate
): Promise<AmoraActionItem | null> {
  const payload: Record<string, unknown> = {};
  if (updates.title !== undefined) payload.title = updates.title.trim().slice(0, 120);
  if (updates.description !== undefined) payload.description = cleanOptional(updates.description, 500);
  if (updates.dueDate !== undefined) payload.due_date = cleanOptional(updates.dueDate, 40);
  if (updates.categoryKey !== undefined) payload.category_key = cleanOptional(updates.categoryKey, 80);
  if (updates.priority !== undefined) payload.priority = updates.priority;
  if (updates.status !== undefined) payload.status = updates.status;
  if (updates.source !== undefined) payload.source = updates.source;
  if (updates.href !== undefined) {
    payload.href = sanitizeAmoraActionHref(updates.href) ?? null;
  }

  if (Object.keys(payload).length === 0) {
    const existing = await listAmoraActionRecords(client, coupleId, { status: "all" });
    return existing.find((action) => action.id === actionId) ?? null;
  }

  const { data, error } = await client
    .from(TABLE)
    .update(payload)
    .eq("couple_id", coupleId)
    .eq("id", actionId)
    .select("*")
    .maybeSingle();

  if (error) assertStorageAvailable(error);
  return data ? rowToAmoraAction(data as AmoraAction) : null;
}
