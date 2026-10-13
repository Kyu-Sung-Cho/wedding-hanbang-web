"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";
import { compareChatTimestamps } from "@hanbang/shared";
import { getAmoraActions, isAmoraActionViewVersion, type AmoraActionItem, type AmoraActionStatus } from "@/lib/amora/actions";
import { useAuthStore } from "@/stores/authStore";
import { DEMO_PREPARATION_ACTIONS } from "@/lib/amora/preparationBoard";
import { cleanOptionalText } from "@/utils/requestValidation";
import { AMORA_ACTION_OUTCOME_UNCONFIRMED, AmoraActionDeadlineError, createAmoraActionDeadline } from "@/lib/amora/actionDeadline";

const actionSchema = z.object({
  id: z.string().min(1), title: z.string().min(1), description: z.string().nullish().transform(value => value ?? undefined),
  dueDate: z.string().nullish().transform(value => value ?? undefined), categoryKey: z.string().optional(),
  priority: z.enum(["high", "medium", "low"]), status: z.enum(["open", "done", "dismissed"]),
  source: z.enum(["chat", "quote", "schedule", "budget", "guardrail", "manual"]),
  href: z.string().optional(), createdAt: z.string(), updatedAt: z.string(), completedAt: z.string().optional(),
  viewVersion: z.unknown().transform(value => isAmoraActionViewVersion(value) ? value : null),
}).refine(action => action.viewVersion === null || compareChatTimestamps(action.viewVersion, action.updatedAt) === 0);
const snapshotSchema = z.object({
  actions: z.array(actionSchema).max(80), count: z.number().int().nonnegative(),
  open_count: z.number().int().nonnegative(), truncated: z.boolean().optional(),
  next_cursor: z.string().min(1).max(2_048).nullable().optional(),
}).refine((value) => value.count >= value.actions.length && value.open_count <= value.count);

export type AmoraPreparationActionUpdate = { status?: AmoraActionStatus; category_key?: string; title?: string; description?: string; due_date?: string };
export type AmoraPreparationActionView = { version: string | null | undefined; ownerScope: string };
export type AmoraPreparationActionUpdateIssue = {
  kind: "conflict" | "uncertain" | "unavailable" | "version-required";
  availability: "current" | "missing" | "unknown";
  latest?: AmoraActionItem;
};
export type AmoraPreparationActionCreate = { title: string; category_key?: string; description?: string; due_date?: string };
type Snapshot = { actions: AmoraActionItem[]; count: number; open_count: number; truncated: boolean; nextCursor: string | null };
type LoadState = Snapshot & { scope: string; loading: boolean; loadingMore: boolean; error: string | null };
const EMPTY: Snapshot = { actions: [], count: 0, open_count: 0, truncated: false, nextCursor: null };
const NO_UPDATES: ReadonlySet<string> = new Set<string>();
const NO_UPDATE_ISSUES: Readonly<Record<string, AmoraPreparationActionUpdateIssue>> = {};
const READ_ERROR = "준비 상황을 불러오지 못했어요. 다시 시도해 주세요.";
const SYNC_INTERVAL_MS = 30_000;
const SYNC_TIMEOUT_MS = 10_000;

const CREATE_ID = "[new]";

function matchesPlanFields(action: AmoraActionItem, fields: { description?: string; due_date?: string }) {
  return (fields.description === undefined || (action.description ?? "") === (cleanOptionalText(fields.description, 500) ?? ""))
    && (fields.due_date === undefined || (action.dueDate ?? "") === (cleanOptionalText(fields.due_date, 40) ?? ""));
}

function scopeFor(state: Pick<ReturnType<typeof useAuthStore.getState>, "user" | "profile" | "isDemo" | "isInitialized">) {
  if (!state.isInitialized || !state.profile || !state.user || state.profile.id !== state.user.id) return "";
  return JSON.stringify([state.user.id, state.profile.couple_id, state.isDemo]);
}

