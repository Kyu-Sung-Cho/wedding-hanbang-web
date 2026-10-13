import type { SupabaseClient } from "@supabase/supabase-js";
import { compareChatTimestamps } from "@hanbang/shared";
import type { AmoraAction } from "@/types/database.types";
import { isRecord } from "@/utils/requestValidation";
import { InvalidAmoraActionHrefError, isSafeAmoraActionHref, parseAmoraActionHref } from "./actionHref";
import {
  MAX_ACTIONS,
  isAmoraActionViewVersion,
  mergeAmoraActions,
  normalizeAmoraAction,
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
  const link = parseAmoraActionHref(action.href);
  if (!link.ok) throw new InvalidAmoraActionHrefError();
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
    href: link.href,
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
    .order("id", { ascending: false })
    .limit(Math.min(Math.max(options.limit ?? MAX_ACTIONS, 1), MAX_ACTIONS));

  if (options.status && options.status !== "all") {
    query = query.eq("status", options.status);
  }

  const { data, error } = await query;
  if (error) assertStorageAvailable(error);
  return sortAmoraActions(((data ?? []) as AmoraAction[]).map(rowToAmoraAction));
}

export interface AmoraActionSnapshot {
  actions: AmoraActionItem[];
  count: number;
  openCount: number;
  source: "table" | "legacy";
}

/** 상태별로 조회 제한을 적용하고, 예전 JSON 카드의 현재 상태만 ID로 대조한다. */
export async function readAmoraActionSnapshot(
  client: SupabaseClient,
  coupleId: string,
  legacy: AmoraActionItem[],
  status: AmoraActionStatus | "all" = "all",
): Promise<AmoraActionSnapshot> {
  const legacyActions = sortAmoraActions(legacy).slice(0, MAX_ACTIONS);
  const statuses: AmoraActionStatus[] = status === "all" ? ["open", "done", "dismissed"] : [status];

  try {
    const pages = await Promise.all(statuses.map(async (selectedStatus) => {
      const { data, error, count } = await client.from(TABLE)
        .select("*", { count: "exact" })
        .eq("couple_id", coupleId)
        .eq("status", selectedStatus)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(MAX_ACTIONS);
      if (error) assertStorageAvailable(error);
      if (count === null || count === undefined) throw new Error("Amora action count unavailable");
      return { status: selectedStatus, count, actions: ((data ?? []) as AmoraAction[]).map(rowToAmoraAction) };
    }));

    let openCount = pages.find((page) => page.status === "open")?.count;
    if (openCount === undefined) {
      const { count, error } = await client.from(TABLE)
        .select("id", { count: "exact", head: true })
        .eq("couple_id", coupleId)
        .eq("status", "open");
      if (error) assertStorageAvailable(error);
      if (count === null || count === undefined) throw new Error("Amora action count unavailable");
      openCount = count;
    }

    let reconciled: AmoraActionItem[] = [];
    if (legacyActions.length > 0) {
      const { data, error } = await client.from(TABLE).select("*")
        .eq("couple_id", coupleId)
        .in("id", legacyActions.map((action) => action.id))
        .limit(MAX_ACTIONS);
      if (error) assertStorageAvailable(error);
      reconciled = ((data ?? []) as AmoraAction[]).map(rowToAmoraAction);
    }
    const storedIds = new Set(reconciled.map((action) => action.id));
    const legacyOnly = legacyActions.filter((action) => !storedIds.has(action.id));
    const merged = mergeAmoraActions([...pages.flatMap((page) => page.actions), ...reconciled], legacyActions);
    const matching = (action: AmoraActionItem) => status === "all" || action.status === status;
    return {
      actions: merged.filter(matching).slice(0, MAX_ACTIONS),
      count: pages.reduce((sum, page) => sum + page.count, 0) + legacyOnly.filter(matching).length,
      openCount: openCount + legacyOnly.filter((action) => action.status === "open").length,
      source: "table",
    };
  } catch (error) {
    if (!isAmoraActionStorageUnavailable(error)) throw error;
    const actions = legacyActions.filter((action) => status === "all" || action.status === status);
    return { actions, count: actions.length, openCount: legacyActions.filter((action) => action.status === "open").length, source: "legacy" };
  }
}

