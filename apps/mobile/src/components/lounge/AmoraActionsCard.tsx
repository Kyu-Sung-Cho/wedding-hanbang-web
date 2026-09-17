import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Text } from "@/components/ui/AppText";
import { router, useFocusEffect } from "expo-router";
import { Check, ListChecks } from "lucide-react-native";
import { colors, radius, spacing } from "@hanbang/design-tokens";

import { apiFetchForExpectedUser } from "@/lib/api";
import { supabase } from "@/lib/supabase";
import {
  AMORA_ACTION_VISIBLE_LIMIT,
  buildCompleteActionBody,
  formatAmoraActionDueDate,
  parseAmoraActions,
  selectOpenAmoraActions,
} from "@/lib/amoraActions.mjs";
import { appShadow } from "@/components/ui/AppUI";

/**
 * 아모라가 챙기기로 한 것을 라운지에 보여준다.
 *
 * 서버는 이미 다 있었다 — `add_amora_action` 이 승인 카드로 나가고,
 * `/api/amora/actions` 가 목록을 주고, 웹 라운지는 그것을 보여준다.
 * **모바일에는 호출자가 0건이었다.** 앱에서 승인한 "챙길 것"이 저장은 되는데 앱
 * 어디에도 나타나지 않았다. 사용자에게는 방금 누른 승인이 사라지는 것으로 보인다.
 *
 * 요청은 **시작 시점 사용자에게 묶는다**(`apiFetchForExpectedUser`). 계정을 바꾼 뒤
 * 늦게 도착한 응답이 다른 사람의 할 일을 이 화면에 그리면 안 된다.
 *
 * 문구는 서버가 소유한다(`title`). 여기서 지어내지 않는다.
 */

type ActionRow = ReturnType<typeof parseAmoraActions>[number];
type ActionStatus = "open" | "done" | "dismissed";
const STATUS_LABELS: Record<ActionStatus, string> = { open: "진행 중", done: "완료", dismissed: "보류" };

type ViewState =
  | { kind: "quiet" }
  | { kind: "ready"; visible: ActionRow[]; hiddenCount: number; openCount: number; totalCount: number; truncated: boolean; nextCursor: string | null; status: ActionStatus };

type ActionScope = { userId: string; coupleId: string | null; role: string | null };
const sameScope = (left: ActionScope | null, right: ActionScope | null) =>
  left?.userId === right?.userId && left?.coupleId === right?.coupleId && left?.role === right?.role;

function actionSnapshot(payload: unknown, status: ActionStatus, board: boolean): ViewState {
  if (!payload || typeof payload !== "object" || !("actions" in payload) || !Array.isArray(payload.actions)
    || !("open_count" in payload) || !Number.isSafeInteger(payload.open_count)
    || typeof payload.open_count !== "number" || payload.open_count < 0
    || !("count" in payload) || typeof payload.count !== "number" || !Number.isSafeInteger(payload.count) || payload.count < 0
    || (status === "open" && payload.count !== payload.open_count)
    || ("truncated" in payload && typeof payload.truncated !== "boolean")) throw new Error("INVALID_ACTION_SNAPSHOT");
  const parsed = parseAmoraActions(payload);
  if (parsed.length !== payload.actions.length || payload.actions.some(action => !action || typeof action !== "object" || action.status !== status)
    || payload.count < parsed.length || new Set(parsed.map(action => action.id)).size !== parsed.length
    || ("next_cursor" in payload && payload.next_cursor !== null && (typeof payload.next_cursor !== "string" || !payload.next_cursor))) {
    throw new Error("INVALID_ACTION_SNAPSHOT");
  }
  const visible = board ? parsed : selectOpenAmoraActions(parsed, AMORA_ACTION_VISIBLE_LIMIT).visible;
  return {
    kind: "ready", visible, openCount: payload.open_count, totalCount: payload.count, status,
    hiddenCount: payload.count - visible.length, truncated: board ? payload.count > visible.length : "truncated" in payload && payload.truncated === true,
    nextCursor: "next_cursor" in payload && typeof payload.next_cursor === "string" ? payload.next_cursor : null,
  };
}

async function currentVerifiedUserId(): Promise<string | null> {
  const { data, error } = await supabase.auth.getUser();
  if (error) throw new Error("ACTION_SCOPE_UNAVAILABLE");
  return data.user?.id ?? null;
}

