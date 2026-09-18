import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Text } from "@/components/ui/AppText";
import { router, useFocusEffect } from "expo-router";
import { Check, ListChecks, RefreshCw } from "lucide-react-native";
import { colors, radius, spacing } from "@hanbang/design-tokens";
import { CATEGORY_CHECKLISTS } from "@hanbang/shared/constants";
import {
  SHARED_ACTION_STATUS_ANNOUNCEMENTS,
  SHARED_ACTION_STATUS_COLUMNS,
  matchesActionUpdateReceipt,
  sharedActionSourceLabel,
  type SharedAction,
  type SharedActionStatus,
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
 * 완료를 되돌릴 수 없었고, 설명·분야·출처·예정일을 버렸다.
 *
 * - 요청은 **시작 시점 계정·커플에 묶는다.** 보내기 전·받은 뒤·읽은 뒤마다 다시 확인하고,
 *   바뀌었으면 보내지 않거나 결과를 버리고 보드를 비운다(`@/lib/amoraActionScope`).
 * - 변경은 한 번에 하나만. 진행 중에는 다른 변경 버튼과 상태 전환을 막는다.
 * - 서버 영수증이 같은 항목·같은 값일 때만 반영한다. 반영 뒤 목록 재조회가 실패하면 다시
 *   불러오기만 주고 **같은 변경을 다시 보내지 않는다.**
 * - 예정일은 사용자가 쓴 글 그대로 "예정일 …" 로 보여준다. 날짜로 바꾸지 않는다.
 */

type ActionStatus = SharedActionStatus;
type BoardState = { kind: "quiet" } | SharedTaskSnapshot;
type Pending = { kind: "status"; id: string };

const READ_ERROR = "준비 상황을 불러오지 못했어요. 다시 시도해 주세요.";
const UPDATE_ERROR = "변경을 저장하지 못했거나 결과를 확인할 수 없어요. 새로고침으로 확인한 뒤 다시 시도해 주세요.";
const PAGE_LIMIT = 80;
const CATEGORY_LABELS: ReadonlyMap<string, string> = new Map(CATEGORY_CHECKLISTS.map((category) => [category.key, category.label]));
const STATUS_LABELS = Object.fromEntries(SHARED_ACTION_STATUS_COLUMNS.map((column) => [column.status, column.label])) as Record<ActionStatus, string>;

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
  const loadingRef = useRef(false);
  const loadGeneration = useRef(0);
  const sessionUserId = useRef<string | null>(null);
  const loadController = useRef<AbortController | null>(null);
  const scopeRef = useRef<ActionScope | null>(null);
  const scopeEpoch = useRef(0);
  const mutationRef = useRef<object | null>(null);
  const status = selectedStatus;

  const resetMutations = useCallback(() => {
    mutationRef.current = null;
    setPending(null);
    setMutationError(null);
    setAnnouncement("");
  }, []);

  const invalidateScope = useCallback(() => {
    scopeEpoch.current += 1;
    loadGeneration.current += 1;
    loadController.current?.abort();
    scopeRef.current = null;
    resetMutations();
    setState({ kind: "quiet" });
    setLoadError(null);
    setAuthGeneration((generation) => generation + 1);
  }, [resetMutations]);

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
        resetMutations();
        setState({ kind: "quiet" });
      }
      scopeRef.current = verifiedScope;
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
  }, [invalidateScope, resetMutations, status]);

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

  /** 변경 하나를 시작 시점 계정·커플에 묶어 보낸다. 보내기 전·받은 뒤·읽은 뒤마다 경계를 다시 본다. */
  const mutate = useCallback(async (
    next: Pending,
    send: (scope: ActionScope) => Promise<Response>,
    apply: (payload: unknown) => boolean,
    onError: () => void,
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
      if (!response.ok) throw new Error("ACTION_SAVE_FAILED");
      const payload: unknown = await response.json();
      const finalScope = await currentVerifiedScope();
      if (!isCurrent()) return;
      if (!sameScope(finalScope, expectedScope)) { invalidateScope(); return; }
      if (!apply(payload)) throw new Error("INVALID_ACTION_RECEIPT");
      // 확인된 변경은 뒤따르는 목록 조회 실패와 분리한다. 재조회가 실패해도 같은 변경을 다시 보내지 않는다.
      await load();
    } catch (error) {
      if (isCurrent()) {
        if (error instanceof Error && error.message === "ACTION_SCOPE_UNAVAILABLE") {
          setState({ kind: "quiet" });
          setLoadError(READ_ERROR);
          scopeRef.current = null;
        } else onError();
      }
    } finally {
      if (mutationRef.current === operation) {
        mutationRef.current = null;
        setPending(null);
      }
    }
  }, [invalidateScope, load]);

  const changeStatus = useCallback((action: SharedAction, next: ActionStatus) => mutate(
    { kind: "status", id: action.id },
    (scope) => apiFetchForExpectedUser(scope.userId, `/api/amora/actions/${encodeURIComponent(action.id)}`, {
      method: "PATCH",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ status: next }),
    }),
    (payload) => {
      if (!matchesActionUpdateReceipt(payload, action.id, { status: next })) return false;
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
  ), [mutate]);

  const selectStatus = useCallback((next: ActionStatus) => {
    if (mutationRef.current || next === selectedStatus) return;
    loadGeneration.current += 1;
    loadController.current?.abort();
    setState({ kind: "quiet" });
    setLoadError(null);
    setMutationError(null);
    setAnnouncement("");
    setSelectedStatus(next);
  }, [selectedStatus]);

  const loadMore = useCallback(() => {
    if (!loadingRef.current && !mutationRef.current && state.kind === "ready" && state.nextCursor) void load(undefined, state.nextCursor);
  }, [load, state]);

  return { selectedStatus, state, loading, loadError, pending, mutationError, announcement, load, loadMore, changeStatus, selectStatus };
}

