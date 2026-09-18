"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { useAuthStore } from "@/stores/authStore";
import {
  DECISION_INITIAL_ERROR, DECISION_MORE_ERROR, DECISION_PAGE_SIZE, DECISION_SELECT_COLUMNS, decisionCursorFilter, parsePreparationDecisions,
  type DecisionCursor, type PreparationDecision,
} from "@hanbang/shared/preparation-decisions";

export type DecisionScope = { ownerId: string; coupleId: string; role: string; brideId: string | null; groomId: string | null };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function decisionScope(state = useAuthStore.getState()): DecisionScope | null {
  const { user, profile, couple } = state;
  if (!state.isInitialized || state.isDemo || !user || profile?.id !== user.id || !couple || profile.couple_id !== couple.id
    || !uuid.test(user.id) || !uuid.test(couple.id)
    || !((profile.role === "bride" && couple.bride_id === user.id) || (profile.role === "groom" && couple.groom_id === user.id))) return null;
  return { ownerId: user.id, coupleId: couple.id, role: profile.role, brideId: couple.bride_id, groomId: couple.groom_id };
}
const keyFor = (scope: DecisionScope | null) => scope ? JSON.stringify(scope) : "";

/** 기존 authenticated RLS를 그대로 사용한다. 서비스 키·자동기억 API를 사용하지 않는다. */
export async function readDecisionPage(client: SupabaseClient, scope: DecisionScope, current: () => boolean, signal: AbortSignal, cursor: DecisionCursor | null = null) {
  const check = () => { if (!current() || signal.aborted) throw new Error("DECISION_IDENTITY_CHANGED"); };
  const verify = async () => {
    check();
    const auth = await client.auth.getUser();
    check();
    if (auth.error || auth.data.user?.id !== scope.ownerId) throw new Error("DECISION_IDENTITY_CHANGED");
    const profile = await client.from("profiles").select("id, couple_id, role").eq("id", scope.ownerId).abortSignal(signal).single();
    check();
    if (profile.error || profile.data?.id !== scope.ownerId || profile.data.couple_id !== scope.coupleId || profile.data.role !== scope.role) throw new Error("DECISION_IDENTITY_CHANGED");
    const couple = await client.from("couples").select("id, bride_id, groom_id").eq("id", scope.coupleId).abortSignal(signal).single();
    check();
    if (couple.error || couple.data?.id !== scope.coupleId || couple.data.bride_id !== scope.brideId || couple.data.groom_id !== scope.groomId) throw new Error("DECISION_IDENTITY_CHANGED");
  };
  await verify();
  let query = client.from("decision_nodes")
    .select(DECISION_SELECT_COLUMNS)
    .eq("couple_id", scope.coupleId).eq("visibility", "shared")
    .is("superseded_at", null).is("memory_key", null).is("metadata->>extracted_by", null)
    .order("created_at", { ascending: false }).order("id", { ascending: false }).limit(DECISION_PAGE_SIZE + 1);
  if (cursor) query = query.or(decisionCursorFilter(cursor));
  const response = await query.abortSignal(signal);
  check();
  if (response.error) throw new Error("DECISION_READ_FAILED");
  const page = parsePreparationDecisions(response.data, scope.coupleId, cursor);
  await verify();
  return page;
}

type State = { scope: string; records: PreparationDecision[]; nextCursor: DecisionCursor | null; loading: boolean; loadingMore: boolean; error: string | null; errorKind: "initial" | "more" | null };
const empty = { records: [], nextCursor: null, loading: false, loadingMore: false, error: null, errorKind: null };

