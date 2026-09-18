import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Text, TextInput } from "@/components/ui/AppText";
import { router, useFocusEffect } from "expo-router";
import * as Crypto from "expo-crypto";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Check, ListChecks, Pencil, Plus, RefreshCw } from "lucide-react-native";
import { colors, radius, spacing } from "@hanbang/design-tokens";
import { CATEGORY_CHECKLISTS } from "@hanbang/shared/constants";
import {
  SHARED_ACTION_DESCRIPTION_MAX,
  SHARED_ACTION_DUE_MAX,
  SHARED_ACTION_STATUS_ANNOUNCEMENTS,
  SHARED_ACTION_STATUS_COLUMNS,
  SHARED_ACTION_TITLE_MAX,
  buildActionUpdateDiff,
  buildManualCreateBody,
  matchesActionUpdateReceipt,
  matchesManualCreateReceipt,
  sharedActionSourceLabel,
  type SharedAction,
  type SharedActionCreateBody,
  type SharedActionDraft,
  type SharedActionStatus,
  type SharedActionUpdate,
} from "@hanbang/shared/amora-shared-actions";

import { apiFetchForExpectedUser } from "@/lib/api";
import { supabase } from "@/lib/supabase";
import {
  currentVerifiedScope,
  sameScope,
  sharedTaskSnapshot,
  type ActionScope,
  type SharedTaskSnapshot,
} from "@/lib/amoraActionScope";
import { checklistRoute } from "@/lib/checklistCategoryParam";
import { appShadow } from "@/components/ui/AppUI";

/**
 * 준비 기록 화면의 공유 할 일 보드.
 *
 * 웹 보드(`AmoraDecisionBoard` 의 공유 할 일)와 같은 말·같은 규칙을 쓴다
 * (`@hanbang/shared/amora-shared-actions`). 예전 앱 보드는 완료 버튼 하나뿐이라 잘못 누른
 * 완료를 되돌릴 수 없었고, 설명·분야·출처·예정일을 버렸고, 추가·수정도 없었다.
 *
 * - 요청은 **시작 시점 계정·커플에 묶는다.** 보내기 전·받은 뒤·읽은 뒤마다 다시 확인하고,
 *   바뀌었으면 보내지 않거나 결과를 버리고 보드(초안 포함)를 비운다(`@/lib/amoraActionScope`).
 * - 변경(추가·수정·분야·상태)은 한 번에 하나만. 진행 중에는 다른 변경 버튼과 상태 전환을 막는다.
 * - 서버 영수증이 같은 항목·같은 값(서버 정규화 기준)일 때만 반영한다. 반영 뒤 목록 재조회가
 *   실패하면 다시 불러오기만 주고 **같은 변경을 다시 보내지 않는다.**
 * - 추가는 요청번호(expo-crypto v4)를 결과가 확인될 때까지 유지한다. 결과를 모르면 초안을
 *   잠그고 같은 몸통 그대로 다시 확인한다 — 서버가 같은 요청번호를 한 번만 저장한다.
 * - 예정일은 사용자가 쓴 글 그대로 "예정일 …" 로 보여준다. 날짜로 바꾸지 않는다.
 * - 저장은 상대에게 보이는 기록일 뿐이다. 상대에게 알렸다고 쓰지 않는다 — 직접 추가·수정
 *   경로는 지금 알림을 보내지 않는다.
 */

type ActionStatus = SharedActionStatus;
type BoardState = { kind: "quiet" } | SharedTaskSnapshot;
type Pending = { kind: "status" | "edit" | "category"; id: string } | { kind: "create" };
type CreateAttempt = { scope: ActionScope; body: SharedActionCreateBody };
type Editing = { action: SharedAction; draft: SharedActionDraft };
type CategoryPick = { id: string; choice: string };
type Outcome = { status: number; ok: boolean; payload: unknown };

const READ_ERROR = "준비 상황을 불러오지 못했어요. 다시 시도해 주세요.";
const UPDATE_ERROR = "변경을 저장하지 못했거나 결과를 확인할 수 없어요. 새로고침으로 확인한 뒤 다시 시도해 주세요.";
const CREATE_UNKNOWN = "저장 결과를 확인하지 못했어요. 같은 요청을 다시 확인하거나 목록을 확인해 주세요. 이미 저장됐을 수 있어요.";
const CREATE_CONFLICT = "기존 저장 내용이 달라졌어요. 목록을 확인해 주세요.";
const PAGE_LIMIT = 80;
const EMPTY_DRAFT: SharedActionDraft = { title: "", categoryKey: "", description: "", dueDate: "" };
const CATEGORY_LABELS: ReadonlyMap<string, string> = new Map(CATEGORY_CHECKLISTS.map((category) => [category.key, category.label]));
const CATEGORY_OPTIONS = CATEGORY_CHECKLISTS.map((category) => ({ value: category.key, label: category.label }));
const STATUS_LABELS = Object.fromEntries(SHARED_ACTION_STATUS_COLUMNS.map((column) => [column.status, column.label])) as Record<ActionStatus, string>;
const JSON_HEADERS = { Accept: "application/json", "Content-Type": "application/json" };

class VisibleMutationError extends Error {}

function serverCopy(payload: unknown, fallback: string) {
  const text = payload && typeof payload === "object" && "error" in payload ? payload.error : null;
  return typeof text === "string" && text.trim() && text.length <= 200 ? text.trim() : fallback;
}