function TaskCard({ action, disabled, saving, onStatus }: {
  action: SharedAction;
  disabled: boolean;
  saving: boolean;
  onStatus: (action: SharedAction, next: ActionStatus) => void;
}) {
  const categoryLabel = CATEGORY_LABELS.get(action.categoryKey);
  const sourceLabel = sharedActionSourceLabel(action.source);
  const statusButton = (next: ActionStatus, label: string, primary = false) => (
    <Pressable key={next} accessibilityRole="button" accessibilityLabel={`${action.title} ${label}`}
      accessibilityState={{ disabled }} disabled={disabled} onPress={() => onStatus(action, next)}
      style={({ pressed }) => [primary ? styles.primaryButton : styles.outlineButton, pressed && styles.pressed, disabled && styles.disabled]}>
      {primary ? <Check size={14} color={colors.surface} /> : null}
      <Text style={primary ? styles.primaryText : styles.outlineText}>{label}</Text>
    </Pressable>
  );
  return (
    <View style={[styles.card, !categoryLabel && styles.cardUnsorted, action.status === "dismissed" && styles.cardDismissed]}>
      {categoryLabel ? (
        <Pressable accessibilityRole="link" accessibilityLabel={`${categoryLabel} 체크리스트 보기`}
          onPress={() => router.push(checklistRoute(action.categoryKey))} style={styles.chipTouch}>
          <Text style={styles.chip}>{categoryLabel}</Text>
        </Pressable>
      ) : <Text style={styles.unsortedChip}>분야 확인 필요</Text>}
      <Text style={styles.title}>{action.title}</Text>
      {action.description ? <Text style={styles.description}>{action.description}</Text> : null}
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
  const { state, loading, loadError, pending, mutationError, announcement, selectedStatus } = board;
  const busy = pending !== null;
  const column = SHARED_ACTION_STATUS_COLUMNS.find((item) => item.status === selectedStatus);
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
        <TaskCard key={action.id} action={action} disabled={busy || loading}
          saving={pending?.id === action.id} onStatus={(item, next) => void board.changeStatus(item, next)} />
      ))}
      {state.kind === "ready" && state.nextCursor ? <Pressable accessibilityRole="button" accessibilityLabel="기록 더 보기"
        disabled={loading || busy} onPress={board.loadMore} style={styles.textButton}>
        <Text style={styles.outlineText}>기록 더 보기</Text>
      </Pressable> : null}
      {state.kind === "ready" && state.truncated && !state.nextCursor ? <Text style={styles.meta}>추가 기록을 이어서 읽을 수 없어요. 다시 불러와 주세요.</Text> : null}
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
  chipTouch: { minHeight: 44, justifyContent: "center", alignSelf: "flex-start" },
  chip: { fontSize: 12, fontWeight: "600", color: colors.noir.soft, backgroundColor: colors.ivory[200], paddingHorizontal: spacing[2], paddingVertical: 3, borderRadius: radius.full, overflow: "hidden" },
  unsortedChip: { alignSelf: "flex-start", fontSize: 12, fontWeight: "600", color: colors.rose[700], backgroundColor: colors.rose.pale, paddingHorizontal: spacing[2], paddingVertical: 4, borderRadius: radius.full, overflow: "hidden" },
  title: { fontSize: 15, fontWeight: "600", lineHeight: 22, color: colors.noir[800] },
  description: { fontSize: 13, lineHeight: 20, color: colors.textSecondary, backgroundColor: colors.ivory[50], padding: spacing[2], borderRadius: radius.md },
  meta: { fontSize: 12, lineHeight: 18, color: colors.textTertiary },
  actions: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing[2] },
  primaryButton: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: spacing[1], paddingHorizontal: spacing[3], borderRadius: radius.full, backgroundColor: colors.noir[800] },
  primaryText: { fontSize: 13, fontWeight: "700", color: colors.surface },
  outlineButton: { minHeight: 44, flexDirection: "row", alignItems: "center", paddingHorizontal: spacing[3], borderRadius: radius.full, borderWidth: 1, borderColor: colors.paper.outline, backgroundColor: colors.surface },
  outlineText: { fontSize: 13, fontWeight: "600", color: colors.rose[700] },
  textButton: { minHeight: 44, justifyContent: "center", alignSelf: "flex-start" },
  doneBadge: { fontSize: 12, fontWeight: "600", color: colors.noir.soft, backgroundColor: colors.htmlWorkspace.sagePale, paddingHorizontal: spacing[2], paddingVertical: 4, borderRadius: radius.full, overflow: "hidden" },
  hiddenBadge: { fontSize: 12, fontWeight: "600", color: colors.noir.soft, backgroundColor: colors.ivory[200], paddingHorizontal: spacing[2], paddingVertical: 4, borderRadius: radius.full, overflow: "hidden" },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.45 },
});
