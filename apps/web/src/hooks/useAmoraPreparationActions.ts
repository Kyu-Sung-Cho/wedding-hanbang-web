"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { z } from "zod";
import { getAmoraActions, type AmoraActionItem, type AmoraActionStatus } from "@/lib/amora/actions";
import { useAuthStore } from "@/stores/authStore";
import { DEMO_PREPARATION_ACTIONS } from "@/lib/amora/preparationBoard";
import { cleanOptionalText } from "@/utils/requestValidation";
import { boundedRequest, RequestDeadlineError } from "@/lib/journey/boundedRequest";
import { claimPreparationCreate, clearPreparationCreate, finishPreparationCreate, getPreparationCreate,
  preparationCreateRevision, preparationCreateScope, preparationOwnerEpoch, subscribePreparationCreates } from "@/lib/amora/pendingPreparationCreate";
import { beginPreparationUpdate, clearPreparationUpdate, getPreparationUpdate, listPreparationUpdates,
  markPreparationUpdateUnknown, preparationUpdateRevision, preparationWriteSequence, settlePreparationUpdate,
  subscribePreparationUpdates } from "@/lib/amora/pendingPreparationUpdate";

const actionSchema = z.object({
  id: z.string().min(1), title: z.string().min(1), description: z.string().nullish().transform(value => value ?? undefined),
  dueDate: z.string().nullish().transform(value => value ?? undefined), categoryKey: z.string().optional(),
  priority: z.enum(["high", "medium", "low"]), status: z.enum(["open", "done", "dismissed"]),
  source: z.enum(["chat", "quote", "schedule", "budget", "guardrail", "manual"]),
  href: z.string().optional(), createdAt: z.string(), updatedAt: z.string(), completedAt: z.string().optional(),
});
const snapshotSchema = z.object({
  actions: z.array(actionSchema).max(80), count: z.number().int().nonnegative(),
  open_count: z.number().int().nonnegative(), truncated: z.boolean().optional(),
  next_cursor: z.string().min(1).max(2_048).nullable().optional(),
}).refine((value) => value.count >= value.actions.length && value.open_count <= value.count);

export type AmoraPreparationActionUpdate = { status?: AmoraActionStatus; category_key?: string; title?: string; description?: string; due_date?: string };
export type AmoraPreparationActionCreate = { title: string; category_key?: string; description?: string; due_date?: string };
type Snapshot = { actions: AmoraActionItem[]; count: number; open_count: number; truncated: boolean; nextCursor: string | null };
type LoadState = Snapshot & { scope: string; loading: boolean; loadingMore: boolean; error: string | null };
const EMPTY: Snapshot = { actions: [], count: 0, open_count: 0, truncated: false, nextCursor: null };
const NO_UPDATES: ReadonlySet<string> = new Set<string>();
const READ_ERROR = "준비 상황을 불러오지 못했어요. 다시 시도해 주세요.";
const UPDATE_UNKNOWN = "변경을 저장하지 못했거나 결과를 확인할 수 없어요. 앞선 처리가 끝난 뒤 새로고침으로 확인하고 다시 선택해 주세요. 확인 전에는 추가 변경하지 않아요.";
const SYNC_INTERVAL_MS = 30_000;
const SYNC_TIMEOUT_MS = 10_000;
const MUTATION_TIMEOUT_MS = 30_000;

const CREATE_ID = "[new]";

function matchesPlanFields(action: AmoraActionItem, fields: { description?: string; due_date?: string }) {
  return (fields.description === undefined || (action.description ?? "") === (cleanOptionalText(fields.description, 500) ?? ""))
    && (fields.due_date === undefined || (action.dueDate ?? "") === (cleanOptionalText(fields.due_date, 40) ?? ""));
}

function scopeFor(state: Pick<ReturnType<typeof useAuthStore.getState>, "user" | "profile" | "isDemo" | "isInitialized">) {
  return preparationCreateScope(state);
}

