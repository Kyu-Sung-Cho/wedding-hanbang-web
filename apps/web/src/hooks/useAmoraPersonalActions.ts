"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuthStore } from "@/stores/authStore";
import {
  parsePersonalActionPage, parsePersonalActionReceipt, isPersonalActionDeleteReceipt,
  type PersonalAction, type PersonalActionDraft, type PersonalActionPage,
} from "@hanbang/shared/amora-personal-actions";

export function personalActionOwner(state = useAuthStore.getState()): string | null {
  return state.isInitialized && !state.isDemo && state.user && state.profile?.id === state.user.id ? state.user.id : null;
}

const EMPTY: PersonalActionPage = { actions: [], count: 0, nextCursor: null };
const PATH = "/api/amora/personal-actions";
type State = PersonalActionPage & { owner: string | null; loading: boolean; error: string | null };

export function useAmoraPersonalActions(loadOnMount = true) {
  const owner = useAuthStore(personalActionOwner);
  const isDemo = useAuthStore(state => state.isDemo);
  const [state, setState] = useState<State>({ ...EMPTY, owner: null, loading: false, error: null });
  const [writeError, setWriteError] = useState<{ owner: string | null; text: string } | null>(null);
  const [busy, setBusy] = useState<{ owner: string | null; ids: string[] }>({ owner: null, ids: [] });
  const scope = useRef({ owner, epoch: 0 });
  const readSequence = useRef(0);
  const requests = useRef(new Set<AbortController>());
  const writes = useRef(new Set<string>());
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    const invalidate = (next: string | null) => {
      scope.current = { owner: next, epoch: scope.current.epoch + 1 };
      readSequence.current += 1;
      for (const controller of requests.current) controller.abort();
      requests.current.clear();
      writes.current.clear();
      setState({ ...EMPTY, owner: next, loading: false, error: null });
      setWriteError(null);
      setBusy({ owner: next, ids: [] });
    };
    if (scope.current.owner !== personalActionOwner()) invalidate(personalActionOwner());
    const unsubscribe = useAuthStore.subscribe(next => {
      const nextOwner = personalActionOwner(next);
      if (scope.current.owner !== nextOwner) invalidate(nextOwner);
    });
    return () => {
      mounted.current = false;
      scope.current.epoch += 1;
      for (const controller of requests.current) controller.abort();
      requests.current.clear();
      unsubscribe();
    };
  }, []);

  const token = useCallback(() => ({ owner: personalActionOwner(), epoch: scope.current.epoch }), []);
  const current = useCallback((request: ReturnType<typeof token>) => mounted.current && request.owner !== null
    && request.owner === personalActionOwner() && request.epoch === scope.current.epoch, []);
  const request = useCallback(async (identity: ReturnType<typeof token>, method: string, body?: unknown, cursor?: string) => {
    if (!current(identity)) throw new Error("IDENTITY_CHANGED");
    const controller = new AbortController();
    requests.current.add(controller);
    try {
      const response = await fetch(method === "GET" ? `${PATH}?status=all&limit=30${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}` : PATH, {
        method, cache: "no-store", credentials: "same-origin", signal: controller.signal,
        ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}),
      });
      if (!current(identity)) throw new Error("IDENTITY_CHANGED");
      if (!response.ok) {
        const failure: unknown = await response.json().catch(() => null);
        if (response.status === 409 && typeof failure === "object" && failure !== null && "code" in failure && failure.code === "PERSONAL_ACTION_LIMIT_REACHED") throw new Error("LIMIT_REACHED");
        if (response.status === 409 && typeof failure === "object" && failure !== null && "code" in failure && failure.code === "PERSONAL_ACTION_SOURCE_PROVENANCE_UNAVAILABLE") throw new Error("SOURCE_UNAVAILABLE");
        throw new Error(response.status === 409 ? "CHANGED" : response.status === 403 && method === "POST" ? "SOURCE_UNAVAILABLE" : "REQUEST_FAILED");
      }
      const payload: unknown = await response.json();
      if (!current(identity)) throw new Error("IDENTITY_CHANGED");
      return payload;
    } finally { requests.current.delete(controller); }
  }, [current]);

  const load = useCallback(async (cursor?: string) => {
    const identity = token();
    if (!identity.owner || writes.current.size > 0) return;
    const sequence = ++readSequence.current;
    setState(previous => ({ ...(previous.owner === identity.owner ? previous : EMPTY), owner: identity.owner, loading: true, error: null }));
    try {
      const page = parsePersonalActionPage(await request(identity, "GET", undefined, cursor), identity.owner);
      if (!page || (cursor && page.nextCursor === cursor)) throw new Error("INVALID_PAGE");
      if (current(identity) && sequence === readSequence.current) setState(previous => ({ ...page,
        actions: cursor && previous.owner === identity.owner ? [...new Map([...previous.actions, ...page.actions].map(item => [item.id, item])).values()] : page.actions,
        owner: identity.owner, loading: false, error: null,
      }));
    } catch {
      if (current(identity) && sequence === readSequence.current) setState(previous => ({ ...previous, loading: false, error: "개인 할 일을 불러오지 못했어요. 다시 확인해 주세요." }));
    }
  }, [current, request, token]);

  useEffect(() => { if (loadOnMount && owner) void load(); }, [load, loadOnMount, owner]);
  useEffect(() => {
    if (!loadOnMount) return;
    const refresh = () => { if (document.visibilityState === "visible") void load(); };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => { window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", refresh); };
  }, [load, loadOnMount]);

  const mutate = useCallback(async (key: string, method: string, body: Record<string, unknown>, expected: Parameters<typeof parsePersonalActionReceipt>[2] | null) => {
    const identity = token();
    if (!identity.owner || writes.current.has(key)) return null;
    writes.current.add(key);
    readSequence.current += 1;
    setBusy({ owner: identity.owner, ids: [...writes.current] });
    setWriteError(null);
    try {
      const payload = await request(identity, method, { ...body, expectedOwnerId: identity.owner });
      const item = expected ? parsePersonalActionReceipt(payload, identity.owner, expected) : null;
      if (expected ? !item : !isPersonalActionDeleteReceipt(payload, key)) throw new Error("INVALID_RECEIPT");
      if (!current(identity)) return null;
      setState(previous => {
        const base = previous.owner === identity.owner ? previous : EMPTY;
        const existed = base.actions.some(action => action.id === (item?.id ?? key));
        return { ...base, owner: identity.owner, loading: false, error: null,
          actions: item ? [item, ...base.actions.filter(action => action.id !== item.id)] : base.actions.filter(action => action.id !== key),
          count: Math.max(0, base.count + (item ? (existed ? 0 : 1) : (existed ? -1 : 0))),
        };
      });
      return item ?? true;
    } catch (error) {
      if (current(identity)) setWriteError({ owner: identity.owner, text: error instanceof Error && error.message === "CHANGED"
        ? "다른 화면에서 내용이 바뀌었어요. 목록을 다시 확인해 주세요."
        : error instanceof Error && error.message === "SOURCE_UNAVAILABLE"
          ? "이 답변의 개인 소유를 확인하지 못했어요. 새로 나만 상담한 답변에서 다시 저장해 주세요."
          : error instanceof Error && error.message === "LIMIT_REACHED"
            ? "개인 할 일은 300개까지 보관할 수 있어요. 개인 목록에서 기존 할 일을 삭제한 뒤 다시 시도해 주세요."
          : "처리 결과를 확인하지 못했어요. 개인 목록을 확인하거나 다시 시도해 주세요." });
      return null;
    } finally {
      if (current(identity)) {
        writes.current.delete(key);
        setBusy({ owner: identity.owner, ids: [...writes.current] });
        if (loadOnMount) void load();
      }
    }
  }, [current, load, loadOnMount, request, token]);

  const save = useCallback(async (messageId: string, expectedCoupleId: string, draft: PersonalActionDraft, requestId: string) => {
    const result = await mutate(messageId, "POST", { messageId, expectedCoupleId, requestId, ...draft }, { kind: "save", sourceMessageId: messageId, draft });
    return result && result !== true ? result : null;
  }, [mutate]);
  const update = useCallback((action: PersonalAction) => {
    if (action.ownerUserId !== personalActionOwner()) return Promise.resolve(null);
    const status = action.status === "done" ? "open" : "done";
    return mutate(action.id, "PATCH", { id: action.id, status, expectedRevision: action.revision }, { kind: "update", id: action.id, status, revision: action.revision });
  }, [mutate]);
  const remove = useCallback((action: PersonalAction) => action.ownerUserId === personalActionOwner()
    ? mutate(action.id, "DELETE", { id: action.id, expectedRevision: action.revision }, null) : Promise.resolve(null), [mutate]);
  const visible = state.owner === owner ? state : { ...EMPTY, owner, loading: !!owner, error: null };
  return { ...visible, owner, isDemo, load, save, update, remove,
    writeError: writeError?.owner === owner ? writeError.text : null,
    busyIds: busy.owner === owner ? busy.ids : [],
  };
}
