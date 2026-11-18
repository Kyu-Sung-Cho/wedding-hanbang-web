// 웨딩홀 비교(2026-11-17 파운더 디자인 아티팩트 `Compare.dc`, 원문: 이 디자인 완전 같아야해) — 로그인한 커플.
//
// 모델은 `GET /api/invitation/halls?sort=` 가 운영 담당자가 출처와 확인일을 적어 넣은 홀만으로 만든다.
// 운영에서는 아직 그런 홀이 없어 빈 화면(`COMPARE_STATE_COPY`)이 실제로 보이는 화면이다.
// 하트(상담 후보 담기)는 누르는 대로 `POST/DELETE /api/invitation/halls/{id}/shortlist` 로 저장한다. 담는 것은
// 커플 안의 선호일 뿐 업체로는 아무것도 나가지 않는다. 바로 그리고, 실패하면 되돌린 뒤 사실대로 알린다.
// 읽기는 화면에 올 때 한 번과 정렬을 바꿀 때만 한다. 하트 저장과 엇갈린 읽기는 버리고 저장이 끝난 뒤 다시 읽는다
// (`readGate.mjs`). 다른 정렬을 받지 못하면 칩을 보이는 카드의 정렬로 되돌리고 그렇다고 말한다.
import { useCallback, useRef, useState } from "react";
import { router, useFocusEffect } from "expo-router";
import {
  COMMON_STATE_COPY,
  COMPARE_COPY,
  COMPARE_STATE_COPY,
  type CompareSortId,
  type InvitationHallsResponse,
  type InvitationRouteKey,
} from "@hanbang/shared/invitation";
import InvitationCompare from "@/components/invitation/InvitationCompare";
import InvitationStateScreen from "@/components/invitation/InvitationStateScreen";
import { useLiveOwner } from "@/lib/invitationLive";
import { navigateInvitationRoute } from "@/lib/invitationRoutes.mjs";
import { createReadGate } from "@/lib/readGate.mjs";

type HallsState =
  | { status: "loading" }
  | { status: "failed" }
  | { status: "ready"; value: InvitationHallsResponse };

/** 홈 탭의 첫 대화(조건 묻기)를 다시 여는 주소. 이번 실행에서 닫았어도 다시 묻는다(`app/(tabs)/lounge.tsx`). */
const ASK_CONDITIONS_HREF = "/(tabs)/lounge?conditions=1";

function withPicked(value: InvitationHallsResponse, hallId: string, picked: boolean): InvitationHallsResponse {
  if (!value.compare) return value;
  return {
    ...value,
    compare: { ...value.compare, halls: value.compare.halls.map((hall) => (hall.id === hallId ? { ...hall, picked } : hall)) },
  };
}