type ActionPagePosition = { createdAt: string; id: string };
type ActionPageCursor = {
  version: 1; coupleId: string; status: AmoraActionStatus | "all";
  table: ActionPagePosition | null; legacy: ActionPagePosition | null;
};
export class InvalidAmoraActionCursorError extends Error {}

function validPagePosition(value: unknown): value is ActionPagePosition | null {
  if (value === null) return true;
  if (!value || typeof value !== "object") return false;
  const position = value as Partial<ActionPagePosition>;
  return typeof position.createdAt === "string"
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(position.createdAt)
    && compareChatTimestamps(position.createdAt, position.createdAt) === 0
    && typeof position.id === "string" && position.id.length > 0 && position.id.length <= 256
    && !/[\u0000-\u001f]/.test(position.id);
}

function parseActionPageCursor(raw: string | null, coupleId: string, status: AmoraActionStatus | "all"): ActionPageCursor {
  if (raw === null) return { version: 1, coupleId, status, table: null, legacy: null };
  try {
    if (raw.length > 2048 || !/^[A-Za-z0-9_-]+$/.test(raw)) throw new Error();
    const cursor: unknown = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    if (!cursor || typeof cursor !== "object") throw new Error();
    const value = cursor as ActionPageCursor;
    if (value.version !== 1 || value.coupleId !== coupleId || value.status !== status
        || !validPagePosition(value.table) || !validPagePosition(value.legacy)) throw new Error();
    return value;
  } catch { throw new InvalidAmoraActionCursorError(); }
}

function compareActionPositions(left: ActionPagePosition, right: ActionPagePosition): number {
  return (compareChatTimestamps(right.createdAt, left.createdAt) ?? 0) || right.id.localeCompare(left.id);
}

function actionPosition(action: AmoraActionItem): ActionPagePosition {
  return { createdAt: action.createdAt, id: action.id };
}

