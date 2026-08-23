import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { Bell, ChevronRight } from "lucide-react-native";
import { colors, radius, spacing } from "@hanbang/design-tokens";

import { apiFetchForExpectedUser } from "@/lib/api";
import { supabase } from "@/lib/supabase";
import {
  buildMarkReadBody,
  buildPlanChangeDecisionRequest,
  canOpenCoupleChange,
  getCoupleChangeNativeRoute,
  isAwaitingMyApproval,
  parseCoupleChangeNotifications,
  readPlanChangeDecisionOutcome,
  selectCoupleChangesForViewer,
  type CoupleChangeNotification,
  type PlanChangeDecision,
} from "@/lib/coupleChangeNotifications.mjs";
import { appShadow } from "@/components/ui/AppUI";

/**
 * 파트너가 무엇을 바꿨는지 라운지 맨 위에 알린다.
 *
 * 서버(`couple_change_notifications`)도 `/api/notifications` 도 이미 있었고 웹은
 * 상단 패널로 보여줬다. 그런데 **소비자의 주 제품인 모바일에는 호출자가 하나도
 * 없었다** — 상대가 총예산을 바꿔도 앱을 열어 숫자를 직접 보지 않는 한 알 수 없었다.
 *
 * 문구는 서버가 소유한다(`title`·`message`). 여기서 지어내지 않는다.
 *
 * 요청은 **시작 시점 사용자에게 묶는다**(`apiFetchForExpectedUser`). 계정을 바꾼
 * 뒤 늦게 도착한 응답이 다른 사람의 알림을 이 화면에 그리면 안 된다.
 */

const VISIBLE_LIMIT = 3;

type ViewState =
  | { kind: "quiet" }
  | {
      kind: "ready";
      visible: CoupleChangeNotification[];
      unreadCount: number;
      hiddenCount: number;
      /** 내가 눌러야 끝나는 계획 변경 요청. 읽음 여부와 무관하게 남는다. */
      awaitingDecision: CoupleChangeNotification[];
    };

async function currentVerifiedUserId(): Promise<string | null> {
  const { data, error } = await supabase.auth.getUser();
  return error ? null : data.user?.id ?? null;
}

