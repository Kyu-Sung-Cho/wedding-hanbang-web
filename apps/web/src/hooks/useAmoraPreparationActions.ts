"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";
import { getAmoraActions, type AmoraActionItem, type AmoraActionStatus } from "@/lib/amora/actions";
import { useAuthStore } from "@/stores/authStore";
import { DEMO_PREPARATION_ACTIONS } from "@/lib/amora/preparationBoard";
import { cleanOptionalText } from "@/utils/requestValidation";

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
type Snapshot = { actions: AmoraActionItem[]; count: number; open_count: number; truncated: boolean; nextCursor: string | null };
type LoadState = Snapshot & { scope: string; loading: boolean; loadingMore: boolean; error: string | null };
const EMPTY: Snapshot = { actions: [], count: 0, open_count: 0, truncated: false, nextCursor: null };
const NO_UPDATES: ReadonlySet<string> = new Set<string>();
const READ_ERROR = "준비 상황을 불러오지 못했어요. 다시 시도해 주세요.";

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
  const sequence = useRef(0);
  const lifecycle = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const pageInFlight = useRef(false);
  const pendingUpdates = useRef(new Set<string>());
  const [mutation, setMutation] = useState<{ scope: string; ids: ReadonlySet<string>; error: string | null }>({ scope: "", ids: NO_UPDATES, error: null });

  const readPage = useCallback(async (cursor: string | null) => {
    if (!scope || isDemo || pendingUpdates.current.size > 0 || (cursor && pageInFlight.current)) return;
    const requestId = ++sequence.current;
    pageInFlight.current = true;
    controller.current?.abort();
    const nextController = new AbortController();
    controller.current = nextController;
    const current = () => requestId === sequence.current && scopeFor(useAuthStore.getState()) === scope;
    setState((previous) => ({ ...(previous.scope === scope ? previous : EMPTY), scope, loading: !cursor, loadingMore: !!cursor, error: null }));
    try {
      const response = await fetch(`/api/amora/actions?status=all&limit=80${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`, {
        cache: "no-store", credentials: "same-origin", signal: nextController.signal,
      });
      if (!response.ok) throw new Error(READ_ERROR);
      const payload = snapshotSchema.parse(await response.json());
      if (cursor && payload.next_cursor === cursor) throw new Error("cursor_did_not_advance");
      if (payload.next_cursor && payload.actions.length === 0) throw new Error("empty_cursor_page");
      if (current()) setState(previous => {
        const actions = cursor && previous.scope === scope
          ? [...new Map([...previous.actions, ...payload.actions].map(action => [action.id, action])).values()]
          : payload.actions;
        return { actions, count: payload.count, open_count: payload.open_count,
          nextCursor: payload.next_cursor ?? null, truncated: !!payload.next_cursor || payload.count > actions.length,
          scope, loading: false, loadingMore: false, error: null };
      });
    } catch {
      if (current()) setState((previous) => ({ ...previous, loading: false, loadingMore: false, error: READ_ERROR }));
    } finally {
      if (current()) pageInFlight.current = false;
    }
  }, [scope, isDemo]);
  const refresh = useCallback(() => readPage(null), [readPage]);
  const loadMore = useCallback(async () => {
    if (state.scope === scope && state.nextCursor) await readPage(state.nextCursor);
  }, [state.scope, state.nextCursor, scope, readPage]);

  useEffect(() => {
    const pending = pendingUpdates.current;
    void refresh();
    return () => {
      sequence.current += 1;
      lifecycle.current += 1;
      controller.current?.abort();
      pageInFlight.current = false;
      pending.clear();
      setMutation({ scope: "", ids: NO_UPDATES, error: null });
      setDemoChanges({ scope: "", changes: {} });
    };
  }, [refresh]);

  const update = useCallback(async (id: string, updates: AmoraPreparationActionUpdate): Promise<boolean> => {
    const generation = lifecycle.current;
    const current = () => generation === lifecycle.current && scope !== "" && scopeFor(useAuthStore.getState()) === scope;
    const pendingKey = JSON.stringify([scope, generation, id]);
    if (!current()) return false;
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
    pendingUpdates.current.add(pendingKey);
    setMutation((previous) => ({ scope, ids: new Set([...(previous.scope === scope ? previous.ids : []), id]), error: null }));
    // 변경 전에 시작한 조회가 저장된 카드를 이전 상태로 되돌리지 않게 한다.
    sequence.current += 1;
    controller.current?.abort();
    pageInFlight.current = false;
    try {
      const response = await fetch(`/api/amora/actions/${encodeURIComponent(id)}`, {
        method: "PATCH", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(updates),
      });
      if (!response.ok) throw new Error("update_failed");
      const payload = z.object({ action: actionSchema }).parse(await response.json());
      if (payload.action.id !== id) throw new Error("unexpected_action");
      if ((updates.status !== undefined && payload.action.status !== updates.status)
        || (updates.category_key !== undefined && (payload.action.categoryKey ?? "") !== updates.category_key)
        || (updates.title !== undefined && payload.action.title !== cleanOptionalText(updates.title, 120))
        || !matchesPlanFields(payload.action, updates)) throw new Error("unexpected_update");
      if (!current()) return false;
      setState((previous) => previous.scope === scope ? {
        ...previous, loading: false, loadingMore: false,
        open_count: previous.open_count + Number(payload.action.status === "open")
          - Number(previous.actions.find(action => action.id === id)?.status === "open"),
        actions: previous.actions.map((action) => action.id === id ? payload.action : action),
      } : previous);
      return current();
    } catch {
      if (current()) {
        setMutation((previous) => ({ ...previous, scope, error: "변경을 저장하지 못했거나 결과를 확인할 수 없어요. 새로고침으로 확인한 뒤 다시 시도해 주세요." }));
        setState((previous) => previous.scope === scope ? { ...previous, loading: false, loadingMore: false } : previous);
      }
      return false;
    } finally {
      pendingUpdates.current.delete(pendingKey);
      if (current()) setMutation((previous) => ({ ...previous, ids: new Set([...previous.ids].filter((value) => value !== id)) }));
    }
  }, [scope, isDemo, demoActions, state.scope, state.actions]);

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
    update,
    updatingIds: mutation.scope === scope ? mutation.ids : NO_UPDATES,
    updateError: mutation.scope === scope ? mutation.error : null,
    isDemo,
  };
}