async function currentVerifiedScope(): Promise<ActionScope | null> {
  const userId = await currentVerifiedUserId();
  if (!userId) return null;
  const { data, error } = await supabase.from("profiles").select("couple_id, role").eq("id", userId).single();
  if (error || !data || (data.couple_id !== null && typeof data.couple_id !== "string")
    || (data.role !== null && typeof data.role !== "string")) throw new Error("ACTION_SCOPE_UNAVAILABLE");
  if (await currentVerifiedUserId() !== userId) return null;
  return { userId, coupleId: data.couple_id, role: data.role };
}

export default function AmoraActionsCard({
  refreshVersion = 0,
  presentation = "preview",
}: {
  /** 라운지의 당겨서 새로고침과 함께 다시 읽는다. */
  refreshVersion?: number;
  presentation?: "preview" | "board";
}) {
  const board = presentation === "board";
  const [selectedStatus, setSelectedStatus] = useState<ActionStatus>("open");
  const status = board ? selectedStatus : "open";
  const [state, setState] = useState<ViewState>({ kind: "quiet" });
  const [authGeneration, setAuthGeneration] = useState(0);
  const [completing, setCompleting] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [completionError, setCompletionError] = useState<ActionRow | null>(null);
  const [scopeUserId, setScopeUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const loadingRef = useRef(false);
  const loadGeneration = useRef(0);
  const sessionUserId = useRef<string | null>(null);
  const loadController = useRef<AbortController | null>(null);
  const scopeRef = useRef<ActionScope | null>(null);
  const scopeEpoch = useRef(0);
  const completionRef = useRef<object | null>(null);

  const invalidateScope = useCallback(() => {
    scopeEpoch.current += 1;
    loadGeneration.current += 1;
    loadController.current?.abort();
    scopeRef.current = null;
    completionRef.current = null;
    setState({ kind: "quiet" });
    setCompleting(null);
    setLoadError(null);
    setCompletionError(null);
    setAuthGeneration((generation) => generation + 1);
  }, []);

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
        completionRef.current = null;
        setCompleting(null);
        setCompletionError(null);
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
        `/api/amora/actions?status=${status}&limit=${board ? 80 : 20}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
        { method: "GET", headers: { Accept: "application/json" }, signal },
      );
      const scopeAfterResponse = await currentVerifiedScope();
      if (operation !== loadGeneration.current || signal?.aborted) return;
      if (!sameScope(verifiedScope, scopeAfterResponse)) { invalidateScope(); return; }
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) setState({ kind: "quiet" });
        throw new Error("ACTION_READ_FAILED");
      }
      const snapshot = actionSnapshot(await response.json(), status, board);
      const finalScope = await currentVerifiedScope();
      if (operation !== loadGeneration.current || signal?.aborted) return;
      if (!sameScope(verifiedScope, finalScope)) { invalidateScope(); return; }
      if (cursor && snapshot.kind === "ready" && snapshot.nextCursor === cursor) throw new Error("INVALID_ACTION_CURSOR");
      setState(current => {
        if (!cursor || current.kind !== "ready" || snapshot.kind !== "ready" || current.status !== status) return snapshot;
        const incoming = new Map(snapshot.visible.map(action => [action.id, action]));
        const visible = current.visible.map(action => incoming.get(action.id) ?? action);
        const seen = new Set(visible.map(action => action.id));
        visible.push(...snapshot.visible.filter(action => !seen.has(action.id)));
        return { ...snapshot, visible, hiddenCount: Math.max(0, snapshot.totalCount - visible.length), truncated: snapshot.totalCount > visible.length };
      });
      setLoadError(null);
      setCompletionError(null);
    } catch (error) {
      if (
        operation === loadGeneration.current
        && !(error instanceof Error && error.name === "AbortError")
      ) {
        if (!verifiedScope || !sameScope(verifiedScope, scopeRef.current)
          || (error instanceof Error && error.message === "ACTION_SCOPE_UNAVAILABLE")) setState({ kind: "quiet" });
        setLoadError("챙길 것을 불러오지 못했어요. 다시 불러와 주세요.");
      }
    } finally {
      if (operation === loadGeneration.current) { loadingRef.current = false; setLoading(false); }
    }
  }, [board, invalidateScope, status]);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      const nextUserId = session?.user.id ?? null;
      if (nextUserId === sessionUserId.current) return;
      sessionUserId.current = nextUserId;
      // 계정이 바뀌면 앞 사람의 줄이 한 프레임도 남으면 안 된다.
      // 이 줄이 없으면 **첫 이벤트가 최초 적재를 끊고 끝난다.** 구독 직후 도착하는 첫
      // 이벤트는 sessionUserId 가 아직 null 이라 계정 전환으로 읽히는데, 다시 부를
      // 트리거가 없어 앱을 켜고 라운지에 머무는 사람은 목록을 한 번도 못 본다.
      invalidateScope();
    });
    return () => subscription.unsubscribe();
  }, [invalidateScope]);

  useEffect(() => {
    if (!scopeUserId) return;
    const channel = supabase.channel(`amora-action-scope:${scopeUserId}`)
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
        completionRef.current = null;
        setCompleting(null);
      };
    }, [authGeneration, load, refreshVersion]),
  );

  const complete = useCallback(
    async (action: ActionRow) => {
      if (completionRef.current || !scopeRef.current) return;
      const operation = {};
      completionRef.current = operation;
      const expectedScope = scopeRef.current;
      const epoch = scopeEpoch.current;
      const isCurrent = () => completionRef.current === operation && scopeEpoch.current === epoch && sameScope(scopeRef.current, expectedScope);
      setCompleting(action.id);
      setCompletionError(null);
      try {
        const before = await currentVerifiedScope();
        if (!isCurrent()) return;
        if (!sameScope(before, expectedScope)) { invalidateScope(); return; }
        const response = await apiFetchForExpectedUser(
          expectedScope.userId,
          `/api/amora/actions/${encodeURIComponent(action.id)}`,
          {
            method: "PATCH",
            headers: { Accept: "application/json", "Content-Type": "application/json" },
            body: JSON.stringify(buildCompleteActionBody()),
          },
        );
        const after = await currentVerifiedScope();
        if (!isCurrent()) return;
        if (!sameScope(after, expectedScope)) { invalidateScope(); return; }
        if (!response.ok) throw new Error("ACTION_SAVE_FAILED");
        const payload: unknown = await response.json();
        const finalScope = await currentVerifiedScope();
        if (!isCurrent()) return;
        if (!sameScope(finalScope, expectedScope)) { invalidateScope(); return; }
        if (!payload || typeof payload !== "object" || !("action" in payload) || !payload.action
          || typeof payload.action !== "object" || !("id" in payload.action) || payload.action.id !== action.id
          || !("status" in payload.action) || payload.action.status !== "done") throw new Error("INVALID_ACTION_RECEIPT");
        // 확인된 완료는 후속 목록 조회 실패와 분리한다. 재시도로 같은 완료를 다시 보내지 않는다.
        setState(current => current.kind !== "ready" ? current : {
          ...current, visible: current.visible.filter(row => row.id !== action.id), openCount: Math.max(0, current.openCount - 1),
          totalCount: Math.max(0, current.totalCount - 1),
        });
        await load();
      } catch (error) {
        if (isCurrent()) {
          if (error instanceof Error && error.message === "ACTION_SCOPE_UNAVAILABLE") {
            setState({ kind: "quiet" });
            setLoadError("챙길 것을 불러오지 못했어요. 다시 불러와 주세요.");
            scopeRef.current = null;
          } else setCompletionError(action);
        }
      } finally {
        if (completionRef.current === operation) {
          completionRef.current = null;
          setCompleting(null);
        }
      }
    },
    [invalidateScope, load],
  );

  function changeStatus(next: ActionStatus) {
    if (completionRef.current || next === selectedStatus) return;
    loadGeneration.current += 1;
    loadController.current?.abort();
    setState({ kind: "quiet" });
    setLoadError(null);
    setCompletionError(null);
    setSelectedStatus(next);
  }

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <ListChecks size={14} color={colors.rose[600]} />
        <Text style={styles.headerText}>아모라가 챙기기로 한 것</Text>
      </View>
      {board ? <View style={styles.filters}>{(Object.keys(STATUS_LABELS) as ActionStatus[]).map(value => (
        <Pressable key={value} accessibilityRole="button" accessibilityLabel={`${STATUS_LABELS[value]} 기록 보기`}
          accessibilityState={{ selected: selectedStatus === value }} disabled={completing !== null}
          onPress={() => changeStatus(value)} style={[styles.filter, selectedStatus === value && styles.filterSelected]}>
          <Text style={styles.doneText}>{STATUS_LABELS[value]}</Text>
        </Pressable>
      ))}</View> : <Pressable accessibilityRole="button" accessibilityLabel="준비 기록 보기" onPress={() => router.push("/amora-preparation")} style={styles.retryButton}>
        <Text style={styles.doneText}>준비 기록 보기</Text>
      </Pressable>}

      {loadError ? <View>
        <Text style={styles.error} accessibilityRole="alert">{loadError}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="다시 불러오기" disabled={completing !== null} onPress={() => void load()} style={styles.retryButton}>
          <Text style={styles.doneText}>다시 불러오기</Text>
        </Pressable>
      </View> : null}
      {completionError ? <View>
        <Text style={styles.error} accessibilityRole="alert">완료 여부를 확인하지 못했어요. 다시 확인하거나 시도해 주세요.</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="다시 불러오기" disabled={completing !== null} onPress={() => void load()} style={styles.retryButton}>
          <Text style={styles.doneText}>다시 불러오기</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="완료 다시 시도" disabled={completing !== null} onPress={() => void complete(completionError)} style={styles.retryButton}>
          <Text style={styles.doneText}>완료 다시 시도</Text>
        </Pressable>
      </View> : null}
      {loading ? <Text accessibilityLiveRegion="polite" style={styles.more}>불러오는 중이에요.</Text> : null}
      {state.kind === "ready" ? <Text style={styles.more}>{board ? STATUS_LABELS[state.status] : "미완료"} {state.totalCount}개 중 {state.visible.length}개 표시 중{state.truncated ? " · 일부 목록을 불러왔어요." : ""}</Text> : null}
      {board && !loading && !loadError && state.kind === "ready" && state.totalCount === 0 ? <Text style={styles.more}>{STATUS_LABELS[state.status]} 기록이 아직 없어요.</Text> : null}
      {(state.kind === "ready" ? state.visible : []).map((action) => {
        const due = formatAmoraActionDueDate(action.dueDate);
        return (
          <View key={action.id} style={styles.row}>
            <View style={styles.rowText}>
              <Text style={styles.title} numberOfLines={board ? undefined : 2}>
                {action.title}
              </Text>
              {due ? <Text style={styles.due}>{due}</Text> : null}
            </View>
            {action.status === "open" ? <Pressable
              onPress={() => void complete(action)}
              disabled={completing !== null || loading}
              accessibilityRole="button"
              accessibilityLabel={`${action.title} 완료로 표시`}
              style={({ pressed }) => [
                styles.doneButton,
                pressed && { opacity: 0.62 },
                completing !== null && { opacity: 0.4 },
              ]}
            >
              <Check size={14} color={colors.rose[600]} />
              <Text style={styles.doneText}>완료</Text>
            </Pressable> : <Text style={styles.more}>{STATUS_LABELS[action.status as ActionStatus]}</Text>}
          </View>
        );
      })}

      {state.kind === "ready" && state.hiddenCount > 0 ? (
        <Text style={styles.more}>외 {state.hiddenCount}개가 더 있어요.</Text>
      ) : null}
      {board && state.kind === "ready" && state.nextCursor ? <Pressable accessibilityRole="button" accessibilityLabel="기록 더 보기"
        disabled={loading || completing !== null} style={styles.retryButton}
        onPress={() => { if (!loadingRef.current) void load(undefined, state.nextCursor ?? undefined); }}>
        <Text style={styles.doneText}>기록 더 보기</Text>
      </Pressable> : null}
      {board && state.kind === "ready" && state.truncated && !state.nextCursor ? <Text style={styles.more}>추가 기록을 이어서 읽을 수 없어요. 다시 불러와 주세요.</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginBottom: spacing[4],
    borderRadius: radius["2xl"],
    borderWidth: 1,
    borderColor: colors.sage.pale,
    backgroundColor: colors.surface,
    paddingVertical: spacing[4],
    paddingHorizontal: spacing[4],
    gap: spacing[3],
    ...appShadow,
  },
  header: { flexDirection: "row", alignItems: "center", gap: spacing[1] },
  headerText: { fontSize: 12, fontWeight: "600", color: colors.rose[600] },
  row: { flexDirection: "row", alignItems: "center", gap: spacing[2] },
  rowText: { flex: 1, gap: 2 },
  title: { fontSize: 14, fontWeight: "600", color: colors.noir[800], lineHeight: 20 },
  due: { fontSize: 12, color: colors.textTertiary },
  doneButton: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingVertical: spacing[2],
    paddingHorizontal: spacing[3],
    borderRadius: radius.lg,
    backgroundColor: colors.ivory[100],
  },
  doneText: { fontSize: 12, fontWeight: "600", color: colors.rose[700] },
  more: { fontSize: 12, color: colors.textTertiary },
  error: { fontSize: 12, color: colors.rose[600], lineHeight: 18 },
  retryButton: { minHeight: 44, justifyContent: "center", alignSelf: "flex-start" },
  filters: { flexDirection: "row", flexWrap: "wrap", gap: spacing[2] },
  filter: { minHeight: 44, paddingHorizontal: spacing[3], justifyContent: "center", borderRadius: radius.lg, borderWidth: 1, borderColor: colors.ivory[100], backgroundColor: colors.ivory[100] },
  filterSelected: { backgroundColor: colors.rose.pale, borderColor: colors.rose[600] },
});