export default function PartnerChangeNotice({
  refreshVersion = 0,
}: {
  /** 라운지의 당겨서 새로고침과 함께 다시 읽는다. 이것이 없으면 갱신 경로가 탭 왕복뿐이다. */
  refreshVersion?: number;
}) {
  const [state, setState] = useState<ViewState>({ kind: "quiet" });
  // 어느 줄인지만이 아니라 **어느 결정인지**도 담는다. 그러지 않으면 진행
  // 표시가 누르지 않은 버튼에 붙는다.
  const [deciding, setDeciding] = useState<{ id: string; decision: PlanChangeDecision } | null>(null);
  const [authGeneration, setAuthGeneration] = useState(0);
  const loadGeneration = useRef(0);
  const sessionUserId = useRef<string | null>(null);
  const loadController = useRef<AbortController | null>(null);
  const opening = useRef(false);

  const load = useCallback(async (signal?: AbortSignal) => {
    const operation = ++loadGeneration.current;
    try {
      const userId = await currentVerifiedUserId();
      sessionUserId.current = userId;
      if (!userId) {
        if (operation === loadGeneration.current) setState({ kind: "quiet" });
        return;
      }
      const res = await apiFetchForExpectedUser(userId, "/api/notifications", {
        method: "GET",
        headers: { Accept: "application/json" },
        signal,
      });
      if (!res.ok) {
        // 알림을 못 불러온 것으로 라운지를 막지 않는다. 조용히 비운다.
        if (operation === loadGeneration.current) setState({ kind: "quiet" });
        return;
      }
      const parsed = parseCoupleChangeNotifications(await res.json());
      const userIdAfterResponse = await currentVerifiedUserId();
      if (
        operation !== loadGeneration.current
        || userIdAfterResponse !== userId
      ) {
        return;
      }
      // 봉투의 주인이 보는 사람과 같을 때만 그린다 — 웹이 이미 같은 대조를 한다.
      const picked = selectCoupleChangesForViewer(parsed, userId, VISIBLE_LIMIT);
      setState(
        picked.unreadCount === 0 && picked.awaitingDecision.length === 0
          ? { kind: "quiet" }
          : { kind: "ready", ...picked },
      );
    } catch (error) {
      if (
        operation === loadGeneration.current
        && !(error instanceof Error && error.name === "AbortError")
      ) {
        setState({ kind: "quiet" });
      }
    }
  }, []);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      const nextUserId = session?.user.id ?? null;
      if (nextUserId === sessionUserId.current) return;
      sessionUserId.current = nextUserId;
      loadGeneration.current += 1;
      loadController.current?.abort();
      loadController.current = null;
      // 계정이 바뀌면 앞 사람의 줄이 한 프레임도 남아 있으면 안 된다.
      setState({ kind: "quiet" });
      // 이 줄이 없으면 **첫 이벤트가 최초 적재를 끊고 끝난다.** 구독 직후 도착하는
      // 첫 이벤트는 sessionUserId 가 아직 null 이라 계정 전환으로 읽히는데, 다시
      // 부를 트리거가 없어 앱을 켜고 라운지에 머무는 사람은 알림을 한 번도 못 본다.
      setAuthGeneration((generation) => generation + 1);
    });
    return () => subscription.unsubscribe();
  }, []);

  // 다른 화면에서 확인하고 돌아오면 그 줄은 사라져 있어야 한다.
  useFocusEffect(
    useCallback(() => {
      const controller = new AbortController();
      loadController.current = controller;
      void load(controller.signal);
      return () => {
        controller.abort();
        if (loadController.current === controller) loadController.current = null;
        loadGeneration.current += 1;
      };
    }, [authGeneration, load, refreshVersion]),
  );

  const markRead = useCallback(
    async (ids: string[] | "all") => {
      const body = buildMarkReadBody(ids);
      if (!body) return;
      const userId = sessionUserId.current ?? (await currentVerifiedUserId());
      if (!userId) return;
      try {
        await apiFetchForExpectedUser(userId, "/api/notifications", {
          method: "POST",
          headers: { Accept: "application/json" },
          body: JSON.stringify(body),
        });
      } catch {
        // 읽음 저장 실패로 이동을 막지 않는다. 다음 열람 때 다시 보인다.
      }
      await load();
    },
    [load],
  );

  /**
   * 라운지에서 바로 확인·거절한다.
   *
   * 여기가 없던 동안 `/dashboard` 표면 요청(식장만 바꾼 경우가 대표적이다)은
   * 모바일에서 처리할 방법이 아예 없었다 — 배지만 뜨고 24시간 뒤 만료됐다.
   * 웹 알림 패널이 이미 같은 두 버튼을 갖고 있고, 서버 계약도 같다.
   *
   * 결과는 반드시 말한다. 말하지 않으면 **상대가 거절한 화면과 내가 반영한
   * 화면이 똑같다** — 둘 다 줄이 사라지고 라운지 숫자만 남는다.
   */
  const decide = useCallback(
    async (notification: CoupleChangeNotification, decision: PlanChangeDecision) => {
      const plan = buildPlanChangeDecisionRequest(notification.actionId, decision);
      if (!plan || deciding) return;
      const userId = sessionUserId.current ?? (await currentVerifiedUserId());
      if (!userId) return;
      setDeciding({ id: notification.id, decision });
      try {
        const res = await apiFetchForExpectedUser(userId, plan.path, {
          method: plan.method,
          headers: { Accept: "application/json", "Content-Type": "application/json" },
          body: plan.body,
        });
        const payload = await res.json().catch(() => null);
        const outcome = readPlanChangeDecisionOutcome(res.status, payload, decision);
        if (outcome.kind === "applied") {
          Alert.alert("계획 변경을 반영했어요", "두 사람의 확인이 끝나 최신 기록에 반영됐어요.");
        } else if (outcome.kind === "rejected") {
          Alert.alert("계획 변경을 반영하지 않았어요", "기존 정보는 그대로 유지돼요.");
        } else if (outcome.kind === "pending") {
          Alert.alert("확인을 보냈어요", "상대의 확인이 끝나면 반영돼요.");
        } else {
          // 서버가 준 문장을 그대로 쓴다. 만료·충돌·권한이 서로 다른 말을 한다.
          Alert.alert(
            "처리하지 못했어요",
            outcome.message ?? "잠시 후 라운지를 새로고침한 뒤 다시 확인해 주세요.",
          );
        }
      } catch {
        Alert.alert("처리하지 못했어요", "연결을 확인한 뒤 다시 시도해 주세요.");
      } finally {
        setDeciding(null);
      }
      // 성공이든 실패든 서버가 정본이다. 다시 읽어 화면을 맞춘다.
      await load();
    },
    [deciding, load],
  );

  const open = useCallback(
    (notification: CoupleChangeNotification) => {
      // 갈 데가 없으면 읽음 처리도 하지 않는다. 화면은 그대로인데 줄만 사라지면
      // 사용자는 방금 무엇을 잃었는지 알 수 없다.
      if (!canOpenCoupleChange(notification)) return;
      const route = getCoupleChangeNativeRoute(notification.href);
      if (!route) return;
      // 빠르게 두 번 누르면 같은 화면이 두 번 쌓인다.
      if (opening.current) return;
      opening.current = true;
      setTimeout(() => { opening.current = false; }, 600);
      void markRead([notification.id]);
      router.push(route as never);
    },
    [markRead],
  );

  if (state.kind === "quiet") return null;

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={styles.headerLabel}>
          <Bell size={14} color={colors.rose[600]} />
          <Text style={styles.eyebrow}>
            {state.awaitingDecision.length > 0
              ? (state.awaitingDecision.length === 1
                ? "함께 확인할 변경이 하나 있어요"
                : `함께 확인할 변경이 ${state.awaitingDecision.length}개 있어요`)
              : (state.unreadCount === 1
                ? "함께 볼 소식이 하나 있어요"
                : `함께 볼 소식이 ${state.unreadCount}개 있어요`)}
          </Text>
        </View>
        {state.unreadCount > 0 ? (
          <Pressable
            onPress={() => void markRead("all")}
            accessibilityRole="button"
            accessibilityLabel="알림 모두 읽음으로 표시"
            hitSlop={8}
          >
            <Text style={styles.markAll}>모두 읽음</Text>
          </Pressable>
        ) : null}
      </View>

      {state.awaitingDecision.map((notification) => {
        const busy = deciding?.id === notification.id;
        return (
          // 이 줄에는 `accessible` 을 붙이지 않는다. iOS 에서 그것은
          // isAccessibilityElement=YES 가 되어 **안에 있는 두 버튼이 VoiceOver
          // 초점을 못 받는다** — 라벨은 한 문장으로 읽히지만 누를 수가 없어서
          // 이 화면이 없애려던 결과(24시간 뒤 만료)가 그대로 남는다.
          // 아래 읽기 전용 줄에는 상호작용 자식이 없어 `accessible` 이 옳다.
          <View key={notification.id} style={styles.row}>
            <View style={styles.rowText}>
              <View style={styles.rowTitleLine}>
                <Text style={styles.rowTitle} numberOfLines={2}>
                  {notification.title}
                </Text>
                <Text style={styles.waitingPill}>확인 필요</Text>
              </View>
              {/*
                여기서는 요약을 자르지 않는다. 바로 아래 버튼이 되돌릴 수 없는
                반영을 실행하는데, 요약은 240자까지 오고 예식일·예식장·총예산·
                카테고리 예산이 한 요청에 함께 담길 수 있다. 세 줄로 자르면
                사용자는 **못 본 변경까지 승인한다.** 서버 계약도 "승인을
                요청받는 모든 변경값을 공개한다"이다.
              */}
              <Text style={styles.rowMessage}>{notification.message}</Text>
              <View style={styles.decisionRow}>
                <Pressable
                  onPress={() => void decide(notification, "accept")}
                  disabled={deciding !== null}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: deciding !== null, busy: busy && deciding?.decision === "accept" }}
                  accessibilityLabel={`${notification.title} 확인하고 반영`}
                  style={({ pressed }) => [
                    styles.acceptButton,
                    (pressed || deciding !== null) && styles.buttonDim,
                  ]}
                >
                  {/* 진행 표시는 **누른 버튼**에 붙이고 라벨을 지우지 않는다.
                      지우면 거절을 눌렀는데 "확인하고 반영" 자리에서 스피너가
                      도는 것으로 보인다. 웹도 라벨 옆에 덧붙인다. */}
                  {busy && deciding?.decision === "accept" ? (
                    <ActivityIndicator size="small" color={colors.surface} />
                  ) : null}
                  <Text style={styles.acceptLabel}>확인하고 반영</Text>
                </Pressable>
                <Pressable
                  onPress={() => void decide(notification, "reject")}
                  disabled={deciding !== null}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: deciding !== null, busy: busy && deciding?.decision === "reject" }}
                  accessibilityLabel={`${notification.title} 이번 요청 거절`}
                  style={({ pressed }) => [
                    styles.rejectButton,
                    (pressed || deciding !== null) && styles.buttonDim,
                  ]}
                >
                  {busy && deciding?.decision === "reject" ? (
                    <ActivityIndicator size="small" color={colors.rose[600]} />
                  ) : null}
                  <Text style={styles.rejectLabel}>이번 요청 거절</Text>
                </Pressable>
              </View>
            </View>
          </View>
        );
      })}

      {state.visible.map((notification) => {
        const openable = canOpenCoupleChange(notification);
        const body = (
          <>
            <View style={styles.rowText}>
              <View style={styles.rowTitleLine}>
                <Text style={styles.rowTitle} numberOfLines={2}>
                  {notification.title}
                </Text>
                {isAwaitingMyApproval(notification) ? (
                  <Text style={styles.waitingPill}>확인 필요</Text>
                ) : null}
              </View>
              <Text style={styles.rowMessage} numberOfLines={3}>
                {notification.message}
              </Text>
            </View>
            {openable ? <ChevronRight size={16} color={colors.textTertiary} /> : null}
          </>
        );
        return openable ? (
          <Pressable
            key={notification.id}
            onPress={() => open(notification)}
            accessibilityRole="button"
            accessibilityLabel={`${notification.title}. ${notification.message}`}
            style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
          >
            {body}
          </Pressable>
        ) : (
          <View key={notification.id} style={styles.row} accessible>
            {body}
          </View>
        );
      })}

      {state.hiddenCount > 0 ? (
        <Text style={styles.more}>그 밖에 {state.hiddenCount}개 더 있어요</Text>
      ) : null}
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
    overflow: "hidden",
    ...appShadow,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing[4],
    paddingTop: spacing[4],
    paddingBottom: spacing[2],
    gap: spacing[2],
  },
  headerLabel: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[1],
    flexShrink: 1,
  },
  eyebrow: { fontSize: 12, fontWeight: "600", color: colors.rose[600], flexShrink: 1 },
  markAll: { fontSize: 12, color: colors.textTertiary },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  rowPressed: { backgroundColor: colors.ivory[100] },
  rowText: { flex: 1, gap: spacing[1] },
  rowTitleLine: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
    flexWrap: "wrap",
  },
  rowTitle: { fontSize: 14, fontWeight: "600", color: colors.noir[800], flexShrink: 1 },
  waitingPill: {
    fontSize: 11,
    fontWeight: "600",
    color: colors.rose[600],
    backgroundColor: colors.ivory[100],
    borderRadius: radius.lg,
    paddingHorizontal: spacing[2],
    paddingVertical: 2,
    overflow: "hidden",
  },
  rowMessage: { fontSize: 13, lineHeight: 20, color: colors.textSecondary },
  decisionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
    marginTop: spacing[2],
    flexWrap: "wrap",
  },
  acceptButton: {
    minHeight: 44,
    flexDirection: "row",
    gap: spacing[1],
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: spacing[4],
    borderRadius: radius.lg,
    // 웹 알림 패널의 "확인하고 반영" 버튼과 같은 색이다(#36534E). 같은 결정을
    // 두 화면이 다른 색으로 물으면 사용자는 다른 일로 읽는다.
    backgroundColor: colors.noir[800],
  },
  acceptLabel: { fontSize: 13, fontWeight: "600", color: colors.surface },
  rejectButton: {
    minHeight: 44,
    flexDirection: "row",
    gap: spacing[1],
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: spacing[4],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  rejectLabel: { fontSize: 13, fontWeight: "600", color: colors.rose[600] },
  buttonDim: { opacity: 0.6 },
  more: {
    paddingHorizontal: spacing[4],
    paddingBottom: spacing[4],
    paddingTop: spacing[2],
    fontSize: 12,
    color: colors.textTertiary,
  },
});