export function useDecisionBoard() {
  const scopeKey = useAuthStore(state => keyFor(decisionScope(state)));
  const isDemo = useAuthStore(state => state.isDemo);
  const [state, setState] = useState<State>({ ...empty, scope: "" });
  const sequence = useRef(0);
  const epoch = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const inFlight = useRef(false);
  const mounted = useRef(false);
  const load = useCallback(async (cursor: DecisionCursor | null = null) => {
    const scope = decisionScope();
    if (!scope || keyFor(scope) !== scopeKey || (cursor && inFlight.current)) return;
    controller.current?.abort();
    controller.current = new AbortController();
    const signal = controller.current.signal;
    const request = ++sequence.current;
    const generation = epoch.current;
    inFlight.current = true;
    const current = () => mounted.current && request === sequence.current && generation === epoch.current && scopeKey === keyFor(decisionScope());
    setState(previous => ({ ...(cursor && previous.scope === scopeKey ? previous : empty), scope: scopeKey, loading: !cursor, loadingMore: !!cursor, error: null, errorKind: null }));
    try {
      const page = await readDecisionPage(createClient(), scope, current, signal, cursor);
      if (current()) setState(previous => ({ ...page, scope: scopeKey, loading: false, loadingMore: false, error: null, errorKind: null,
        records: cursor && previous.scope === scopeKey ? [...new Map([...previous.records, ...page.records].map(row => [row.id, row])).values()] : page.records }));
    } catch {
      // 이어서 불러오다 실패한 것은 이미 화면에 있는 기록을 지우지 않는다. 커플 연결은 멀쩡한데
      // 연결을 확인하라고 말하면서 목록까지 비우면, 실패한 것은 다음 페이지 하나인데 전부 잃는다.
      if (current()) setState(previous => cursor && previous.scope === scopeKey
        ? { ...previous, loading: false, loadingMore: false, error: DECISION_MORE_ERROR, errorKind: "more" }
        : { ...empty, scope: scopeKey, error: DECISION_INITIAL_ERROR, errorKind: "initial" });
    } finally { if (current()) inFlight.current = false; }
  }, [scopeKey]);
  const refresh = useCallback(() => load(), [load]);
  useEffect(() => {
    mounted.current = true;
    let active = true;
    let currentKey = keyFor(decisionScope());
    const invalidate = () => {
      epoch.current += 1; sequence.current += 1; controller.current?.abort(); inFlight.current = false;
      setState({ ...empty, scope: keyFor(decisionScope()) });
    };
    const unsubscribe = useAuthStore.subscribe(next => {
      const nextKey = keyFor(decisionScope(next));
      if (nextKey !== currentKey) {
        currentKey = nextKey; invalidate();
        // 같은 렌더 안의 로그아웃→재로그인도 새 요청으로 다시 확인한다.
        queueMicrotask(() => { if (active && nextKey === scopeKey && nextKey === keyFor(decisionScope())) void refresh(); });
      }
    });
    const client = scopeKey ? createClient() : null;
    const auth = client?.auth.onAuthStateChange(event => { if (event !== "INITIAL_SESSION" && event !== "TOKEN_REFRESHED") { invalidate(); queueMicrotask(() => { if (active) void refresh(); }); } });
    const scope = decisionScope();
    const channel = client && scope ? client.channel(`decision-board:${scope.ownerId}:${scope.coupleId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "profiles", filter: `id=eq.${scope.ownerId}` }, () => { invalidate(); void refresh(); })
      .on("postgres_changes", { event: "*", schema: "public", table: "couples", filter: `id=eq.${scope.coupleId}` }, () => { invalidate(); void refresh(); })
      .on("postgres_changes", { event: "*", schema: "public", table: "decision_nodes", filter: `couple_id=eq.${scope.coupleId}` }, () => { invalidate(); void refresh(); })
      .subscribe() : null;
    void refresh();
    const onFocus = () => { if (document.visibilityState === "visible") void refresh(); };
    window.addEventListener("focus", onFocus); document.addEventListener("visibilitychange", onFocus);
    return () => {
      active = false;
      mounted.current = false; epoch.current += 1; sequence.current += 1; controller.current?.abort(); inFlight.current = false;
      unsubscribe(); auth?.data.subscription.unsubscribe(); if (client && channel) void client.removeChannel(channel);
      window.removeEventListener("focus", onFocus); document.removeEventListener("visibilitychange", onFocus);
    };
  }, [scopeKey, refresh]);
  return { ...(state.scope === scopeKey ? state : { ...empty, scope: scopeKey }), isDemo, available: !!scopeKey,
    refresh, loadMore: () => state.scope === scopeKey && state.nextCursor ? load(state.nextCursor) : Promise.resolve() };
}