export function useAmoraPreparationActions() {
  const scope = useAuthStore(scopeFor);
  useSyncExternalStore(subscribePreparationCreates, preparationCreateRevision, preparationCreateRevision);
  useSyncExternalStore(subscribePreparationUpdates, preparationUpdateRevision, preparationUpdateRevision);
  const commandEpoch = preparationOwnerEpoch();
  const retainedCreate = getPreparationCreate(scope);
  const isDemo = useAuthStore((state) => state.isDemo);
  const initialized = useAuthStore((state) => state.isInitialized);
  const awaitingProfile = useAuthStore((state) => !!state.user && (!state.profile || state.profile.id !== state.user.id));
  const progress = useAuthStore((state) => state.journey?.progress);
  const [demoChanges, setDemoChanges] = useState<{ scope: string; changes: Record<string, Partial<AmoraActionItem>> }>({ scope: "", changes: {} });
  const demoActions = useMemo(() => {
    if (!isDemo) return [];
    const existing = getAmoraActions(progress);
    return [...existing, ...DEMO_PREPARATION_ACTIONS.filter((sample) => !existing.some((action) => action.id === sample.id))]
      .map((action) => ({ ...action, ...(demoChanges.scope === scope ? demoChanges.changes[action.id] : {}) }));
  }, [isDemo, progress, demoChanges, scope]);
  const [state, setState] = useState<LoadState>({ ...EMPTY, scope: "", loading: false, loadingMore: false, error: null });
  const [ownerEpoch, setOwnerEpoch] = useState(0);
  const sequence = useRef(0);
  const lifecycle = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const backgroundController = useRef<AbortController | null>(null);
  const pageInFlight = useRef(false);
  const loadedPages = useRef(1);
  const pendingUpdates = useRef(new Set<string>());
  const [mutation, setMutation] = useState<{ scope: string; ids: ReadonlySet<string>; error: string | null }>({ scope: "", ids: NO_UPDATES, error: null });

  const readPage = useCallback(async (cursor: string | null, completedCreateKey?: string, background = false) => {
    const ownCreateRefresh = completedCreateKey !== undefined && pendingUpdates.current.size === 1 && pendingUpdates.current.has(completedCreateKey);
    if (!scope || isDemo || (pendingUpdates.current.size > 0 && !ownCreateRefresh) || ((cursor || background) && pageInFlight.current)) return;
    const readWriteSequence = preparationWriteSequence();
    const reviewable = listPreparationUpdates(scope).filter(attempt => !attempt.rawPending && attempt.needsReview);
    const requestId = ++sequence.current;
    pageInFlight.current = true;
    controller.current?.abort();
    const nextController = new AbortController();
    controller.current = nextController;
    if (background) backgroundController.current = nextController;
    const owns = () => requestId === sequence.current && scopeFor(useAuthStore.getState()) === scope;
    const current = () => owns() && !nextController.signal.aborted;
    if (!background) setState((previous) => ({ ...(previous.scope === scope ? previous : EMPTY), scope, loading: !cursor, loadingMore: !!cursor, error: null }));
    try {
      await boundedRequest(async () => {
      // 자동 조회도 펼쳐 본 페이지 수까지만 읽고, 전부 성공한 뒤 한 번에 교체한다.
      const pageLimit = background ? loadedPages.current : 1;
      const seenCursors = new Set(cursor ? [cursor] : []);
      let nextCursor = cursor;
      let refreshedActions: AmoraActionItem[] = [];
      for (let page = 0; page < pageLimit; page += 1) {
        if (!current()) return;
        const response = await fetch(`/api/amora/actions?status=all&limit=80${nextCursor ? `&cursor=${encodeURIComponent(nextCursor)}` : ""}`, {
          cache: "no-store", credentials: "same-origin", signal: nextController.signal,
        });
        if (!response.ok) throw new Error(READ_ERROR);
        const payload = snapshotSchema.parse(await response.json());
        if (!current()) return;
        if (readWriteSequence !== preparationWriteSequence()) throw new Error("read_before_write");
        if (payload.next_cursor && seenCursors.has(payload.next_cursor)) throw new Error("cursor_did_not_advance");
        if (payload.next_cursor && payload.actions.length === 0) throw new Error("empty_cursor_page");
        if (payload.next_cursor) seenCursors.add(payload.next_cursor);
        refreshedActions = [...new Map([...refreshedActions, ...payload.actions].map(action => [action.id, action])).values()];
        nextCursor = payload.next_cursor ?? null;
        if (nextCursor && page + 1 < pageLimit) continue;
        loadedPages.current = background ? page + 1 : cursor ? loadedPages.current + 1 : 1;
        setState(previous => {
          const actions = cursor && previous.scope === scope
            ? [...new Map([...previous.actions, ...refreshedActions].map(action => [action.id, action])).values()]
            : refreshedActions;
          return { actions, count: payload.count, open_count: payload.open_count,
            nextCursor, truncated: !!nextCursor || payload.count > actions.length,
            scope, loading: false, loadingMore: false, error: null };
        });
        for (const attempt of reviewable) {
          const completeList = cursor === null && !nextCursor && payload.count === refreshedActions.length;
          if (completeList || refreshedActions.some(action => action.id === attempt.id)) clearPreparationUpdate(attempt);
        }
        if (reviewable.length > 0 && listPreparationUpdates(scope).length === 0) {
          setMutation(previous => previous.scope === scope ? { ...previous, error: null } : previous);
        }
        break;
      }
      }, SYNC_TIMEOUT_MS, nextController);
    } catch (error) {
      if (owns() && (error instanceof RequestDeadlineError || !nextController.signal.aborted)) setState((previous) => ({ ...previous, loading: false, loadingMore: false, error: READ_ERROR }));
    } finally {
      if (backgroundController.current === nextController) backgroundController.current = null;
      if (owns()) pageInFlight.current = false;
    }
  }, [scope, isDemo]);
  const refresh = useCallback(() => readPage(null), [readPage]);
  const loadMore = useCallback(async () => {
    if (state.scope === scope && state.nextCursor) await readPage(state.nextCursor);
  }, [state.scope, state.nextCursor, scope, readPage]);

  useEffect(() => {
    const pending = pendingUpdates.current;
    let invalidated = false;
    const invalidate = () => {
      sequence.current += 1;
      lifecycle.current += 1;
      controller.current?.abort();
      pageInFlight.current = false;
      loadedPages.current = 1;
      pending.clear();
      setState({ ...EMPTY, scope: "", loading: false, loadingMore: false, error: null });
      setMutation({ scope: "", ids: NO_UPDATES, error: null });
      setDemoChanges({ scope: "", changes: {} });
    };
    // React가 중간 계정을 그리지 않는 A→B→A 전환도 즉시 이전 요청을 폐기한다.
    const unsubscribe = useAuthStore.subscribe(() => {
      if (!invalidated && scopeFor(useAuthStore.getState()) !== scope) {
        invalidated = true;
        invalidate();
        setOwnerEpoch(epoch => epoch + 1);
      }
    });
    void refresh();
    return () => { unsubscribe(); invalidate(); };
  }, [scope, refresh, ownerEpoch]);

  useEffect(() => {
    if (!scope || isDemo) return;
    let disposed = false;
    let syncing = false;
    const generation = lifecycle.current;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const active = () => !disposed && generation === lifecycle.current && scopeFor(useAuthStore.getState()) === scope
      && document.visibilityState === "visible" && navigator.onLine !== false;
    const stopPoll = () => { clearTimeout(timer); timer = undefined; };
    const schedulePoll = () => {
      stopPoll();
      if (active()) timer = setTimeout(() => { void synchronize(); }, SYNC_INTERVAL_MS);
    };
    const synchronize = async () => {
      if (!active() || syncing) return;
      syncing = true;
      stopPoll();
      try { await readPage(null, undefined, true); }
      finally { syncing = false; schedulePoll(); }
    };
    const resume = () => {
      if (active()) void synchronize();
      else { stopPoll(); backgroundController.current?.abort(); }
    };
    // 다른 탭·파트너의 저장은 이 훅의 로컬 상태에 들어오지 않으므로 서버에서 재확인한다.
    window.addEventListener("focus", resume);
    window.addEventListener("online", resume);
    window.addEventListener("offline", resume);
    window.addEventListener("pageshow", resume);
    document.addEventListener("visibilitychange", resume);
    schedulePoll();
    return () => {
      disposed = true;
      stopPoll();
      backgroundController.current?.abort();
      window.removeEventListener("focus", resume);
      window.removeEventListener("online", resume);
      window.removeEventListener("offline", resume);
      window.removeEventListener("pageshow", resume);
      document.removeEventListener("visibilitychange", resume);
    };
  }, [scope, isDemo, readPage, ownerEpoch]);

  const update = useCallback(async (id: string, updates: AmoraPreparationActionUpdate): Promise<boolean> => {
    const generation = lifecycle.current;
    const current = () => commandEpoch === preparationOwnerEpoch() && generation === lifecycle.current && scope !== "" && scopeFor(useAuthStore.getState()) === scope;
    const pendingKey = JSON.stringify([scope, generation, id]);
    if (!current() || getPreparationCreate(scope)?.inFlight || pendingUpdates.current.has(JSON.stringify([scope, generation, CREATE_ID]))) return false;
    if (isDemo) {
      if (!demoActions.some((action) => action.id === id)) return false;
      setDemoChanges((previous) => {
        const changes = previous.scope === scope ? previous.changes : {};
        return { scope, changes: { ...changes, [id]: {
          ...changes[id], ...(updates.status ? { status: updates.status } : {}),
          ...(updates.category_key !== undefined ? { categoryKey: updates.category_key } : {}),
          ...(updates.title !== undefined ? { title: updates.title.trim() } : {}),
          ...(updates.description !== undefined ? { description: cleanOptionalText(updates.description, 500) ?? undefined } : {}),
          ...(updates.due_date !== undefined ? { dueDate: cleanOptionalText(updates.due_date, 40) ?? undefined } : {}),
        } } };
      });
      return true;
    }
    if (pendingUpdates.current.has(pendingKey) || state.scope !== scope || !state.actions.some((action) => action.id === id)) return false;
    const retained = getPreparationUpdate(scope, id);
    if (retained) {
      setMutation(previous => ({ ...previous, scope, error: UPDATE_UNKNOWN }));
      if (!retained.rawPending) await readPage(null);
      return false;
    }
    const attempt = beginPreparationUpdate(scope, id);
    if (!attempt) return false;
    pendingUpdates.current.add(pendingKey);
    setMutation((previous) => ({ scope, ids: new Set([...(previous.scope === scope ? previous.ids : []), id]), error: null }));
    // 변경 전에 시작한 조회가 저장된 카드를 이전 상태로 되돌리지 않게 한다.
    sequence.current += 1;
    controller.current?.abort();
    pageInFlight.current = false;
    try {
      const payload = await boundedRequest(async signal => {
        try {
        const response = await fetch(`/api/amora/actions/${encodeURIComponent(id)}`, {
          method: "PATCH", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(updates), signal,
        });
        if (!response.ok) throw new Error("update_failed");
        return z.object({ action: actionSchema }).parse(await response.json());
        } finally { settlePreparationUpdate(attempt); }
      }, MUTATION_TIMEOUT_MS);
      if (payload.action.id !== id) throw new Error("unexpected_action");
      if ((updates.status !== undefined && payload.action.status !== updates.status)
        || (updates.category_key !== undefined && (payload.action.categoryKey ?? "") !== updates.category_key)
        || (updates.title !== undefined && payload.action.title !== cleanOptionalText(updates.title, 120))
        || !matchesPlanFields(payload.action, updates)) throw new Error("unexpected_update");
      clearPreparationUpdate(attempt);
      if (!current()) return false;
      setState((previous) => previous.scope === scope ? {
        ...previous, loading: false, loadingMore: false,
        open_count: previous.open_count + Number(payload.action.status === "open")
          - Number(previous.actions.find(action => action.id === id)?.status === "open"),
        actions: previous.actions.map((action) => action.id === id ? payload.action : action),
      } : previous);
      return current();
    } catch {
      markPreparationUpdateUnknown(attempt);
      if (current()) {
        setMutation((previous) => ({ ...previous, scope, error: UPDATE_UNKNOWN }));
        setState((previous) => previous.scope === scope ? { ...previous, loading: false, loadingMore: false } : previous);
      }
      return false;
    } finally {
      pendingUpdates.current.delete(pendingKey);
      if (current()) setMutation((previous) => ({ ...previous, ids: new Set([...previous.ids].filter((value) => value !== id)) }));
    }
  }, [scope, commandEpoch, isDemo, demoActions, state.scope, state.actions, readPage]);

  const cancelCreate = useCallback(() => {
    if (commandEpoch !== preparationOwnerEpoch() || !scope || scopeFor(useAuthStore.getState()) !== scope || pendingUpdates.current.size > 0 || getPreparationCreate(scope)?.inFlight) return false;
    clearPreparationCreate(scope);
    setMutation(previous => ({ ...previous, error: null }));
    return true;
  }, [scope, commandEpoch]);

  const create = useCallback(async (fields: AmoraPreparationActionCreate): Promise<boolean> => {
    const generation = lifecycle.current;
    const owner = useAuthStore.getState();
    const current = () => commandEpoch === preparationOwnerEpoch() && generation === lifecycle.current && scope !== "" && scopeFor(useAuthStore.getState()) === scope;
    const pendingKey = JSON.stringify([scope, generation, CREATE_ID]);
    if (isDemo || !current() || !owner.profile?.couple_id || pendingUpdates.current.size > 0
      || !cleanOptionalText(fields.title, 120) || fields.title.trim().length > 120
      || (fields.description?.length ?? 0) > 500 || (fields.due_date?.length ?? 0) > 40) return false;
    const fieldsKey = JSON.stringify({ title: fields.title, category_key: fields.category_key, description: fields.description, due_date: fields.due_date });
    const prior = getPreparationCreate(scope);
    if (prior && (prior.inFlight || prior.fieldsKey !== fieldsKey)) return false;
    const requestId = prior?.requestId ?? crypto.randomUUID();
    const attempt = prior ?? { scope, fieldsKey, requestId, fields: { ...fields }, inFlight: false,
      body: JSON.stringify({ ...JSON.parse(fieldsKey), status: "open", priority: "medium", source: "manual", requestId,
        expectedOwnerId: owner.user!.id, expectedCoupleId: owner.profile.couple_id }) };
    if (!claimPreparationCreate(attempt)) return false;
    pendingUpdates.current.add(pendingKey);
    controller.current?.abort(); sequence.current += 1; pageInFlight.current = false;
    setState(previous => ({ ...previous, loading: false, loadingMore: false }));
    setMutation({ scope, ids: new Set([CREATE_ID]), error: null });
    let saved = false;
    try {
      const receipt = await boundedRequest(async signal => {
        const response = await fetch("/api/amora/actions", {
          method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
          body: attempt.body, signal,
        });
        if (!response.ok) throw new Error("create_failed");
        return z.object({ action: actionSchema, requestId: z.string(), replayed: z.boolean() }).parse(await response.json());
      }, MUTATION_TIMEOUT_MS);
      const { action } = receipt;
      if (receipt.requestId !== requestId || action.title !== cleanOptionalText(fields.title, 120) || action.source !== "manual"
        || action.status !== "open" || action.priority !== "medium"
        || (action.categoryKey ?? "") !== (cleanOptionalText(fields.category_key, 80) ?? "")
        || action.href !== undefined
        || !matchesPlanFields(action, { description: fields.description ?? "", due_date: fields.due_date ?? "" })) throw new Error("create_receipt_mismatch");
      if (!current()) return false;
      clearPreparationCreate(scope, attempt);
      saved = true;
      // 저장 영수증은 최종 목록 조회와 별개인 정본이다. 조회 실패에도 저장된 카드를 보존한다.
      setState(previous => {
        const snapshot = previous.scope === scope ? previous : { ...EMPTY, scope };
        const existing = snapshot.actions.find(item => item.id === action.id);
        const actions = [action, ...snapshot.actions.filter(item => item.id !== action.id)];
        // replay는 중간 조회의 전체 건수에 이미 들어 있을 수 있다. 보이는 카드 수만 하한으로 보정한다.
        const added = Number(!existing && !receipt.replayed);
        return { ...snapshot, loading: false, loadingMore: false, error: null,
          actions,
          count: Math.max(actions.length, snapshot.count + added),
          open_count: Math.max(actions.filter(item => item.status === "open").length,
            snapshot.open_count + added + Number(!!existing && existing.status !== "open")),
        };
      });
      // 생성부터 최종 조회까지 카드 수정을 막아 조회가 다른 PATCH에 밀려 빠지지 않게 한다.
      await readPage(null, pendingKey);
    } catch {
      if (current()) setMutation(previous => ({ ...previous, scope, error: "저장 결과를 확인하지 못했어요. 같은 요청을 다시 확인하거나 목록을 확인해 주세요. 이미 저장됐을 수 있어요." }));
    } finally {
      finishPreparationCreate(attempt);
      pendingUpdates.current.delete(pendingKey);
      if (current()) setMutation(previous => ({ ...previous, ids: new Set([...previous.ids].filter(id => id !== CREATE_ID)) }));
    }
    return saved && current();
  }, [scope, commandEpoch, isDemo, readPage]);

  const snapshot = isDemo && scope
    ? { actions: demoActions, count: demoActions.length, open_count: demoActions.filter((action) => action.status === "open").length, truncated: false, nextCursor: null }
    : state.scope === scope ? state : EMPTY;
  const unresolvedUpdates = listPreparationUpdates(scope);
  const mutationError = mutation.scope === scope
    && (mutation.error !== UPDATE_UNKNOWN || unresolvedUpdates.length > 0) ? mutation.error : null;
  return {
    ...snapshot,
    loading: !initialized || awaitingProfile || (!!scope && !isDemo && (state.scope !== scope || state.loading)),
    error: state.scope === scope && !isDemo ? state.error : null,
    refresh,
    loadMore,
    loadingMore: state.scope === scope && !isDemo && state.loadingMore,
    update, create, cancelCreate, createLocked: !!retainedCreate, pendingCreateFields: retainedCreate?.fields ?? null, ownerScope: JSON.stringify([scope, commandEpoch]),
    canCreate: !!scope && !isDemo && !!useAuthStore.getState().profile?.couple_id,
    creating: retainedCreate?.inFlight === true || (mutation.scope === scope && mutation.ids.has(CREATE_ID)),
    updatingIds: mutation.scope === scope ? mutation.ids : NO_UPDATES,
    updateError: mutationError ?? (unresolvedUpdates.some(attempt => attempt.needsReview) ? UPDATE_UNKNOWN : null) ?? (retainedCreate && !retainedCreate.inFlight
      ? "저장 결과를 확인하지 못했어요. 같은 요청을 다시 확인하거나 목록을 확인해 주세요. 이미 저장됐을 수 있어요." : null),
    isDemo,
  };
}