export function useAmoraPreparationActions() {
  const scope = useAuthStore(scopeFor);
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
  const ownerViewEpoch = useRef(0);
  const sequence = useRef(0);
  const lifecycle = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const backgroundController = useRef<AbortController | null>(null);
  const recoveryControllers = useRef(new Set<AbortController>());
  const mutationControllers = useRef(new Set<AbortController>());
  const pageInFlight = useRef(false);
  const loadedPages = useRef(1);
  const pendingUpdates = useRef(new Set<string>());
  const createAttempt = useRef<{ scope: string; generation: number; fieldsKey: string; body: string; requestId: string } | null>(null);
  const [createLockedScope, setCreateLockedScope] = useState("");
  const [mutation, setMutation] = useState<{ scope: string; ids: ReadonlySet<string>; error: string | null }>({ scope: "", ids: NO_UPDATES, error: null });
  const [issues, setIssues] = useState<{ scope: string; items: Readonly<Record<string, AmoraPreparationActionUpdateIssue>> }>({ scope: "", items: NO_UPDATE_ISSUES });

  const readPage = useCallback(async (cursor: string | null, completedCreateKey?: string, background = false, creationDeadline?: ReturnType<typeof createAmoraActionDeadline>) => {
    const ownCreateRefresh = completedCreateKey !== undefined && pendingUpdates.current.size === 1 && pendingUpdates.current.has(completedCreateKey);
    if (!scope || isDemo || (pendingUpdates.current.size > 0 && !ownCreateRefresh) || ((cursor || background) && pageInFlight.current)) return;
    const requestId = ++sequence.current;
    pageInFlight.current = true;
    controller.current?.abort();
    const nextController = new AbortController();
    controller.current = nextController;
    if (background) backgroundController.current = nextController;
    const owns = () => requestId === sequence.current && scopeFor(useAuthStore.getState()) === scope;
    const current = () => owns() && !nextController.signal.aborted;
    const deadline = creationDeadline ?? createAmoraActionDeadline(background ? SYNC_TIMEOUT_MS : undefined, nextController.signal);
    if (!background) setState((previous) => ({ ...(previous.scope === scope ? previous : EMPTY), scope, loading: !cursor, loadingMore: !!cursor, error: null }));
    try {
      // 자동 조회도 펼쳐 본 페이지 수까지만 읽고, 전부 성공한 뒤 한 번에 교체한다.
      const pageLimit = background ? loadedPages.current : 1;
      const seenCursors = new Set(cursor ? [cursor] : []);
      let nextCursor = cursor;
      let refreshedActions: AmoraActionItem[] = [];
      for (let page = 0; page < pageLimit; page += 1) {
        if (!current()) return;
        const response = await deadline.run(signal => fetch(`/api/amora/actions?status=all&limit=80${nextCursor ? `&cursor=${encodeURIComponent(nextCursor)}` : ""}`, {
          cache: "no-store", credentials: "same-origin", signal,
        }));
        if (!response.ok) throw new Error(READ_ERROR);
        const payload = snapshotSchema.parse(await deadline.run(() => response.json()));
        if (!current()) return;
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
        break;
      }
    } catch {
      if (owns() && !nextController.signal.aborted) setState((previous) => ({ ...previous, loading: false, loadingMore: false, error: READ_ERROR }));
    } finally {
      if (!creationDeadline) deadline.dispose();
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
      for (const recovery of recoveryControllers.current) recovery.abort();
      recoveryControllers.current.clear();
      for (const mutation of mutationControllers.current) mutation.abort();
      mutationControllers.current.clear();
      pageInFlight.current = false;
      loadedPages.current = 1;
      pending.clear();
      createAttempt.current = null;
      setState({ ...EMPTY, scope: "", loading: false, loadingMore: false, error: null });
      setCreateLockedScope("");
      setMutation({ scope: "", ids: NO_UPDATES, error: null });
      setIssues({ scope: "", items: NO_UPDATE_ISSUES });
      setDemoChanges({ scope: "", changes: {} });
    };
    // React가 중간 계정을 그리지 않는 A→B→A 전환도 즉시 이전 요청을 폐기한다.
    const unsubscribe = useAuthStore.subscribe(() => {
      if (!invalidated && scopeFor(useAuthStore.getState()) !== scope) {
        invalidated = true;
        ownerViewEpoch.current += 1;
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

  const readCurrentAction = useCallback(async (id: string, current: () => boolean): Promise<Pick<AmoraPreparationActionUpdateIssue, "availability" | "latest">> => {
    if (!current()) return { availability: "unknown" };
    const recovery = new AbortController();
    recoveryControllers.current.add(recovery);
    const deadline = createAmoraActionDeadline(SYNC_TIMEOUT_MS, recovery.signal);
    try {
      const response = await deadline.run(signal => fetch(`/api/amora/actions/${encodeURIComponent(id)}`, {
        cache: "no-store", credentials: "same-origin", signal,
      }));
      if (!current()) return { availability: "unknown" };
      if (response.status === 404) return { availability: "missing" };
      if (!response.ok) return { availability: "unknown" };
      const payload = z.object({ action: actionSchema }).parse(await deadline.run(() => response.json()));
      if (!current() || payload.action.id !== id) return { availability: "unknown" };
      return { availability: "current", latest: payload.action };
    } catch { return { availability: "unknown" }; }
    finally { deadline.dispose(); recoveryControllers.current.delete(recovery); }
  }, []);

  const inspectUpdate = useCallback(async (id: string): Promise<boolean> => {
    const generation = lifecycle.current;
    const current = () => generation === lifecycle.current && scope !== "" && scopeFor(useAuthStore.getState()) === scope;
    const pendingKey = JSON.stringify([scope, generation, id]);
    if (isDemo || !current() || pendingUpdates.current.has(pendingKey)
      || pendingUpdates.current.has(JSON.stringify([scope, generation, CREATE_ID]))) return false;
    pendingUpdates.current.add(pendingKey);
    sequence.current += 1; controller.current?.abort(); pageInFlight.current = false;
    setMutation(previous => ({ scope, ids: new Set([...(previous.scope === scope ? previous.ids : []), id]), error: previous.scope === scope ? previous.error : null }));
    try {
      const view = await readCurrentAction(id, current);
      if (!current()) return false;
      setIssues(previous => ({ scope, items: { ...(previous.scope === scope ? previous.items : {}), [id]: {
        kind: previous.scope === scope ? previous.items[id]?.kind ?? "unavailable" : "unavailable", ...view,
      } } }));
      return view.availability === "current";
    } finally {
      pendingUpdates.current.delete(pendingKey);
      if (current()) setMutation(previous => ({ ...previous, ids: new Set([...previous.ids].filter(value => value !== id)) }));
    }
  }, [scope, isDemo, readCurrentAction]);

  const update = useCallback(async (id: string, updates: AmoraPreparationActionUpdate, viewed?: AmoraPreparationActionView): Promise<boolean> => {
    const generation = lifecycle.current;
    const current = () => generation === lifecycle.current && scope !== "" && scopeFor(useAuthStore.getState()) === scope;
    const pendingKey = JSON.stringify([scope, generation, id]);
    if (!current() || pendingUpdates.current.has(JSON.stringify([scope, generation, CREATE_ID]))) return false;
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
    const owner = useAuthStore.getState();
    if (!viewed || viewed.ownerScope !== JSON.stringify([scopeFor(owner), ownerViewEpoch.current])
      || !isAmoraActionViewVersion(viewed.version) || !owner.user || !owner.profile?.couple_id) {
      setMutation(previous => ({ ...previous, scope, error: "수정 전에 확인한 기록과 준비 공간을 다시 확인해 주세요. 작성한 내용은 그대로 두었어요." }));
      return false;
    }
    const ownerId = owner.user.id;
    const coupleId = owner.profile.couple_id;
    const listedAction = state.scope === scope ? state.actions.find((action) => action.id === id) : undefined;
    const inspectedAction = issues.scope === scope ? issues.items[id]?.latest : undefined;
    // 목록의 무버전 표시는 승격하지 않는다. 별도 조회한 원문 버전을 직접 재확인한 경우만 쓴다.
    const loadedAction = inspectedAction && isAmoraActionViewVersion(inspectedAction.viewVersion)
      && inspectedAction.viewVersion === viewed.version ? inspectedAction : listedAction ?? inspectedAction;
    if (!loadedAction || !isAmoraActionViewVersion(loadedAction.viewVersion)) {
      setMutation(previous => ({ ...previous, scope, error: "이 기록의 수정 기준을 확인할 수 없어요. 작성한 내용은 유지한 채 기록을 다시 확인해 주세요." }));
      return false;
    }
    if (pendingUpdates.current.has(pendingKey)) return false;
    pendingUpdates.current.add(pendingKey);
    setMutation((previous) => ({ scope, ids: new Set([...(previous.scope === scope ? previous.ids : []), id]), error: null }));
    // 변경 전에 시작한 조회가 저장된 카드를 이전 상태로 되돌리지 않게 한다.
    sequence.current += 1;
    controller.current?.abort();
    pageInFlight.current = false;
    let failureKind: AmoraPreparationActionUpdateIssue["kind"] = "uncertain";
    let inspectFailure = true;
    const mutation = new AbortController();
    mutationControllers.current.add(mutation);
    const deadline = createAmoraActionDeadline(undefined, mutation.signal);
    try {
      const response = await deadline.run(signal => fetch(`/api/amora/actions/${encodeURIComponent(id)}`, {
        method: "PATCH", credentials: "same-origin", headers: { "Content-Type": "application/json" },
        signal,
        body: JSON.stringify({ ...updates, expectedUpdatedAt: viewed.version,
          expectedOwnerId: ownerId, expectedCoupleId: coupleId }),
      }));
      if (!response.ok) {
        let reportedUnknown = false;
        if (response.status === 503) {
          try {
            const failure = await deadline.run(() => response.json());
            reportedUnknown = typeof failure === "object" && failure !== null && "code" in failure
              && failure.code === AMORA_ACTION_OUTCOME_UNCONFIRMED;
          } catch (error) {
            if (error instanceof AmoraActionDeadlineError) throw error;
          }
        }
        failureKind = reportedUnknown ? "uncertain" : response.status === 409 ? "conflict" : response.status === 428 ? "version-required"
          : response.status === 503 || response.status === 401 || response.status === 403 || response.status === 404 || response.status === 400 ? "unavailable" : "uncertain";
        inspectFailure = response.status === 409 || response.status === 500 || response.status === 503;
        throw new Error("update_failed");
      }
      const payload = z.object({ action: actionSchema }).parse(await deadline.run(() => response.json()));
      if (payload.action.id !== id) throw new Error("unexpected_action");
      if (!isAmoraActionViewVersion(payload.action.viewVersion)
        || compareChatTimestamps(payload.action.viewVersion, payload.action.updatedAt) !== 0
        || compareChatTimestamps(payload.action.viewVersion, viewed.version) !== 1) throw new Error("unexpected_version");
      if ((updates.status !== undefined && payload.action.status !== updates.status)
        || (updates.category_key !== undefined && (payload.action.categoryKey ?? "") !== updates.category_key)
        || (updates.title !== undefined && payload.action.title !== cleanOptionalText(updates.title, 120))
        || !matchesPlanFields(payload.action, updates)) throw new Error("unexpected_update");
      if (!current()) return false;
      setIssues(previous => {
        const items = { ...(previous.scope === scope ? previous.items : {}) };
        delete items[id];
        return { scope, items };
      });
      setState((previous) => previous.scope === scope ? {
        ...previous, loading: false, loadingMore: false,
        open_count: previous.actions.some(action => action.id === id)
          ? previous.open_count + Number(payload.action.status === "open") - Number(previous.actions.find(action => action.id === id)?.status === "open")
          : previous.open_count,
        actions: previous.actions.map((action) => action.id === id ? payload.action : action),
      } : previous);
      return current();
    } catch {
      const issue: AmoraPreparationActionUpdateIssue = { kind: failureKind, availability: "unknown" };
      // 응답이 끊기거나 충돌해도 새 버전으로 재전송하지 않는다. 조회는 저장 성공의 증거가 아니다.
      if (current() && inspectFailure) Object.assign(issue, await readCurrentAction(id, current));
      if (current()) {
        setIssues(previous => ({ scope, items: { ...(previous.scope === scope ? previous.items : {}), [id]: issue } }));
        setMutation((previous) => ({ ...previous, scope, error: failureKind === "conflict"
          ? "기록이 먼저 바뀌어 덮어쓰지 않았어요. 작성한 내용과 현재 기록을 비교한 뒤 다시 확인해 주세요."
          : "변경을 저장하지 못했거나 결과를 확인할 수 없어요. 작성한 내용은 유지하고 현재 기록을 확인해 주세요." }));
        setState((previous) => previous.scope === scope ? { ...previous, loading: false, loadingMore: false } : previous);
      }
      return false;
    } finally {
      deadline.dispose();
      mutationControllers.current.delete(mutation);
      pendingUpdates.current.delete(pendingKey);
      if (current()) setMutation((previous) => ({ ...previous, ids: new Set([...previous.ids].filter((value) => value !== id)) }));
    }
  }, [scope, isDemo, demoActions, state.scope, state.actions, issues, readCurrentAction]);

  const cancelCreate = useCallback(() => {
    if (!scope || scopeFor(useAuthStore.getState()) !== scope || pendingUpdates.current.size > 0) return false;
    createAttempt.current = null;
    setCreateLockedScope("");
    setMutation(previous => ({ ...previous, error: null }));
    return true;
  }, [scope]);

  const create = useCallback(async (fields: AmoraPreparationActionCreate): Promise<boolean> => {
    const generation = lifecycle.current;
    const owner = useAuthStore.getState();
    const current = () => generation === lifecycle.current && scope !== "" && scopeFor(useAuthStore.getState()) === scope;
    const pendingKey = JSON.stringify([scope, generation, CREATE_ID]);
    if (isDemo || !current() || !owner.profile?.couple_id || pendingUpdates.current.size > 0
      || !cleanOptionalText(fields.title, 120) || fields.title.trim().length > 120
      || (fields.description?.length ?? 0) > 500 || (fields.due_date?.length ?? 0) > 40) return false;
    const fieldsKey = JSON.stringify({ title: fields.title, category_key: fields.category_key, description: fields.description, due_date: fields.due_date });
    const prior = createAttempt.current;
    if (prior && (prior.scope !== scope || prior.generation !== generation || prior.fieldsKey !== fieldsKey)) return false;
    const requestId = prior?.requestId ?? crypto.randomUUID();
    const attempt = prior ?? { scope, generation, fieldsKey, requestId,
      body: JSON.stringify({ ...JSON.parse(fieldsKey), status: "open", priority: "medium", source: "manual", requestId,
        expectedOwnerId: owner.user!.id, expectedCoupleId: owner.profile.couple_id }) };
    createAttempt.current = attempt;
    setCreateLockedScope(scope);
    pendingUpdates.current.add(pendingKey);
    controller.current?.abort(); sequence.current += 1; pageInFlight.current = false;
    setState(previous => ({ ...previous, loading: false, loadingMore: false }));
    setMutation({ scope, ids: new Set([CREATE_ID]), error: null });
    let saved = false;
    const mutation = new AbortController();
    mutationControllers.current.add(mutation);
    const deadline = createAmoraActionDeadline(undefined, mutation.signal);
    try {
      const response = await deadline.run(signal => fetch("/api/amora/actions", {
        method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
        body: attempt.body, signal,
      }));
      if (!response.ok) throw new Error("create_failed");
      const receipt = z.object({ action: actionSchema, requestId: z.string(), replayed: z.boolean() }).parse(await deadline.run(() => response.json()));
      const { action } = receipt;
      if (receipt.requestId !== requestId || action.title !== cleanOptionalText(fields.title, 120) || action.source !== "manual"
        || action.status !== "open" || action.priority !== "medium"
        || (action.categoryKey ?? "") !== (cleanOptionalText(fields.category_key, 80) ?? "")
        || action.href !== undefined
        || !matchesPlanFields(action, { description: fields.description ?? "", due_date: fields.due_date ?? "" })) throw new Error("create_receipt_mismatch");
      if (!current()) return false;
      createAttempt.current = null;
      setCreateLockedScope("");
      saved = true;
      // 생성부터 최종 조회까지 카드 수정을 막아 조회가 다른 PATCH에 밀려 빠지지 않게 한다.
      await readPage(null, pendingKey, false, deadline);
    } catch {
      if (current()) setMutation(previous => ({ ...previous, scope, error: "저장 결과를 확인하지 못했어요. 같은 요청을 다시 확인하거나 목록을 확인해 주세요. 이미 저장됐을 수 있어요." }));
    } finally {
      deadline.dispose();
      mutationControllers.current.delete(mutation);
      pendingUpdates.current.delete(pendingKey);
      if (current()) setMutation(previous => ({ ...previous, ids: new Set([...previous.ids].filter(id => id !== CREATE_ID)) }));
    }
    return saved && current();
  }, [scope, isDemo, readPage]);

  const snapshot = isDemo && scope
    ? { actions: demoActions, count: demoActions.length, open_count: demoActions.filter((action) => action.status === "open").length, truncated: false, nextCursor: null }
    : state.scope === scope ? state : EMPTY;
  return {
    ...snapshot,
    loading: !initialized || awaitingProfile || (!!scope && !isDemo && (state.scope !== scope || state.loading)),
    error: state.scope === scope && !isDemo ? state.error : null,
    refresh,
    loadMore,
    loadingMore: state.scope === scope && !isDemo && state.loadingMore,
    update, inspectUpdate, create, cancelCreate, createLocked: !!scope && createLockedScope === scope,
    ownerScope: scope ? JSON.stringify([scope, ownerViewEpoch.current]) : "",
    canCreate: !!scope && !isDemo && !!useAuthStore.getState().profile?.couple_id,
    creating: mutation.scope === scope && mutation.ids.has(CREATE_ID),
    updatingIds: mutation.scope === scope ? mutation.ids : NO_UPDATES,
    updateError: mutation.scope === scope ? mutation.error : null,
    updateIssues: issues.scope === scope ? issues.items : NO_UPDATE_ISSUES,
    isDemo,
  };
}