function useSharedTaskBoard() {
  const [selectedStatus, setSelectedStatus] = useState<ActionStatus>("open");
  const [state, setState] = useState<BoardState>({ kind: "quiet" });
  const [authGeneration, setAuthGeneration] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [scopeUserId, setScopeUserId] = useState<string | null>(null);
  const [canCreate, setCanCreate] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [createDraft, setCreateDraft] = useState<SharedActionDraft>(EMPTY_DRAFT);
  const [createLocked, setCreateLocked] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [categoryPick, setCategoryPick] = useState<CategoryPick | null>(null);
  const loadingRef = useRef(false);
  const loadGeneration = useRef(0);
  const sessionUserId = useRef<string | null>(null);
  const loadController = useRef<AbortController | null>(null);
  const scopeRef = useRef<ActionScope | null>(null);
  const scopeEpoch = useRef(0);
  const mutationRef = useRef<object | null>(null);
  const createAttempt = useRef<CreateAttempt | null>(null);
  const status = selectedStatus;

  /** 계정·커플이 바뀌면 앞 사람의 변경·초안·요청번호를 하나도 남기지 않는다. */
  const resetScopeState = useCallback(() => {
    mutationRef.current = null;
    createAttempt.current = null;
    setPending(null);
    setMutationError(null);
    setAnnouncement("");
    setCanCreate(false);
    setCreateOpen(false);
    setCreateDraft(EMPTY_DRAFT);
    setCreateLocked(false);
    setCreateError(null);
    setConfirmCancel(false);
    setEditing(null);
    setEditError(null);
    setCategoryPick(null);
  }, []);

  const invalidateScope = useCallback(() => {
    scopeEpoch.current += 1;
    loadGeneration.current += 1;
    loadController.current?.abort();
    scopeRef.current = null;
    resetScopeState();
    setState({ kind: "quiet" });
    setLoadError(null);
    setAuthGeneration((generation) => generation + 1);
  }, [resetScopeState]);

  const load = useCallback(async (signal?: AbortSignal, cursor?: string) => {
    const operation = ++loadGeneration.current;
    loadingRef.current = true;
    setLoading(true);
    let verifiedScope: ActionScope | null = null;
    try {
      verifiedScope = await currentVerifiedScope();
      if (operation !== loadGeneration.current || signal?.aborted) return;
      sessionUserId.current = verifiedScope?.userId ?? null;
      setScopeUserId(verifiedScope?.userId ?? null);
      if (!sameScope(scopeRef.current, verifiedScope)) {
        scopeEpoch.current += 1;
        resetScopeState();
        setState({ kind: "quiet" });
      }
      scopeRef.current = verifiedScope;
      setCanCreate(Boolean(verifiedScope?.coupleId));
      setLoadError(null);
      if (!verifiedScope) {
        setState({ kind: "quiet" });
        return;
      }
      const response = await apiFetchForExpectedUser(
        verifiedScope.userId,
        `/api/amora/actions?status=${status}&limit=${PAGE_LIMIT}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
        { method: "GET", headers: { Accept: "application/json" }, signal },
      );
      const scopeAfterResponse = await currentVerifiedScope();
      if (operation !== loadGeneration.current || signal?.aborted) return;
      if (!sameScope(verifiedScope, scopeAfterResponse)) { invalidateScope(); return; }
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) setState({ kind: "quiet" });
        throw new Error("ACTION_READ_FAILED");
      }
      const snapshot = sharedTaskSnapshot(await response.json(), status);
      const finalScope = await currentVerifiedScope();
      if (operation !== loadGeneration.current || signal?.aborted) return;
      if (!sameScope(verifiedScope, finalScope)) { invalidateScope(); return; }
      if (cursor && snapshot.nextCursor === cursor) throw new Error("INVALID_ACTION_CURSOR");
      setState(current => {
        if (!cursor || current.kind !== "ready" || current.status !== status) return snapshot;
        const incoming = new Map(snapshot.visible.map(action => [action.id, action]));
        const visible = current.visible.map(action => incoming.get(action.id) ?? action);
        const seen = new Set(visible.map(action => action.id));
        visible.push(...snapshot.visible.filter(action => !seen.has(action.id)));
        return { ...snapshot, visible, truncated: snapshot.totalCount > visible.length };
      });
      setLoadError(null);
    } catch (error) {
      if (
        operation === loadGeneration.current
        && !(error instanceof Error && error.name === "AbortError")
      ) {
        if (!verifiedScope || !sameScope(verifiedScope, scopeRef.current)
          || (error instanceof Error && error.message === "ACTION_SCOPE_UNAVAILABLE")) setState({ kind: "quiet" });
        setLoadError(READ_ERROR);
      }
    } finally {
      if (operation === loadGeneration.current) { loadingRef.current = false; setLoading(false); }
    }
  }, [invalidateScope, resetScopeState, status]);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      const nextUserId = session?.user.id ?? null;
      if (nextUserId === sessionUserId.current) return;
      sessionUserId.current = nextUserId;
      // 계정이 바뀌면 앞 사람의 카드·초안이 한 프레임도 남으면 안 된다. 구독 직후 첫 이벤트도
      // 여기로 오므로 authGeneration 을 올려 최초 적재를 다시 부른다(AmoraActionsCard 와 같다).
      invalidateScope();
    });
    return () => subscription.unsubscribe();
  }, [invalidateScope]);

  useEffect(() => {
    if (!scopeUserId) return;
    const channel = supabase.channel(`shared-task-scope:${scopeUserId}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "profiles", filter: `id=eq.${scopeUserId}` }, event => {
        const previous = scopeRef.current;
        if (previous && (event.new.couple_id !== previous.coupleId || event.new.role !== previous.role)) invalidateScope();
      }).subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [invalidateScope, scopeUserId]);

  useFocusEffect(
    useCallback(() => {
      const controller = new AbortController();
      loadController.current = controller;
      void load(controller.signal);
      return () => {
        controller.abort();
        if (loadController.current === controller) loadController.current = null;
        loadGeneration.current += 1;
        scopeEpoch.current += 1;
        mutationRef.current = null;
        setPending(null);
      };
    }, [authGeneration, load]),
  );

  /**
   * 변경 하나를 시작 시점 계정·커플에 묶어 보낸다. 보내기 전·받은 뒤·읽은 뒤마다 경계를 다시 본다.
   * `apply` 가 영수증을 확인해 반영했을 때만 `followUp`(목록 재조회)을 부른다.
   */
  const mutate = useCallback(async (
    next: Pending,
    send: (scope: ActionScope) => Promise<Response>,
    apply: (outcome: Outcome) => boolean,
    onError: (error: unknown) => void,
    followUp: () => Promise<void> | void,
  ) => {
    if (mutationRef.current || !scopeRef.current) return;
    const operation = {};
    mutationRef.current = operation;
    const expectedScope = scopeRef.current;
    const epoch = scopeEpoch.current;
    const isCurrent = () => mutationRef.current === operation && scopeEpoch.current === epoch && sameScope(scopeRef.current, expectedScope);
    setPending(next);
    setMutationError(null);
    setAnnouncement("");
    try {
      const before = await currentVerifiedScope();
      if (!isCurrent()) return;
      if (!sameScope(before, expectedScope)) { invalidateScope(); return; }
      const response = await send(expectedScope);
      const after = await currentVerifiedScope();
      if (!isCurrent()) return;
      if (!sameScope(after, expectedScope)) { invalidateScope(); return; }
      let payload: unknown = null;
      try { payload = await response.json(); } catch { payload = null; }
      const finalScope = await currentVerifiedScope();
      if (!isCurrent()) return;
      if (!sameScope(finalScope, expectedScope)) { invalidateScope(); return; }
      if (!apply({ status: response.status, ok: response.ok, payload })) throw new Error("INVALID_ACTION_RECEIPT");
      // 확인된 변경은 뒤따르는 목록 조회 실패와 분리한다. 재조회가 실패해도 같은 변경을 다시 보내지 않는다.
      await followUp();
    } catch (error) {
      if (isCurrent()) {
        // 계정을 확인하지 못하면 목록을 비우고 다시 불러오게 한다. 초안·요청번호는 남긴다 — 다음 조회가
        // 같은 계정·커플을 확인하면 그대로 이어서 확인하고, 다르면 조회가 모두 비운다.
        if (error instanceof Error && error.message === "ACTION_SCOPE_UNAVAILABLE") {
          setState({ kind: "quiet" });
          setLoadError(READ_ERROR);
        }
        onError(error);
      }
    } finally {
      if (mutationRef.current === operation) {
        mutationRef.current = null;
        setPending(null);
      }
    }
  }, [invalidateScope]);

  const replaceCard = useCallback((saved: SharedAction) => {
    setState(current => current.kind !== "ready" ? current : saved.status === current.status
      ? { ...current, visible: current.visible.map(row => row.id === saved.id ? saved : row) }
      : { ...current, visible: current.visible.filter(row => row.id !== saved.id), totalCount: Math.max(0, current.totalCount - 1) });
  }, []);

  const patchAction = useCallback((scope: ActionScope, id: string, updates: SharedActionUpdate) => apiFetchForExpectedUser(
    scope.userId, `/api/amora/actions/${encodeURIComponent(id)}`,
    { method: "PATCH", headers: JSON_HEADERS, body: JSON.stringify(updates) },
  ), []);

  const changeStatus = useCallback((action: SharedAction, next: ActionStatus) => mutate(
    { kind: "status", id: action.id },
    (scope) => patchAction(scope, action.id, { status: next }),
    ({ ok, payload }) => {
      if (!ok || !matchesActionUpdateReceipt(payload, action.id, { status: next })) return false;
      setState(current => current.kind !== "ready" ? current : {
        ...current,
        visible: current.visible.filter(row => row.id !== action.id),
        totalCount: Math.max(0, current.totalCount - 1),
        openCount: Math.max(0, current.openCount - Number(action.status === "open") + Number(next === "open")),
      });
      setAnnouncement(`${action.title} — ${SHARED_ACTION_STATUS_ANNOUNCEMENTS[next]}`);
      return true;
    },
    () => setMutationError(UPDATE_ERROR),
    () => load(),
  ), [load, mutate, patchAction]);

  // ── 추가 ────────────────────────────────────────────────────────────

  const clearCreate = useCallback(() => {
    createAttempt.current = null;
    setCreateDraft(EMPTY_DRAFT);
    setCreateLocked(false);
    setCreateError(null);
    setConfirmCancel(false);
  }, []);

  const openCreate = useCallback(() => {
    if (mutationRef.current || !scopeRef.current?.coupleId) return;
    setEditing(null);
    setCategoryPick(null);
    setCreateOpen(true);
  }, []);

  /** 창만 닫는다. 결과를 모르는 요청과 초안은 그대로 두어 다시 열면 이어서 확인할 수 있다. */
  const hideCreate = useCallback(() => {
    if (mutationRef.current) return;
    setConfirmCancel(false);
    setCreateOpen(false);
  }, []);

  const editCreateDraft = useCallback((patch: Partial<SharedActionDraft>) => {
    if (mutationRef.current || createAttempt.current) return;
    setCreateDraft(draft => ({ ...draft, ...patch }));
  }, []);

  const cancelCreate = useCallback(() => {
    if (mutationRef.current) return;
    if (createAttempt.current) { setConfirmCancel(true); return; }
    clearCreate();
    setCreateOpen(false);
  }, [clearCreate]);

  /** 확인을 거두고 같은 요청(같은 요청번호·같은 몸통)을 그대로 둔다. */
  const keepCreateRequest = useCallback(() => { setConfirmCancel(false); }, []);

  const confirmCancelCreate = useCallback(() => {
    if (mutationRef.current) return;
    clearCreate();
    setCreateOpen(false);
  }, [clearCreate]);

  const submitCreate = useCallback(async () => {
    const scope = scopeRef.current;
    if (mutationRef.current || !scope?.coupleId || loadingRef.current) return;
    let attempt = createAttempt.current;
    if (attempt && !sameScope(attempt.scope, scope)) { createAttempt.current = null; attempt = null; }
    if (!attempt) {
      const body = buildManualCreateBody(createDraft, {
        requestId: Crypto.randomUUID(), expectedOwnerId: scope.userId, expectedCoupleId: scope.coupleId,
      });
      if (!body) return;
      attempt = { scope, body };
      createAttempt.current = attempt;
    }
    const sent = attempt;
    setCreateLocked(true);
    setCreateError(null);
    setConfirmCancel(false);
    await mutate(
      { kind: "create" },
      (current) => apiFetchForExpectedUser(current.userId, "/api/amora/actions", {
        method: "POST", headers: JSON_HEADERS, body: JSON.stringify(sent.body),
      }),
      ({ ok, status: code, payload }) => {
        if (code === 409 && payload && typeof payload === "object" && "code" in payload && payload.code === "AMORA_ACTION_CREATE_CONFLICT") {
          throw new VisibleMutationError(serverCopy(payload, CREATE_CONFLICT));
        }
        if (!ok || !matchesManualCreateReceipt(payload, sent.body)) return false;
        clearCreate();
        setCreateOpen(false);
        setAnnouncement("공유 할 일을 추가했어요.");
        return true;
      },
      (error) => setCreateError(error instanceof VisibleMutationError ? error.message : CREATE_UNKNOWN),
      async () => {
        if (status === "open") { await load(); return; }
        // 새 할 일은 진행 중이다. 상태를 옮기면 그 상태의 첫 조회가 한 번 일어난다.
        loadGeneration.current += 1;
        loadController.current?.abort();
        setState({ kind: "quiet" });
        setSelectedStatus("open");
      },
    );
  }, [clearCreate, createDraft, load, mutate, status]);

  // ── 수정 ────────────────────────────────────────────────────────────

  const openEdit = useCallback((action: SharedAction) => {
    if (mutationRef.current) return;
    setCategoryPick(null);
    setEditError(null);
    setEditing({ action, draft: { title: action.title, categoryKey: action.categoryKey, description: action.description, dueDate: action.dueDate } });
  }, []);

  const editDraft = useCallback((patch: Partial<SharedActionDraft>) => {
    if (mutationRef.current) return;
    setEditing(current => current && { ...current, draft: { ...current.draft, ...patch } });
  }, []);

  const closeEdit = useCallback(() => {
    if (mutationRef.current) return;
    setEditing(null);
    setEditError(null);
  }, []);

  const submitEdit = useCallback(async () => {
    const current = editing;
    if (!current || mutationRef.current) return;
    const updates = buildActionUpdateDiff(current.action, current.draft);
    if (!updates) return;
    if (Object.keys(updates).length === 0) { setEditing(null); setEditError(null); return; }
    setEditError(null);
    await mutate(
      { kind: "edit", id: current.action.id },
      (scope) => patchAction(scope, current.action.id, updates),
      ({ ok, payload }) => {
        const saved = ok ? matchesActionUpdateReceipt(payload, current.action.id, updates) : null;
        if (!saved) return false;
        replaceCard(saved);
        setEditing(null);
        setAnnouncement(`${saved.title} — 수정한 내용을 저장했어요.`);
        return true;
      },
      () => setEditError(UPDATE_ERROR),
      () => undefined,
    );
  }, [editing, mutate, patchAction, replaceCard]);

  // ── 분야 지정 ────────────────────────────────────────────────────────

  const pickCategory = useCallback((id: string, choice: string) => {
    if (mutationRef.current) return;
    setCategoryPick({ id, choice });
  }, []);

  const saveCategory = useCallback(async (action: SharedAction) => {
    const pick = categoryPick;
    if (!pick || pick.id !== action.id || !CATEGORY_LABELS.has(pick.choice) || mutationRef.current) return;
    const updates = { category_key: pick.choice };
    await mutate(
      { kind: "category", id: action.id },
      (scope) => patchAction(scope, action.id, updates),
      ({ ok, payload }) => {
        const saved = ok ? matchesActionUpdateReceipt(payload, action.id, updates) : null;
        if (!saved) return false;
        replaceCard(saved);
        setCategoryPick(null);
        setAnnouncement(`${saved.title} — ${CATEGORY_LABELS.get(pick.choice)} 분야에 넣었어요.`);
        return true;
      },
      () => setMutationError(UPDATE_ERROR),
      () => undefined,
    );
  }, [categoryPick, mutate, patchAction, replaceCard]);

  const cancelCategory = useCallback(() => {
    if (mutationRef.current) return;
    setCategoryPick(null);
  }, []);

  // ── 목록 ────────────────────────────────────────────────────────────

  const selectStatus = useCallback((next: ActionStatus) => {
    if (mutationRef.current || next === selectedStatus) return;
    loadGeneration.current += 1;
    loadController.current?.abort();
    setState({ kind: "quiet" });
    setLoadError(null);
    setMutationError(null);
    setAnnouncement("");
    setCategoryPick(null);
    setSelectedStatus(next);
  }, [selectedStatus]);

  const loadMore = useCallback(() => {
    if (!loadingRef.current && !mutationRef.current && state.kind === "ready" && state.nextCursor) void load(undefined, state.nextCursor);
  }, [load, state]);

  return {
    selectedStatus, state, loading, loadError, pending, mutationError, announcement, canCreate,
    createOpen, createDraft, createLocked, createError, confirmCancel, editing, editError, categoryPick,
    load, loadMore, changeStatus, selectStatus,
    openCreate, hideCreate, editCreateDraft, cancelCreate, keepCreateRequest, confirmCancelCreate, submitCreate,
    openEdit, editDraft, closeEdit, submitEdit, pickCategory, saveCategory, cancelCategory,
  };
}

type Board = ReturnType<typeof useSharedTaskBoard>;

function Choice({ label, selected, disabled, onPress }: { label: string; selected: boolean; disabled: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="radio" accessibilityLabel={label} accessibilityState={{ checked: selected, disabled }}
      disabled={disabled} onPress={onPress} style={[styles.choice, selected && styles.choiceSelected, disabled && styles.disabled]}>
      <Text style={selected ? styles.choiceSelectedText : styles.choiceText}>{label}</Text>
    </Pressable>
  );
}

function CategoryChoices({ options, value, disabled, onChange }: {
  options: ReadonlyArray<{ value: string; label: string }>; value: string; disabled: boolean; onChange: (value: string) => void;
}) {
  return (
    <View style={styles.choices} accessibilityRole="radiogroup">
      {options.map((option) => (
        <Choice key={option.value || "none"} label={option.label} selected={value === option.value} disabled={disabled} onPress={() => onChange(option.value)} />
      ))}
    </View>
  );
}

/** 웹 `AmoraActionPlanFields` 와 같은 설명·예정일 칸. */
function PlanFields({ draft, disabled, onChange }: { draft: SharedActionDraft; disabled: boolean; onChange: (patch: Partial<SharedActionDraft>) => void }) {
  return <>
    <Text style={styles.label}>설명 (선택)</Text>
    <TextInput accessibilityLabel="설명" value={draft.description} onChangeText={(description) => onChange({ description })}
      maxLength={SHARED_ACTION_DESCRIPTION_MAX} editable={!disabled} multiline placeholder="무엇을 준비하거나 확인할지 적어 주세요"
      placeholderTextColor={colors.textTertiary} style={[styles.input, styles.multiline, disabled && styles.disabled]} />
    <Text style={styles.label}>예정일 (선택)</Text>
    <TextInput accessibilityLabel="예정일" accessibilityHint="날짜나 예정 시기를 40자 이내로 적을 수 있어요." value={draft.dueDate}
      onChangeText={(dueDate) => onChange({ dueDate })} maxLength={SHARED_ACTION_DUE_MAX} editable={!disabled}
      placeholder="예: 2026-10-15 또는 다음 주 중" placeholderTextColor={colors.textTertiary} style={[styles.input, disabled && styles.disabled]} />
    <Text style={styles.hint}>날짜나 예정 시기를 40자 이내로 적을 수 있어요.</Text>
  </>;
}

function Sheet({ title, closeLabel, onClose, closeDisabled, bottomInset, busy, footer, children }: {
  title: string; closeLabel: string; onClose: () => void; closeDisabled: boolean; bottomInset: number; busy: boolean;
  footer: ReactNode; children: ReactNode;
}) {
  return (
    <Modal visible transparent animationType="slide" onRequestClose={() => { if (!closeDisabled) onClose(); }}>
      <KeyboardAvoidingView style={styles.overlay} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={[styles.sheet, { paddingBottom: spacing[4] + bottomInset }]} accessibilityViewIsModal accessibilityState={{ busy }}>
          <View style={styles.sheetHeader}>
            <Text accessibilityRole="header" style={styles.sheetTitle}>{title}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel={closeLabel} disabled={closeDisabled} onPress={onClose} style={[styles.textButton, closeDisabled && styles.disabled]}>
              <Text style={styles.outlineText}>닫기</Text>
            </Pressable>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.sheetBody}>{children}</ScrollView>
          <View style={styles.sheetFooter}>{footer}</View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function CreateSheet({ board, bottomInset }: { board: Board; bottomInset: number }) {
  const busy = board.pending?.kind === "create";
  const locked = board.createLocked;
  const fieldsDisabled = busy || locked;
  const draft = board.createDraft;
  const titleOk = draft.title.trim().length > 0 && draft.title.trim().length <= SHARED_ACTION_TITLE_MAX;
  // 웹과 같다: 목록을 읽는 중이거나 읽지 못한 동안에는 저장·재확인을 막는다(먼저 목록을 확인한다).
  const saveDisabled = board.pending !== null || !board.canCreate || board.loading || !!board.loadError || !titleOk;
  const saveLabel = busy ? "추가하는 중…" : locked ? "같은 요청 다시 확인" : "할 일 저장";
  return (
    <Sheet title="공유 할 일 추가" closeLabel="추가 창 닫기" onClose={board.hideCreate} closeDisabled={busy} bottomInset={bottomInset} busy={busy}
      footer={<>
        {board.createError ? <Text accessibilityRole="alert" style={styles.error}>{board.createError}</Text> : null}
        <View style={styles.footerRow}>
          <Pressable accessibilityRole="button" accessibilityLabel={saveLabel} accessibilityState={{ disabled: saveDisabled, busy }}
            disabled={saveDisabled} onPress={() => void board.submitCreate()} style={[styles.primaryButton, styles.grow, saveDisabled && styles.disabled]}>
            <Text style={styles.primaryText}>{saveLabel}</Text>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="작성 취소" disabled={busy} onPress={board.cancelCreate} style={[styles.outlineButton, busy && styles.disabled]}>
            <Text style={styles.outlineText}>작성 취소</Text>
          </Pressable>
        </View>
      </>}>
      <Text style={styles.label}>할 일 제목</Text>
      <TextInput accessibilityLabel="할 일 제목" value={draft.title} onChangeText={(title) => board.editCreateDraft({ title })}
        maxLength={SHARED_ACTION_TITLE_MAX} editable={!fieldsDisabled} style={[styles.input, fieldsDisabled && styles.disabled]} />
      <Text style={styles.label}>분야 (선택)</Text>
      <CategoryChoices options={[{ value: "", label: "나중에 정하기" }, ...CATEGORY_OPTIONS]} value={draft.categoryKey}
        disabled={fieldsDisabled} onChange={(categoryKey) => board.editCreateDraft({ categoryKey })} />
      <PlanFields draft={draft} disabled={fieldsDisabled} onChange={board.editCreateDraft} />
      <Text style={styles.hint}>함께 준비하는 사람에게도 보이는 할 일이에요. 저장은 두 사람의 합의나 실제 수행 완료를 뜻하지 않아요.</Text>
      {locked && !busy ? <Text accessibilityLiveRegion="polite" style={styles.hint}>이미 저장됐을 수 있어 같은 내용으로 다시 확인해요. 이 요청은 현재 화면에서만 유지돼요. 화면을 다시 열었다면 목록부터 확인해 주세요.</Text> : null}
      {board.confirmCancel ? <View style={styles.confirmBox}>
        <Text style={styles.confirmText}>이미 저장된 할 일은 취소해도 삭제되지 않아요. 목록에서 기존 항목을 확인했으며, 다음 작성은 별도의 새 할 일로 시작할까요?</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="확인했어요 · 새 작성으로 전환" disabled={busy} onPress={board.confirmCancelCreate} style={styles.outlineButton}>
          <Text style={styles.outlineText}>확인했어요 · 새 작성으로 전환</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="같은 요청 유지" disabled={busy} onPress={board.keepCreateRequest} style={styles.textButton}>
          <Text style={styles.outlineText}>같은 요청 유지</Text>
        </Pressable>
      </View> : null}
    </Sheet>
  );
}

function EditSheet({ board, editing, bottomInset }: { board: Board; editing: Editing; bottomInset: number }) {
  const busy = board.pending?.kind === "edit";
  const disabled = board.pending !== null;
  const { action, draft } = editing;
  const knownCategory = CATEGORY_LABELS.has(action.categoryKey);
  const options = [
    { value: "", label: "분야 미지정" },
    ...(!knownCategory && action.categoryKey ? [{ value: action.categoryKey, label: "기존 분야 유지" }] : []),
    ...CATEGORY_OPTIONS,
  ];
  const valid = buildActionUpdateDiff(action, draft) !== null;
  return (
    <Sheet title="공유 할 일 수정" closeLabel="수정 창 닫기" onClose={board.closeEdit} closeDisabled={disabled} bottomInset={bottomInset} busy={busy}
      footer={<>
        {board.editError ? <Text accessibilityRole="alert" style={styles.error}>{board.editError}</Text> : null}
        <View style={styles.footerRow}>
          <Pressable accessibilityRole="button" accessibilityLabel="수정 저장" accessibilityState={{ disabled: disabled || !valid, busy }}
            disabled={disabled || !valid} onPress={() => void board.submitEdit()} style={[styles.primaryButton, styles.grow, (disabled || !valid) && styles.disabled]}>
            <Text style={styles.primaryText}>{busy ? "저장하는 중…" : "수정 저장"}</Text>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="수정 취소" disabled={disabled} onPress={board.closeEdit} style={[styles.outlineButton, disabled && styles.disabled]}>
            <Text style={styles.outlineText}>취소</Text>
          </Pressable>
        </View>
      </>}>
      <Text style={styles.label}>할 일 제목</Text>
      <TextInput accessibilityLabel="할 일 제목" value={draft.title} onChangeText={(title) => board.editDraft({ title })}
        maxLength={SHARED_ACTION_TITLE_MAX} editable={!disabled} style={[styles.input, disabled && styles.disabled]} />
      <Text style={styles.label}>분야</Text>
      <CategoryChoices options={options} value={draft.categoryKey} disabled={disabled} onChange={(categoryKey) => board.editDraft({ categoryKey })} />
      <PlanFields draft={draft} disabled={disabled} onChange={board.editDraft} />
      <Text style={styles.hint}>함께 준비하는 사람에게도 보이는 기록이에요.</Text>
    </Sheet>
  );
}

function TaskCard({ board, action, disabled }: { board: Board; action: SharedAction; disabled: boolean }) {
  const categoryLabel = CATEGORY_LABELS.get(action.categoryKey);
  const sourceLabel = sharedActionSourceLabel(action.source);
  const saving = board.pending !== null && "id" in board.pending && board.pending.id === action.id;
  const pick = board.categoryPick?.id === action.id ? board.categoryPick : null;
  const statusButton = (next: ActionStatus, label: string, primary = false) => (
    <Pressable key={next} accessibilityRole="button" accessibilityLabel={`${action.title} ${label}`}
      accessibilityState={{ disabled }} disabled={disabled} onPress={() => void board.changeStatus(action, next)}
      style={({ pressed }) => [primary ? styles.primaryButton : styles.outlineButton, pressed && styles.pressed, disabled && styles.disabled]}>
      {primary ? <Check size={14} color={colors.surface} /> : null}
      <Text style={primary ? styles.primaryText : styles.outlineText}>{label}</Text>
    </Pressable>
  );
  return (
    <View style={[styles.card, !categoryLabel && styles.cardUnsorted, action.status === "dismissed" && styles.cardDismissed]}>
      <View style={styles.cardTop}>
        {categoryLabel ? (
          <Pressable accessibilityRole="link" accessibilityLabel={`${categoryLabel} 체크리스트 보기`}
            onPress={() => router.push(checklistRoute(action.categoryKey))} style={styles.chipTouch}>
            <Text style={styles.chip}>{categoryLabel}</Text>
          </Pressable>
        ) : <Text style={styles.unsortedChip}>분야 확인 필요</Text>}
        <Pressable accessibilityRole="button" accessibilityLabel={`${action.title} 수정`} accessibilityState={{ disabled }} disabled={disabled}
          onPress={() => board.openEdit(action)} style={[styles.iconButton, disabled && styles.disabled]}>
          <Pencil size={16} color={colors.rose[700]} />
        </Pressable>
      </View>
      <Text style={styles.title}>{action.title}</Text>
      {action.description ? <Text style={styles.description}>{action.description}</Text> : null}
      {!categoryLabel ? <View style={styles.pickBox}>
        <Text style={styles.pickLabel}>어느 분야에 넣을까요?</Text>
        {pick ? <>
          <CategoryChoices options={CATEGORY_OPTIONS} value={pick.choice} disabled={disabled} onChange={(choice) => board.pickCategory(action.id, choice)} />
          <View style={styles.footerRow}>
            <Pressable accessibilityRole="button" accessibilityLabel={`${action.title} 분야 저장`} accessibilityState={{ disabled: disabled || !pick.choice }}
              disabled={disabled || !pick.choice} onPress={() => void board.saveCategory(action)} style={[styles.outlineButton, (disabled || !pick.choice) && styles.disabled]}>
              <Text style={styles.outlineText}>저장</Text>
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel={`${action.title} 분야 선택 취소`} disabled={disabled} onPress={board.cancelCategory} style={styles.textButton}>
              <Text style={styles.outlineText}>취소</Text>
            </Pressable>
          </View>
        </> : <Pressable accessibilityRole="button" accessibilityLabel={`${action.title} 분야 선택`} accessibilityState={{ disabled }} disabled={disabled}
          onPress={() => board.pickCategory(action.id, "")} style={[styles.outlineButton, disabled && styles.disabled]}>
          <Text style={styles.outlineText}>21개 분야에서 선택</Text>
        </Pressable>}
      </View> : null}
      {sourceLabel ? <Text style={styles.meta}>{sourceLabel}</Text> : null}
      {action.dueDate ? <Text style={styles.meta}>예정일 {action.dueDate}</Text> : null}
      <View style={styles.actions}>
        {action.status === "open" ? <>
          {statusButton("done", "완료로 표시", true)}
          {statusButton("dismissed", "보류·숨김")}
        </> : <>
          <Text style={action.status === "done" ? styles.doneBadge : styles.hiddenBadge}>{action.status === "done" ? "완료한 할 일" : "숨겨 둔 할 일"}</Text>
          {statusButton("open", action.status === "done" ? "다시 진행" : "다시 꺼내기")}
        </>}
        {saving ? <Text accessibilityLiveRegion="polite" style={styles.meta}>저장 중…</Text> : null}
      </View>
    </View>
  );
}

export default function SharedTaskBoard() {
  const board = useSharedTaskBoard();
  const insets = useSafeAreaInsets();
  const { state, loading, loadError, pending, mutationError, announcement, selectedStatus } = board;
  const busy = pending !== null;
  const column = SHARED_ACTION_STATUS_COLUMNS.find((item) => item.status === selectedStatus);
  const addDisabled = busy || loading || !!loadError;
  return (
    <View style={styles.section}>
      <View style={styles.header}>
        <ListChecks size={16} color={colors.rose[600]} />
        <Text accessibilityRole="header" style={styles.headerText}>공유 할 일</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="공유 할 일 새로고침" accessibilityState={{ disabled: busy || loading }}
          disabled={busy || loading} onPress={() => void board.load()} style={[styles.refresh, (busy || loading) && styles.disabled]}>
          <RefreshCw size={16} color={colors.rose[700]} />
          <Text style={styles.outlineText}>새로고침</Text>
        </Pressable>
      </View>
      <Text style={styles.intro}>카드의 상태는 직접 바꿔요. 완료는 할 일의 상태이며 두 사람의 합의 여부를 뜻하지 않아요.</Text>

      {board.canCreate ? <View style={styles.notice}>
        <Pressable accessibilityRole="button" accessibilityLabel="공유 할 일 추가" accessibilityState={{ disabled: addDisabled }} disabled={addDisabled}
          onPress={board.openCreate} style={[styles.outlineButton, styles.addButton, addDisabled && styles.disabled]}>
          <Plus size={16} color={colors.rose[700]} />
          <Text style={styles.outlineText}>공유 할 일 추가</Text>
        </Pressable>
        {board.createLocked && !board.createOpen ? <Text style={styles.meta}>저장 여부는 목록을 새로고쳐 확인해 주세요.</Text> : null}
      </View> : null}

      <View style={styles.filters} accessibilityRole="tablist">
        {SHARED_ACTION_STATUS_COLUMNS.map((item) => (
          <Pressable key={item.status} accessibilityRole="tab" accessibilityLabel={`${item.label} 기록 보기`}
            accessibilityState={{ selected: selectedStatus === item.status, disabled: busy }} disabled={busy}
            onPress={() => board.selectStatus(item.status)}
            style={[styles.filter, selectedStatus === item.status && styles.filterSelected, busy && styles.disabled]}>
            <Text style={selectedStatus === item.status ? styles.filterSelectedText : styles.filterText}>{item.label}</Text>
          </Pressable>
        ))}
      </View>
      {column ? <Text style={styles.meta}>{column.rule}</Text> : null}

      {announcement ? <Text accessibilityLiveRegion="polite" style={styles.announcement}>{announcement}</Text> : null}
      {loadError ? <View style={styles.notice}>
        <Text style={styles.error} accessibilityRole="alert">{loadError}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="다시 불러오기" disabled={busy} onPress={() => void board.load()} style={styles.textButton}>
          <Text style={styles.outlineText}>다시 불러오기</Text>
        </Pressable>
      </View> : null}
      {mutationError ? <View style={styles.notice}>
        <Text style={styles.error} accessibilityRole="alert">{mutationError}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="다시 불러오기" disabled={busy || loading} onPress={() => void board.load()} style={styles.textButton}>
          <Text style={styles.outlineText}>다시 불러오기</Text>
        </Pressable>
      </View> : null}
      {loading ? <Text accessibilityLiveRegion="polite" style={styles.meta}>공유 할 일을 불러오는 중이에요.</Text> : null}
      {state.kind === "ready" ? <Text style={styles.meta}>{STATUS_LABELS[state.status]} {state.totalCount}개 중 {state.visible.length}개 표시 중{state.truncated ? " · 일부 목록을 불러왔어요." : ""}</Text> : null}
      {!loading && !loadError && state.kind === "ready" && state.totalCount === 0 ? <Text style={styles.empty}>{STATUS_LABELS[state.status]} 할 일이 아직 없어요.</Text> : null}
      {(state.kind === "ready" ? state.visible : []).map((action) => (
        <TaskCard key={action.id} board={board} action={action} disabled={busy || loading} />
      ))}
      {state.kind === "ready" && state.nextCursor ? <Pressable accessibilityRole="button" accessibilityLabel="기록 더 보기"
        disabled={loading || busy} onPress={board.loadMore} style={styles.textButton}>
        <Text style={styles.outlineText}>기록 더 보기</Text>
      </Pressable> : null}
      {state.kind === "ready" && state.truncated && !state.nextCursor ? <Text style={styles.meta}>추가 기록을 이어서 읽을 수 없어요. 다시 불러와 주세요.</Text> : null}

      {board.createOpen ? <CreateSheet board={board} bottomInset={insets.bottom} /> : null}
      {board.editing ? <EditSheet board={board} editing={board.editing} bottomInset={insets.bottom} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    marginBottom: spacing[4],
    borderRadius: radius["2xl"],
    borderWidth: 1,
    borderColor: colors.sage.pale,
    backgroundColor: colors.surface,
    padding: spacing[4],
    gap: spacing[3],
    ...appShadow,
  },
  header: { flexDirection: "row", alignItems: "center", gap: spacing[2] },
  headerText: { flex: 1, fontSize: 16, fontWeight: "700", color: colors.noir[800] },
  refresh: { minHeight: 44, minWidth: 44, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing[1], paddingHorizontal: spacing[2] },
  intro: { fontSize: 13, lineHeight: 20, color: colors.textSecondary },
  addButton: { alignSelf: "flex-start", gap: spacing[1] },
  filters: { flexDirection: "row", gap: spacing[1], padding: 3, borderRadius: radius.lg, backgroundColor: colors.ivory[100] },
  filter: { flex: 1, minHeight: 44, alignItems: "center", justifyContent: "center", paddingHorizontal: spacing[2], borderRadius: radius.md },
  filterSelected: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.rose[600] },
  filterText: { fontSize: 13, color: colors.textSecondary },
  filterSelectedText: { fontSize: 13, fontWeight: "700", color: colors.noir[800] },
  announcement: { fontSize: 13, lineHeight: 19, color: colors.sage.deep },
  notice: { gap: spacing[1] },
  error: { fontSize: 13, lineHeight: 19, color: colors.dangerDeep },
  empty: { fontSize: 13, lineHeight: 19, color: colors.textSecondary, paddingVertical: spacing[3], textAlign: "center" },
  card: { gap: spacing[2], padding: spacing[3], borderRadius: radius.xl, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  cardUnsorted: { borderColor: colors.rose.light },
  cardDismissed: { borderStyle: "dashed" },
  cardTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing[2] },
  chipTouch: { minHeight: 44, justifyContent: "center", alignSelf: "flex-start", flexShrink: 1 },
  chip: { fontSize: 12, fontWeight: "600", color: colors.noir.soft, backgroundColor: colors.ivory[200], paddingHorizontal: spacing[2], paddingVertical: 3, borderRadius: radius.full, overflow: "hidden" },
  unsortedChip: { alignSelf: "flex-start", fontSize: 12, fontWeight: "600", color: colors.rose[700], backgroundColor: colors.rose.pale, paddingHorizontal: spacing[2], paddingVertical: 4, borderRadius: radius.full, overflow: "hidden" },
  iconButton: { minHeight: 44, minWidth: 44, alignItems: "center", justifyContent: "center", borderRadius: radius.lg },
  title: { fontSize: 15, fontWeight: "600", lineHeight: 22, color: colors.noir[800] },
  description: { fontSize: 13, lineHeight: 20, color: colors.textSecondary, backgroundColor: colors.ivory[50], padding: spacing[2], borderRadius: radius.md },
  pickBox: { gap: spacing[2] },
  pickLabel: { fontSize: 12, fontWeight: "600", color: colors.rose[700] },
  meta: { fontSize: 12, lineHeight: 18, color: colors.textTertiary },
  actions: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing[2] },
  primaryButton: { minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing[1], paddingHorizontal: spacing[3], borderRadius: radius.full, backgroundColor: colors.noir[800] },
  primaryText: { fontSize: 13, fontWeight: "700", color: colors.surface },
  outlineButton: { minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "center", paddingHorizontal: spacing[3], borderRadius: radius.full, borderWidth: 1, borderColor: colors.paper.outline, backgroundColor: colors.surface },
  outlineText: { fontSize: 13, fontWeight: "600", color: colors.rose[700] },
  textButton: { minHeight: 44, justifyContent: "center", alignSelf: "flex-start" },
  doneBadge: { fontSize: 12, fontWeight: "600", color: colors.noir.soft, backgroundColor: colors.htmlWorkspace.sagePale, paddingHorizontal: spacing[2], paddingVertical: 4, borderRadius: radius.full, overflow: "hidden" },
  hiddenBadge: { fontSize: 12, fontWeight: "600", color: colors.noir.soft, backgroundColor: colors.ivory[200], paddingHorizontal: spacing[2], paddingVertical: 4, borderRadius: radius.full, overflow: "hidden" },
  choices: { flexDirection: "row", flexWrap: "wrap", gap: spacing[2] },
  choice: { minHeight: 44, justifyContent: "center", paddingHorizontal: spacing[3], borderRadius: radius.full, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  choiceSelected: { borderColor: colors.rose[600], backgroundColor: colors.rose.pale },
  choiceText: { fontSize: 13, color: colors.textSecondary },
  choiceSelectedText: { fontSize: 13, fontWeight: "700", color: colors.noir[800] },
  overlay: { flex: 1, justifyContent: "flex-end", backgroundColor: `${colors.paper.inkPressed}66` },
  sheet: { maxHeight: "92%", paddingTop: spacing[4], paddingHorizontal: spacing[4], borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, backgroundColor: colors.bg },
  sheetHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing[2] },
  sheetTitle: { flex: 1, fontSize: 18, fontWeight: "700", color: colors.noir[800] },
  sheetBody: { gap: spacing[2], paddingBottom: spacing[4] },
  sheetFooter: { gap: spacing[2], paddingTop: spacing[2], borderTopWidth: 1, borderTopColor: colors.border },
  footerRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing[2] },
  grow: { flexGrow: 1 },
  label: { fontSize: 13, marginTop: spacing[2], color: colors.noir[800] },
  input: { minHeight: 44, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing[3], paddingVertical: spacing[2], fontSize: 16, color: colors.noir[800], backgroundColor: colors.surface },
  multiline: { minHeight: 88, textAlignVertical: "top" },
  hint: { fontSize: 12, lineHeight: 19, color: colors.textSecondary },
  confirmBox: { gap: spacing[2], padding: spacing[3], borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  confirmText: { fontSize: 13, lineHeight: 20, color: colors.noir[800] },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.45 },
});
