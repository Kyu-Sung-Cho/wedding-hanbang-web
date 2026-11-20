import { useCallback, useRef, useState } from "react";
import { RefreshControl, StyleSheet, View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import {
  COMMON_STATE_COPY,
  CONSULTATION_STATE_COPY,
  STATUS_COPY,
  type InvitationConsultationResponse,
  type InvitationRouteKey,
} from "@hanbang/shared/invitation";
import { Text } from "@/components/ui/AppText";
import InvitationButton from "@/components/invitation/InvitationButton";
import InvitationConsultation from "@/components/invitation/InvitationConsultation";
import InvitationStateScreen from "@/components/invitation/InvitationStateScreen";
import { lineHeight, palette, typo } from "@/components/invitation/invitationStyle";
import { useLiveOwner } from "@/lib/invitationLive";
import { navigateInvitationRoute } from "@/lib/invitationRoutes.mjs";
import { createReadGate } from "@/lib/readGate.mjs";

type ConsultationState =
  | { status: "loading" }
  | { status: "failed"; message: string | null }
  | { status: "ready"; value: InvitationConsultationResponse };

/** 앱의 전체 일정 화면(`app/schedule/index.tsx`, 그대로 둔다). */
const FULL_SCHEDULE = "/schedule";

/**
 * 답장과 상담 확정(`Status.dc`, 2026-11-17 파운더 디자인 아티팩트)의 실제 커플 화면.
 * 일정 탭(`from="tabs"`)과 웨딩홀 스택의 상담 화면(`from="stack"`)이 같이 쓴다.
 *
 * - 모델은 `GET /api/invitation/consultation`. 확정된 상담이 없으면 `CONSULTATION_STATE_COPY.none`.
 * - 상담을 일정에 넣는 것은 커플이 누를 때만이다(`POST /api/invitation/consultation/schedule`). 아모라가
 *   알아서 일정을 바꾸지 않는다. 이미 일정에 있으면 같은 단추가 전체 일정을 연다.
 * - 아래에 전체 일정으로 가는 길을 늘 둔다(`CONSULTATION_STATE_COPY.fullSchedule`).
 * - 읽기는 화면에 올 때 한 번(처음 열 때도 한 번)과 당겨서 새로 고칠 때만 한다. "일정에 넣기"와 엇갈린 읽기는
 *   버리고 넣기가 끝난 뒤 다시 읽는다(`readGate.mjs`). 옛 읽기가 "일정에 넣기" 단추를 되살리지 않게 한다.
 * - 상대와 공유하기와 다른 홀이 제안한 시간에 답하기("이 시간으로 요청"·"다른 시간 묻기")는 아직 그 일을 할
 *   API 가 없다. 눌러도 아무 일이 없는 단추를 그리지 않으려고 실제 커플 화면에서는 빼고 그린다.
 */
export default function LiveConsultation({ from }: { from: "tabs" | "stack" }) {
  const liveOwner = useLiveOwner();
  const [state, setState] = useState<ConsultationState>({ status: "loading" });
  const [refreshing, setRefreshing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [justAdded, setJustAdded] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const withTabBar = from === "tabs";
  const gateRef = useRef(createReadGate());

  const navigate = useCallback((route: InvitationRouteKey) => {
    navigateInvitationRoute(router, route, from);
  }, [from]);
  const goBack = useCallback(() => {
    if (from === "stack" && router.canGoBack()) router.back();
    else navigate("home");
  }, [from, navigate]);
  const openFullSchedule = useCallback(() => {
    router.push(FULL_SCHEDULE);
  }, []);

  const load = useCallback(async () => {
    if (liveOwner.status !== "ready") return;
    for (;;) {
      const ticket = gateRef.current.beginRead();
      // "일정에 넣기"를 기다리는 중이다. 끝나면 다시 읽는다(`addToSchedule`).
      if (!ticket) return;
      const result = await liveOwner.api.consultation();
      const verdict = gateRef.current.endRead(ticket);
      if (verdict === "reread") continue;
      if (verdict === "drop") return;
      setRefreshing(false);
      if (!result.ok) {
        setState((current) => (current.status === "ready" ? current : { status: "failed", message: result.message }));
        return;
      }
      setState({ status: "ready", value: result.data });
      return;
    }
  }, [liveOwner]);

  // 업체 답장은 운영 담당자가 적는다. 화면에 돌아올 때마다(처음 열 때도 한 번) 다시 읽는다.
  useFocusEffect(useCallback(() => {
    void load();
  }, [load]));

  const refresh = useCallback(() => {
    setRefreshing(true);
    void load();
  }, [load]);

  const addToSchedule = useCallback(async () => {
    if (liveOwner.status !== "ready" || state.status !== "ready" || adding) return;
    const replyId = state.value.replyId;
    if (!replyId) return;
    setAdding(true);
    setNotice(null);
    gateRef.current.beginWrite();
    const result = await liveOwner.api.addConsultationToSchedule(replyId);
    const readNow = gateRef.current.endWrite();
    setAdding(false);
    if (!result.ok) {
      setNotice(result.message ?? COMMON_STATE_COPY.saveFailed);
    } else {
      setJustAdded(result.data.added);
      setState((current) => (current.status === "ready" ? { status: "ready", value: { ...current.value, inCalendar: true } } : current));
    }
    // 넣기를 기다리느라 미룬 읽기(화면 복귀·새로 고침)를 이제 한다.
    if (readNow) void load();
  }, [liveOwner, state, adding, load]);

  const scheduleLink = (
    <InvitationButton
      label={CONSULTATION_STATE_COPY.fullSchedule}
      onPress={openFullSchedule}
      variant="outline"
      height={46}
      paddingHorizontal={22}
      fontSize={14}
    />
  );

  if (state.status === "loading") return <InvitationStateScreen busy withTabBar={withTabBar} />;
  if (state.status === "failed") {
    return (
      <InvitationStateScreen
        title={state.message ?? CONSULTATION_STATE_COPY.loadFailed}
        back={{ label: STATUS_COPY.back, onPress: goBack }}
        actions={[{ label: CONSULTATION_STATE_COPY.fullSchedule, onPress: openFullSchedule, tone: "outline" }]}
        withTabBar={withTabBar}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
      />
    );
  }
  const { consultation, inCalendar } = state.value;
  if (!consultation) {
    return (
      <InvitationStateScreen
        title={CONSULTATION_STATE_COPY.none}
        sub={CONSULTATION_STATE_COPY.noneSub}
        back={{ label: STATUS_COPY.back, onPress: goBack }}
        actions={[{ label: CONSULTATION_STATE_COPY.fullSchedule, onPress: openFullSchedule, tone: "outline" }]}
        withTabBar={withTabBar}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
      />
    );
  }

  const calendarLabel = inCalendar
    ? justAdded ? CONSULTATION_STATE_COPY.added : STATUS_COPY.inCalendar
    : CONSULTATION_STATE_COPY.addToCalendar;
  return (
    <InvitationConsultation
      model={{ ...consultation, partnerName: null, updateActions: [] }}
      onNavigate={navigate}
      onBack={goBack}
      calendarLabel={calendarLabel}
      onOpenCalendar={inCalendar ? openFullSchedule : adding ? undefined : () => void addToSchedule()}
      withTabBar={withTabBar}
      footer={
        <View style={styles.footer}>
          {notice ? <Text accessibilityLiveRegion="polite" style={[typo.sans, styles.notice]}>{notice}</Text> : null}
          {scheduleLink}
        </View>
      }
    />
  );
}

const styles = StyleSheet.create({
  footer: { alignItems: "flex-start", gap: 10 },
  notice: { fontSize: 13, lineHeight: lineHeight(13, 1.6), color: palette.body },
});