export default function HallsScreen() {
  const liveOwner = useLiveOwner();
  const [state, setState] = useState<HallsState>({ status: "loading" });
  // 사람이 누른 정렬. 그 정렬의 카드가 오기 전까지 칩만 먼저 옮긴다. 받지 못하면 null(보이는 카드의 정렬).
  const [requestedSort, setRequestedSort] = useState<CompareSortId | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // 담기·빼기를 기다리는 홀. 같은 하트를 두 번 눌러 요청이 엇갈리지 않게 한다.
  const pendingRef = useRef(new Set<string>());
  // 하트 저장과 엇갈린 읽기가 방금 담은 하트를 덮지 않게 한다.
  const gateRef = useRef(createReadGate());
  // 다음 읽기가 가져올 정렬(마지막으로 누른 정렬)과 지금 카드의 정렬(아직 없으면 null).
  const wantedSortRef = useRef<CompareSortId>("total");
  const shownSortRef = useRef<CompareSortId | null>(null);

  const navigate = useCallback((route: InvitationRouteKey) => {
    navigateInvitationRoute(router, route, "stack");
  }, []);
  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else navigate("home");
  }, [navigate]);

  const load = useCallback(async () => {
    if (liveOwner.status !== "ready") return;
    for (;;) {
      const ticket = gateRef.current.beginRead();
      // 하트를 기다리는 중이다. 저장이 모두 끝나면 다시 읽는다(`togglePick`).
      if (!ticket) return;
      const sort = wantedSortRef.current;
      const result = await liveOwner.api.halls(sort);
      const verdict = gateRef.current.endRead(ticket);
      if (verdict === "reread") continue;
      if (verdict === "drop") return;
      if (!result.ok) {
        if (shownSortRef.current === null) {
          setState({ status: "failed" });
          return;
        }
        // 다른 정렬을 받지 못했다. 칩을 보이는 카드의 정렬로 되돌리고 그렇다고 말한다.
        if (sort !== shownSortRef.current) {
          wantedSortRef.current = shownSortRef.current;
          setRequestedSort(null);
          setNotice(COMPARE_STATE_COPY.loadFailed);
        }
        return;
      }
      shownSortRef.current = result.data.sort;
      wantedSortRef.current = result.data.sort;
      setRequestedSort(null);
      setState({ status: "ready", value: result.data });
      return;
    }
  }, [liveOwner]);

  // 화면에 올 때마다 한 번 읽는다(처음 열 때도 한 번). 편지에서 돌아오면 담은 곳과 상담 상태가 바뀌어 있을 수 있다.
  useFocusEffect(useCallback(() => {
    void load();
  }, [load]));

  const changeSort = useCallback((next: CompareSortId) => {
    if (next === wantedSortRef.current) return;
    wantedSortRef.current = next;
    setRequestedSort(next);
    setNotice(null);
    void load();
  }, [load]);

  const togglePick = useCallback(async (hallId: string) => {
    if (liveOwner.status !== "ready" || state.status !== "ready" || pendingRef.current.has(hallId)) return;
    const hall = state.value.compare?.halls.find((item) => item.id === hallId);
    if (!hall) return;
    const picked = !hall.picked;
    pendingRef.current.add(hallId);
    gateRef.current.beginWrite();
    setNotice(null);
    setState((current) => (current.status === "ready" ? { status: "ready", value: withPicked(current.value, hallId, picked) } : current));
    const result = await liveOwner.api.setHallPicked(hallId, picked);
    pendingRef.current.delete(hallId);
    const readNow = gateRef.current.endWrite();
    if (!result.ok) {
      setState((current) => (current.status === "ready" ? { status: "ready", value: withPicked(current.value, hallId, hall.picked) } : current));
      setNotice(result.message ?? COMMON_STATE_COPY.saveFailed);
    } else {
      setState((current) => (current.status === "ready"
        ? { status: "ready", value: { ...withPicked(current.value, hallId, result.data.picked), pickedCount: result.data.pickedCount } }
        : current));
    }
    // 하트를 기다리느라 미룬 읽기(화면 복귀·정렬 바꾸기)를 이제 한다.
    if (readNow) void load();
  }, [liveOwner, state, load]);

  const back = { label: COMPARE_COPY.back, onPress: goBack };
  if (state.status === "loading") return <InvitationStateScreen busy back={back} />;
  if (state.status === "failed") return <InvitationStateScreen title={COMPARE_STATE_COPY.loadFailed} back={back} />;

  const { compare } = state.value;
  if (!compare) {
    return (
      <InvitationStateScreen
        title={COMPARE_STATE_COPY.needConditions}
        back={back}
        actions={[{ label: COMPARE_STATE_COPY.needConditionsAction, onPress: () => router.dismissTo(ASK_CONDITIONS_HREF) }]}
      />
    );
  }
  if (compare.halls.length === 0) {
    return <InvitationStateScreen title={COMPARE_STATE_COPY.noHalls} sub={COMPARE_STATE_COPY.noHallsSub} back={back} />;
  }

  const pickedCount = compare.halls.filter((hall) => hall.picked).length;
  return (
    <InvitationCompare
      model={compare}
      sort={requestedSort ?? state.value.sort}
      onSortChange={changeSort}
      onTogglePick={(hallId) => {
        void togglePick(hallId);
      }}
      onBack={goBack}
      onNavigate={navigate}
      notice={notice ?? (pickedCount === 0 ? COMPARE_STATE_COPY.pickFirst : null)}
    />
  );
}