/** UI 전용 등록 최신순 페이지. AI의 우선순위 snapshot과 표시 상한은 유지한다. */
export async function readAmoraActionPage(
  client: SupabaseClient, coupleId: string, legacy: AmoraActionItem[],
  status: AmoraActionStatus | "all", limit: number, rawCursor: string | null,
): Promise<AmoraActionSnapshot & { nextCursor: string | null }> {
  const cursor = parseActionPageCursor(rawCursor, coupleId, status);
  const pageLimit = Math.min(Math.max(limit, 1), MAX_ACTIONS);
  // 과거 JSON에 시각이 없더라도 요청마다 now로 바뀌어 cursor가 흔들리지 않는다.
  const legacyActions = [...new Map(legacy.map((action) => [action.id, {
    ...action, createdAt: validPagePosition(actionPosition(action)) ? action.createdAt : "1970-01-01T00:00:00.000Z",
  }])).values()].sort(compareActionPositions);
  const matching = (action: AmoraActionItem) => status === "all" || action.status === status;
  const makePage = (tableRows: AmoraActionItem[], legacyOnly: AmoraActionItem[], count: number, openCount: number, source: "table" | "legacy") => {
    const remainingLegacy = legacyOnly.filter((action) => matching(action)
      && (!cursor.legacy || compareActionPositions(action, cursor.legacy) > 0));
    const actions: AmoraActionItem[] = [];
    let tableIndex = 0; let legacyIndex = 0;
    const next = { ...cursor };
    // 각 저장소의 cursor를 따로 전진시킨다. DB text collation과 JS의 tie 정렬이
    // 다르더라도 아직 내보내지 않은 canonical 행을 건너뛰지 않는다.
    while (actions.length < pageLimit && (tableIndex < tableRows.length || legacyIndex < remainingLegacy.length)) {
      const table = tableRows[tableIndex]; const old = remainingLegacy[legacyIndex];
      if (table && (!old || compareActionPositions(table, old) <= 0)) {
        actions.push(table); next.table = actionPosition(table); tableIndex += 1;
      } else {
        actions.push(old); next.legacy = actionPosition(old); legacyIndex += 1;
      }
    }
    const hasMore = tableIndex < tableRows.length || legacyIndex < remainingLegacy.length;
    return { actions, count, openCount, source,
      nextCursor: hasMore ? Buffer.from(JSON.stringify(next)).toString("base64url") : null };
  };
  try {
    const countStatus = async (selectedStatus: AmoraActionStatus | "all") => {
      let query = client.from(TABLE).select("id", { count: "exact", head: true }).eq("couple_id", coupleId);
      if (selectedStatus !== "all") query = query.eq("status", selectedStatus);
      const { count, error } = await query;
      if (error) assertStorageAvailable(error);
      if (count === null || count === undefined || !Number.isSafeInteger(count) || count < 0) throw new Error("Amora action count unavailable");
      return count;
    };
    let query = client.from(TABLE).select("*").eq("couple_id", coupleId)
      .order("created_at", { ascending: false }).order("id", { ascending: false }).limit(pageLimit + 1);
    if (status !== "all") query = query.eq("status", status);
    if (cursor.table) {
      // 시각은 엄격한 ISO이고, ID는 PostgREST의 인용 값으로 이스케이프한다.
      const escapedId = cursor.table.id.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
      query = query.or(`created_at.lt.${cursor.table.createdAt},and(created_at.eq.${cursor.table.createdAt},id.lt."${escapedId}")`);
    }
    const [page, count, openCount] = await Promise.all([query, countStatus(status), status === "open" ? Promise.resolve<number | null>(null) : countStatus("open")]);
    if (page.error) assertStorageAvailable(page.error);
    // 현재 페이지 밖의 canonical 행도 legacy를 덮는다. 조회 IN 목록만80씩 나누며
    // 원래 JSON 배열의91번째 이후 항목을 잘라서 잃지 않는다.
    const storedIds = new Set<string>();
    for (let start = 0; start < legacyActions.length; start += MAX_ACTIONS) {
      const ids = legacyActions.slice(start, start + MAX_ACTIONS).map((action) => action.id);
      const { data, error } = await client.from(TABLE).select("id").eq("couple_id", coupleId).in("id", ids).limit(ids.length);
      if (error) assertStorageAvailable(error);
      for (const row of data ?? []) storedIds.add(row.id);
    }
    const legacyOnly = legacyActions.filter((action) => !storedIds.has(action.id));
    return makePage(((page.data ?? []) as AmoraAction[]).map(rowToAmoraAction), legacyOnly,
      count + legacyOnly.filter(matching).length,
      (openCount ?? count) + legacyOnly.filter((action) => action.status === "open").length, "table");
  } catch (error) {
    if (!isAmoraActionStorageUnavailable(error)) throw error;
    if (cursor.table) throw new Error("Amora action storage changed during pagination");
    return makePage([], legacyActions, legacyActions.filter(matching).length,
      legacyActions.filter((action) => action.status === "open").length, "legacy");
  }
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

export async function getAmoraActionRecord(
  client: SupabaseClient,
  coupleId: string,
  actionId: string,
): Promise<AmoraActionItem | null> {
  const { data, error } = await client.from(TABLE).select("*")
    .eq("couple_id", coupleId)
    .eq("id", actionId)
    .maybeSingle();
  if (error) assertStorageAvailable(error);
  return data ? rowToAmoraAction(data as AmoraAction) : null;
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
  const payload = amoraActionUpdatesToPayload(updates);

  if (Object.keys(payload).length === 0) {
    return getAmoraActionRecord(client, coupleId, actionId);
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

export function amoraActionUpdatesToPayload(updates: AmoraActionUpdate): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  if (updates.title !== undefined) payload.title = updates.title.trim().slice(0, 120);
  if (updates.description !== undefined) payload.description = cleanOptional(updates.description, 500);
  if (updates.dueDate !== undefined) payload.due_date = cleanOptional(updates.dueDate, 40);
  if (updates.categoryKey !== undefined) payload.category_key = cleanOptional(updates.categoryKey, 80);
  if (updates.priority !== undefined) payload.priority = updates.priority;
  if (updates.status !== undefined) payload.status = updates.status;
  if (updates.source !== undefined) payload.source = updates.source;
  if (updates.href !== undefined) {
    const link = parseAmoraActionHref(updates.href);
    if (!link.ok) throw new InvalidAmoraActionHrefError();
    payload.href = link.href;
  }

  return payload;
}

/** 수동 API 전용. AI 승인/감사 경로의 admin helper는 위에 그대로 둔다. */
export async function patchOwnAmoraActionView(
  client: SupabaseClient,
  coupleId: string,
  actionId: string,
  expectedUpdatedAt: string,
  updates: AmoraActionUpdate,
): Promise<AmoraActionItem | null> {
  const payload = amoraActionUpdatesToPayload(updates);
  const { data, error } = await client.rpc("patch_own_amora_action_view_v2", {
    p_couple_id: coupleId, p_action_id: actionId, p_expected_updated_at: expectedUpdatedAt,
    p_values: payload,
  });
  if (error) throw error;
  if (data === null) return null;
  const action = checkedAmoraActionViewReceipt(data, coupleId, actionId, expectedUpdatedAt);
  if (!isRecord(data) || Object.entries(payload).some(([key, value]) => data[key] !== value)) {
    throw new AmoraActionStorageUnavailableError("Amora action checked receipt does not match the approved change");
  }
  return action;
}

function checkedAmoraActionViewReceipt(data: unknown, coupleId: string, actionId: string, expectedUpdatedAt: string | null): AmoraActionItem {
  const unavailable = () => new AmoraActionStorageUnavailableError("Amora action checked receipt is unavailable");
  if (!isRecord(data) || data.id !== actionId || data.couple_id !== coupleId
    || typeof data.title !== "string" || !data.title.trim() || [...data.title].length > 120) throw unavailable();
  const version = isAmoraActionViewVersion(data.updated_at) ? data.updated_at : null;
  if (expectedUpdatedAt !== null && (!version || compareChatTimestamps(version, expectedUpdatedAt) !== 1)) throw unavailable();
  const priority = data.priority; const status = data.status; const source = data.source;
  if ((priority !== "high" && priority !== "medium" && priority !== "low")
    || (status !== "open" && status !== "done" && status !== "dismissed")
    || (source !== "chat" && source !== "quote" && source !== "schedule" && source !== "budget" && source !== "guardrail" && source !== "manual")) throw unavailable();
  for (const [field, limit] of [["description", 500], ["due_date", 40], ["category_key", 80], ["href", 180]] as const) {
    const value = data[field];
    if (value != null && (typeof value !== "string" || [...value].length > limit)) throw unavailable();
  }
  const safeHref = data.href == null || isSafeAmoraActionHref(data.href);
  if (expectedUpdatedAt !== null && !safeHref) throw unavailable();
  for (const field of ["created_at", "completed_at", "dismissed_at"] as const) {
    if (data[field] != null && !isAmoraActionViewVersion(data[field])) throw unavailable();
  }
  return {
    id: actionId, title: data.title, priority, status, source,
    description: typeof data.description === "string" ? data.description : undefined,
    dueDate: typeof data.due_date === "string" ? data.due_date : undefined,
    categoryKey: typeof data.category_key === "string" ? data.category_key : undefined,
    href: safeHref && typeof data.href === "string" ? data.href : undefined,
    // 시각 없는 옛 JSON은 GET과 같은 정렬 표식만 쓴다. updatedAt은 절대 발급하지 않는다.
    createdAt: typeof data.created_at === "string" ? data.created_at : "1970-01-01T00:00:00.000Z",
    updatedAt: version ?? "1970-01-01T00:00:00.000Z",
    viewVersion: safeHref ? version : null,
    completedAt: typeof data.completed_at === "string" ? data.completed_at : undefined,
  };
}

/** 충돌 회복용 한 건 조회다. canonical 장애를 legacy 부재/정상으로 바꾸지 않는다. */
export async function getOwnAmoraActionView(client: SupabaseClient, coupleId: string, actionId: string): Promise<AmoraActionItem | null> {
  const canonical = await client.from(TABLE)
    .select("id,couple_id,title,description,due_date,category_key,priority,status,source,href,created_at,updated_at,completed_at,dismissed_at")
    .eq("couple_id", coupleId).eq("id", actionId).maybeSingle();
  if (canonical.error) throw canonical.error;
  if (canonical.data !== null) return checkedAmoraActionViewReceipt(canonical.data, coupleId, actionId, null);
  const journey = await client.from("wedding_journeys").select("progress").eq("couple_id", coupleId).maybeSingle();
  if (journey.error) throw journey.error;
  if (journey.data === null) return null;
  if (!isRecord(journey.data) || !isRecord(journey.data.progress)) throw new AmoraActionStorageUnavailableError();
  const raw = journey.data.progress.__amora_actions;
  if (raw === undefined) return null;
  if (!Array.isArray(raw)) throw new AmoraActionStorageUnavailableError();
  const matches = raw.filter(value => isRecord(value) && String(value.id) === actionId);
  if (matches.length === 0) return null;
  if (matches.length !== 1 || !isRecord(matches[0])) throw new AmoraActionStorageUnavailableError();
  const item = matches[0];
  return checkedAmoraActionViewReceipt({ id: item.id, couple_id: coupleId, title: item.title, description: item.description,
    priority: item.priority, status: item.status, source: item.source, href: item.href, due_date: item.dueDate, category_key: item.categoryKey,
    created_at: item.createdAt, updated_at: item.updatedAt, completed_at: item.completedAt, dismissed_at: item.dismissedAt }, coupleId, actionId, null);
}

export async function mutateOwnAmoraActionRecord(
  client: SupabaseClient,
  coupleId: string,
  actionId: string,
  operation: "create" | "update",
  updates: AmoraActionUpdate,
): Promise<AmoraActionItem | null> {
  const { data, error } = await client.rpc("mutate_own_amora_action", {
    p_couple_id: coupleId, p_action_id: actionId, p_operation: operation,
    p_values: amoraActionUpdatesToPayload(updates),
  });
  if (error) throw error;
  return data ? rowToAmoraAction(data as AmoraAction) : null;
}

export function getManualAmoraActionFailure(error: unknown): { status: number; code: string; error: string } | null {
  const code = error && typeof error === "object" && "code" in error ? error.code : null;
  if (code === "42501") return { status: 403, code: "AMORA_ACTION_SCOPE_DENIED", error: "현재 연결된 커플의 준비 기록만 변경할 수 있어요. 화면을 새로 열어 주세요." };
  if (code === "40001") return { status: 409, code: "AMORA_ACTION_CONFLICT", error: "다른 변경과 겹쳐 저장하지 못했어요. 최신 기록을 불러온 뒤 변경 내용을 다시 확인해 주세요." };
  if (isAmoraActionStorageUnavailable(error) || code === "PGRST202" || code === "42883" || code === "55000"
    || code === "55P03" || code === "40P01" || code === "57014") return { status: 503, code: "AMORA_ACTION_UNAVAILABLE", error: "준비 기록의 저장 상태를 확인하지 못했어요. 잠시 후 다시 시도해 주세요." };
  if (code === "22023") return { status: 400, code: "AMORA_ACTION_INVALID_INPUT", error: "변경할 내용을 확인한 뒤 다시 시도해 주세요." };
  return null;
}
