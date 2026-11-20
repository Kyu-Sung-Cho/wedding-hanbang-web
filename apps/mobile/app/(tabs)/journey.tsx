// 준비 순서 탭(2026-11-17 파운더 디자인 아티팩트 `Journey.dc`, 원문: 이 디자인 완전 같아야해).
//
// 모델은 `GET /api/invitation/journey` 가 저장된 사실(조건 셋, 상대 합류, 정한 식장)로 만든다. 빼기·다시
// 넣기·넣기는 사람이 누를 때마다 `PATCH /api/invitation/journey-plan` 으로 함께 쓰는 계획에 저장한다
// (상대에게 알림이 간다). 저장을 기다리지 않고 바로 그리고, 실패하면 서버가 마지막으로 확인해 준 계획으로
// 되돌린 뒤 사실대로 알린다. 읽기는 탭에 올 때 한 번(처음 열 때도 한 번)과 당겨서 새로 고칠 때만 하고, 저장과
// 엇갈린 읽기는 버린 뒤 저장이 끝나면 다시 읽는다(`readGate.mjs`).
import { useCallback, useRef, useState } from "react";
import { RefreshControl } from "react-native";
import { router, useFocusEffect } from "expo-router";
import {
  JOURNEY_COPY,
  JOURNEY_STATE_COPY,
  type InvitationJourneyResponse,
  type InvitationRouteKey,
} from "@hanbang/shared/invitation";
import InvitationJourney from "@/components/invitation/InvitationJourney";
import InvitationStateScreen from "@/components/invitation/InvitationStateScreen";
import { journeyWithPlan, toggledJourneyPlan } from "@/lib/invitationApi.mjs";
import { useLiveOwner } from "@/lib/invitationLive";
import { navigateInvitationRoute } from "@/lib/invitationRoutes.mjs";
import { createReadGate } from "@/lib/readGate.mjs";

type JourneyState =
  | { status: "loading" }
  | { status: "failed"; message: string | null }
  | { status: "ready"; value: InvitationJourneyResponse };

export default function JourneyTab() {
  const liveOwner = useLiveOwner();
  const [state, setState] = useState<JourneyState>({ status: "loading" });
  const [refreshing, setRefreshing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  // 서버가 마지막으로 확인해 준 계획. 저장이 실패하면 여기로 되돌린다.
  const confirmedRef = useRef<InvitationJourneyResponse | null>(null);
  // 저장 요청의 차례. 늦게 도착한 앞 요청의 답이 뒤 요청의 화면(과 되돌릴 자리)을 덮지 않게 한다.
  const saveSequenceRef = useRef(0);
  const confirmedSequenceRef = useRef(0);
  // 저장과 엇갈린 읽기가 사람이 방금 누른 것을 옛 값으로 덮지 않게 한다. 쓰기 앞에 출발해 쓰기 뒤에 도착한 읽기도 버린다.
  const gateRef = useRef(createReadGate());

  const navigate = useCallback((route: InvitationRouteKey) => {
    navigateInvitationRoute(router, route, "tabs");
  }, []);

  const load = useCallback(async () => {
    if (liveOwner.status !== "ready") return;
    for (;;) {
      const ticket = gateRef.current.beginRead();
      // 저장을 기다리는 중이다. 저장이 모두 끝나면 다시 읽는다(`save`).
      if (!ticket) return;
      const result = await liveOwner.api.journey();
      const verdict = gateRef.current.endRead(ticket);
      if (verdict === "reread") continue;
      if (verdict === "drop") return;
      setRefreshing(false);
      if (!result.ok) {
        setState((current) => (current.status === "ready" ? current : { status: "failed", message: result.message }));
        return;
      }
      confirmedRef.current = result.data;
      setState({ status: "ready", value: result.data });
      return;
    }
  }, [liveOwner]);

  // 탭으로 돌아올 때마다(처음 열 때도 한 번) 다시 읽는다. 조건·합류·담은 홀이 다른 화면에서 바뀐다.
  useFocusEffect(useCallback(() => {
    void load();
  }, [load]));

  const save = useCallback(async (kind: "stage" | "addOn", key: string) => {
    if (liveOwner.status !== "ready" || state.status !== "ready") return;
    const plan = toggledJourneyPlan(state.value.plan, kind, key);
    setNotice(null);
    setState({ status: "ready", value: { journey: journeyWithPlan(state.value.journey, plan), plan: plan as InvitationJourneyResponse["plan"] } });
    const sequence = ++saveSequenceRef.current;
    gateRef.current.beginWrite();
    const result = await liveOwner.api.saveJourneyPlan(plan);
    const readNow = gateRef.current.endWrite();
    if (result.ok) {
      if (sequence > confirmedSequenceRef.current) {
        confirmedSequenceRef.current = sequence;
        confirmedRef.current = result.data;
      }
      if (sequence === saveSequenceRef.current) setState({ status: "ready", value: result.data });
    } else if (sequence === saveSequenceRef.current) {
      const confirmed = confirmedRef.current;
      if (confirmed) setState({ status: "ready", value: confirmed });
      setNotice(result.message ?? JOURNEY_STATE_COPY.saveFailed);
    }
    // 저장을 기다리느라 미룬 읽기(탭 복귀·새로 고침)를 이제 한다.
    if (readNow) void load();
  }, [liveOwner, state, load]);

  const retry = useCallback(() => {
    setRefreshing(true);
    void load();
  }, [load]);

  if (state.status === "loading") return <InvitationStateScreen busy withTabBar />;
  if (state.status === "failed") {
    return (
      <InvitationStateScreen
        title={state.message ?? JOURNEY_STATE_COPY.loadFailed}
        back={{ label: JOURNEY_COPY.back, onPress: () => navigate("home") }}
        withTabBar
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={retry} />}
      />
    );
  }

  return (
    <InvitationJourney
      model={state.value.journey}
      onBack={() => navigate("home")}
      onNavigate={navigate}
      onToggleStage={(key) => {
        void save("stage", key);
      }}
      onToggleAddOn={(key) => {
        void save("addOn", key);
      }}
      onConfirm={() => navigate("home")}
      withTabBar
      notice={notice}
    />
  );
}
