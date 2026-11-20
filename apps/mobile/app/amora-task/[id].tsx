// 아모라가 맡은 일 하나의 결과 화면(D-84, 25장 갈래 4). 홈의 「아모라가 맡은 일」 줄과 대화 카드의 「진행 보기」가 연다.
//
// - 결과 표의 값은 서버가 저장한 글 그대로다. 여기서 순위나 점수를 만들지 않는다(계약 I14). 폰 폭에 맞게 줄마다
//   카드 한 장으로 쌓는다(칸 이름과 값).
// - 출처 링크는 공유 계약이 https 로 확인한 주소만 연다(`safeAmoraTaskSourceUrl`). 그 밖은 글자로만 둔다.
// - 「다음에 할 일」은 대화 입력칸에 글을 넣어 둘 뿐 보내지 않는다. 라운지 「아모라에게 묻기」와 같은 문이다
//   (`@/lib/loungeAmoraAsk`: 주소에는 번호만 싣고 글은 앱 안에서 한 번 건넨다). 반영은 대화의 확인 카드를 사람이 누를 때만 일어난다.
// - 그만하기·이어서 하기는 사람이 누를 때만 보낸다. 누른 뒤에는 다시 읽어 지금 상태를 그린다.
// - 찾는 중·정리 중인 동안에만 15초마다 다시 읽는다. 스위치가 꺼졌으면 이 기능의 글을 하나도 그리지 않는다(뒤로 가기만 남는다).
import { useCallback, useEffect, useRef, useState } from "react";
import { Linking, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useFocusEffect, useLocalSearchParams, type Href } from "expo-router";
import {
  AMORA_TASK_COPY,
  AMORA_TASK_STAGE_LABELS,
  safeAmoraTaskSourceUrl,
  type AmoraTaskDetail,
  type AmoraTaskResult,
  type AmoraTaskResultSource,
} from "@hanbang/shared/amora-tasks";
import { Text } from "@/components/ui/AppText";
import { AppHeader, LoadingState } from "@/components/ui/AppUI";
import InvitationButton from "@/components/invitation/InvitationButton";
import { hitSlopFor, lineHeight, palette, paragraph17, typo } from "@/components/invitation/invitationStyle";
import { apiFetchForExpectedUser, apiFetchForExpectedUserQuiet } from "@/lib/api";
import { useLiveOwner } from "@/lib/invitationLive";
import { buildLoungeAmoraAskHref, stageLoungeAmoraAskText } from "@/lib/loungeAmoraAsk";
import { createReadGate } from "@/lib/readGate.mjs";
import {
  AMORA_TASK_DETAIL_POLL_MS,
  amoraTaskStartFailureCopyKey,
  fetchAmoraTaskDetail,
  isAmoraTaskWorking,
  postAmoraTaskAction,
} from "@/lib/amoraTasks.mjs";

type ScreenState =
  | { status: "loading" }
  | { status: "off" }
  | { status: "failed" }
  | { status: "ready"; detail: AmoraTaskDetail };

type ManualAction = "cancel" | "resume";
type ActionResult = Awaited<ReturnType<typeof postAmoraTaskAction>>;

// 그만하기가 안 됐을 때(D-12 승인 대기, 웹과 같은 문장).
const CANCEL_FAILED = AMORA_TASK_COPY.actionFailed;

/** 뒤로 갈 곳이 없으면(알림으로 바로 열었다) 라운지로 간다. 내 정보·커뮤니티와 같다. */
const leave = () => (router.canGoBack() ? router.back() : router.replace("/(tabs)/lounge"));

/** 누른 뒤에 보일 한 줄. 그새 상태가 바뀐 것이면(이미 끝났거나 이어서 할 수 없다) 다시 읽은 화면이 말하므로 없다. */
function actionNotice(action: ManualAction, result: ActionResult): string | null {
  if (result.ok || result.off) return null;
  if (result.code === "closed" || result.code === "not_resumable") return null;
  if (action === "resume") return AMORA_TASK_COPY[amoraTaskStartFailureCopyKey(result.code)];
  return CANCEL_FAILED;
}

/** 단계가 없는 상태(그만둔 일, 닫힌 카드)를 한 줄로. */
function closedLine(detail: AmoraTaskDetail): string | null {
  if (detail.status === "cancelled") return AMORA_TASK_COPY.cancelled;
  if (detail.status === "expired") return AMORA_TASK_COPY.offerExpired;
  return null;
}

export default function AmoraTaskScreen() {
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const taskId = Array.isArray(params.id) ? params.id[0] : params.id;
  const liveOwner = useLiveOwner();
  const ownerId = liveOwner.status === "ready" ? liveOwner.ownerId : null;
  const [state, setState] = useState<ScreenState>({ status: "loading" });
  const [pending, setPending] = useState<ManualAction | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // 누르기와 엇갈린 읽기가 누른 뒤의 상태를 덮지 않게 한다(웨딩홀 비교와 같은 문).
  const gateRef = useRef(createReadGate());
  const workingRef = useRef(false);
  const actingRef = useRef(false);
  const ownerRef = useRef<string | null>(null);
  ownerRef.current = ownerId;

  // 다른 사람으로 바뀌었으면 앞사람의 화면을 그대로 두지 않는다.
  useEffect(() => {
    setState({ status: "loading" });
    setNotice(null);
  }, [ownerId]);

  const load = useCallback(async () => {
    if (!ownerId || !taskId) return;
    for (;;) {
      const ticket = gateRef.current.beginRead();
      // 누른 것을 기다리는 중이다. 끝나면 `act` 가 다시 읽는다.
      if (!ticket) return;
      const read = await fetchAmoraTaskDetail(
        (path, init) => apiFetchForExpectedUserQuiet(ownerId, path, init),
        taskId,
      );
      const verdict = gateRef.current.endRead(ticket);
      if (verdict === "reread") continue;
      if (verdict === "drop" || ownerRef.current !== ownerId) return;
      if (read.kind === "ready") {
        workingRef.current = isAmoraTaskWorking(read.detail.stage);
        setState({ status: "ready", detail: read.detail });
      } else if (read.kind === "off") {
        workingRef.current = false;
        setState({ status: "off" });
      } else if (read.kind === "not_found") {
        workingRef.current = false;
        setState({ status: "failed" });
      } else {
        // 다시 읽다 못 읽었으면 보던 화면을 그대로 둔다.
        setState((current) => (current.status === "ready" ? current : { status: "failed" }));
      }
      return;
    }
  }, [ownerId, taskId]);

  useFocusEffect(
    useCallback(() => {
      void load();
      const timer = setInterval(() => {
        if (workingRef.current) void load();
      }, AMORA_TASK_DETAIL_POLL_MS);
      return () => clearInterval(timer);
    }, [load]),
  );

  const act = useCallback(async (action: ManualAction) => {
    if (!ownerId || !taskId || actingRef.current) return;
    actingRef.current = true;
    setPending(action);
    setNotice(null);
    gateRef.current.beginWrite();
    // 사람이 누른 쓰기다. 세션이 끝났으면 다른 화면처럼 다시 로그인하게 한다(조용한 조회와 다르다).
    const result = await postAmoraTaskAction(
      (path, init) => apiFetchForExpectedUser(ownerId, path, init),
      taskId,
      action,
    );
    gateRef.current.endWrite();
    if (ownerRef.current === ownerId) {
      setNotice(actionNotice(action, result));
      await load();
    }
    actingRef.current = false;
    setPending(null);
  }, [ownerId, taskId, load]);

  // 「다음에 할 일」: 대화 입력칸에 글을 넣어 둘 뿐 보내지 않는다(라운지 「아모라에게 묻기」와 같은 문).
  const continueInChat = useCallback((prompt: string) => {
    if (!ownerId) return;
    const askId = stageLoungeAmoraAskText({ ownerId, text: prompt });
    if (askId === null) return;
    // 이 화면은 루트 Stack 화면이라 push 는 (tabs) 를 한 벌 더 쌓는다. 아래에 있는 기존 대화 탭으로 돌아간다.
    router.dismissTo(buildLoungeAmoraAskHref(askId) as Href);
  }, [ownerId]);

  const view: ScreenState = liveOwner.status === "guest" || !taskId ? { status: "failed" } : state;

  if (view.status === "off" || view.status === "loading") {
    return (
      <SafeAreaView style={styles.root} edges={["top"]}>
        <AppHeader title="" onBack={leave} />
        {view.status === "loading" ? <LoadingState /> : null}
      </SafeAreaView>
    );
  }

  if (view.status === "failed") {
    return (
      <SafeAreaView style={styles.root} edges={["top"]}>
        <AppHeader title={AMORA_TASK_COPY.homeTitle} onBack={leave} />
        <View style={styles.failed}>
          <Text accessibilityLiveRegion="polite" style={[paragraph17, styles.center]}>
            {AMORA_TASK_COPY.loadFailed}
          </Text>
          <View style={styles.actions}>
            {ownerId && taskId ? (
              <InvitationButton
                label={AMORA_TASK_COPY.retry}
                onPress={() => {
                  setState({ status: "loading" });
                  void load();
                }}
                variant="ink"
                height={46}
                paddingHorizontal={22}
                fontSize={14}
                weight="700"
              />
            ) : null}
            <InvitationButton
              label={AMORA_TASK_COPY.back}
              onPress={leave}
              variant="outline"
              height={46}
              paddingHorizontal={22}
              fontSize={14}
            />
          </View>
        </View>
      </SafeAreaView>
    );
  }

  const { detail } = view;
  const stageLabel = detail.stage ? AMORA_TASK_STAGE_LABELS[detail.stage] : null;
  const reviewLine = detail.status === "needs_review" && detail.reviewReason
    ? AMORA_TASK_COPY.reviewReasons[detail.reviewReason]
    : null;
  const statusLine = closedLine(detail);
  const busy = pending !== null;

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <AppHeader title={AMORA_TASK_COPY.homeTitle} onBack={leave} />
      <ScrollView style={styles.flex} contentContainerStyle={styles.body}>
        <View style={styles.top}>
          {stageLabel ? (
            <View style={[styles.stage, detail.stage === "needs_review" && styles.stageAttention]}>
              <Text style={[typo.sans, styles.stageText]}>{stageLabel}</Text>
            </View>
          ) : null}
          <Text accessibilityRole="header" style={[typo.serifBold, styles.title]}>
            {detail.title}
          </Text>
          {reviewLine ? <Text style={paragraph17}>{reviewLine}</Text> : null}
          {statusLine ? <Text style={paragraph17}>{statusLine}</Text> : null}
          {notice ? (
            <Text accessibilityLiveRegion="polite" style={[typo.sans, styles.notice]}>
              {notice}
            </Text>
          ) : null}
          {detail.resumable || detail.cancellable ? (
            <View style={styles.actions}>
              {detail.resumable ? (
                <InvitationButton
                  label={AMORA_TASK_COPY.resume}
                  onPress={() => void act("resume")}
                  variant="ink"
                  height={46}
                  paddingHorizontal={22}
                  fontSize={14}
                  weight="700"
                  disabled={busy}
                  style={busy ? styles.busy : undefined}
                />
              ) : null}
              {detail.cancellable ? (
                <InvitationButton
                  label={AMORA_TASK_COPY.cancel}
                  onPress={() => void act("cancel")}
                  variant="outline"
                  height={46}
                  paddingHorizontal={22}
                  fontSize={14}
                  disabled={busy}
                  style={busy ? styles.busy : undefined}
                />
              ) : null}
            </View>
          ) : null}
        </View>

        {detail.steps.length > 0 ? (
          <View style={styles.section}>
            <Text accessibilityRole="header" style={[typo.serifBold, styles.sectionTitle]}>
              {AMORA_TASK_COPY.stepsTitle}
            </Text>
            <View style={styles.steps}>
              {detail.steps.map((step, index) => (
                <View key={`${step.at}:${index}`} style={styles.step}>
                  <Text style={[typo.sans, styles.stepText, styles.stepMarker]}>{`${index + 1}.`}</Text>
                  <Text style={[typo.sans, styles.stepText, styles.stepBody]}>{step.label}</Text>
                </View>
              ))}
            </View>
          </View>
        ) : null}

        {detail.result ? <ResultSections result={detail.result} onContinue={continueInChat} /> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function ResultSections({ result, onContinue }: { result: AmoraTaskResult; onContinue: (prompt: string) => void }) {
  return (
    <>
      {result.summary ? <Text style={paragraph17}>{result.summary}</Text> : null}

      {result.rows.length > 0 ? (
        <View style={styles.section}>
          <Text accessibilityRole="header" style={[typo.serifBold, styles.sectionTitle]}>
            {AMORA_TASK_COPY.resultTableTitle}
          </Text>
          {result.rows.map((row, rowIndex) => (
            <View key={`row-${rowIndex}`} style={styles.rowCard}>
              {result.columns.map((column, columnIndex) => {
                const cell = row.cells[columnIndex];
                // 빈 칸은 그리지 않는다. 값은 서버가 저장한 글 그대로다(가격을 모르면 서버가 "업체 확인 필요"를 적는다).
                if (!cell) return null;
                return (
                  <View key={`cell-${rowIndex}-${columnIndex}`} style={styles.cell}>
                    <Text style={[typo.sans, styles.cellLabel]}>{column}</Text>
                    <Text style={[columnIndex === 0 ? typo.sansBold : typo.sans, styles.cellValue]}>{cell}</Text>
                  </View>
                );
              })}
            </View>
          ))}
          <Text style={[typo.sans, styles.note]}>{AMORA_TASK_COPY.resultTableNote}</Text>
        </View>
      ) : null}

      {result.sources.length > 0 ? (
        <View style={styles.section}>
          <Text accessibilityRole="header" style={[typo.serifBold, styles.sectionTitle]}>
            {AMORA_TASK_COPY.resultSourcesTitle}
          </Text>
          {result.sources.map((source) => (
            <SourceLine key={source.id} source={source} />
          ))}
        </View>
      ) : null}

      {result.nextActions.length > 0 ? (
        <View style={styles.section}>
          <Text accessibilityRole="header" style={[typo.serifBold, styles.sectionTitle]}>
            {AMORA_TASK_COPY.resultNextTitle}
          </Text>
          <Text style={[typo.sans, styles.note]}>{AMORA_TASK_COPY.resultNextNote}</Text>
          {result.nextActions.map((action, index) => (
            <View key={`next-${index}`} style={styles.nextLine}>
              <Text style={[typo.sansMedium, styles.nextLabel]}>{action.label}</Text>
              <InvitationButton
                label={AMORA_TASK_COPY.resultNextButton}
                onPress={() => onContinue(action.prompt)}
                accessibilityLabel={`${action.label}, ${AMORA_TASK_COPY.resultNextButton}`}
                variant="outline"
                height={40}
                paddingHorizontal={16}
                fontSize={13}
                style={styles.nextButton}
              />
            </View>
          ))}
        </View>
      ) : null}
    </>
  );
}

function SourceLine({ source }: { source: AmoraTaskResultSource }) {
  // 공유 계약이 https 로 확인한 주소만 연다. 그 밖은 글자로만 둔다. 여는 앞에서 따로 묻지 않는다.
  const url = safeAmoraTaskSourceUrl(source.url);
  const checked = source.checkedOn ? AMORA_TASK_COPY.resultCheckedOn(source.checkedOn) : null;
  return (
    <View style={styles.source}>
      {url ? (
        <Pressable
          onPress={() => {
            // 열지 못해도(브라우저가 없는 기기) 화면은 그대로 둔다. 알릴 문장이 계약에 없다.
            void Linking.openURL(url).catch(() => undefined);
          }}
          accessibilityRole="link"
          hitSlop={hitSlopFor(22)}
          style={styles.sourceLink}
        >
          {({ pressed }) => (
            <Text style={[typo.sans, styles.sourceTitle, styles.link, pressed && styles.pressed]}>{source.title}</Text>
          )}
        </Pressable>
      ) : (
        <Text style={[typo.sans, styles.sourceTitle]}>{source.title}</Text>
      )}
      {checked ? <Text style={[typo.sans, styles.sourceChecked]}>{checked}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.white },
  flex: { flex: 1 },
  body: { gap: 28, paddingTop: 22, paddingHorizontal: 22, paddingBottom: 40 },
  top: { gap: 12 },
  stage: {
    alignSelf: "flex-start",
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 999,
    backgroundColor: palette.stone,
  },
  stageAttention: { backgroundColor: palette.blush },
  stageText: { fontSize: 12 },
  title: { fontSize: 22, lineHeight: lineHeight(22, 1.4) },
  notice: { fontSize: 14, lineHeight: lineHeight(14, 1.55), color: palette.body },
  actions: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 },
  busy: { opacity: 0.5 },
  section: { gap: 10 },
  sectionTitle: { fontSize: 18 },
  steps: { paddingVertical: 14, paddingHorizontal: 16, backgroundColor: palette.paperSoft, borderRadius: 18, gap: 8 },
  step: { flexDirection: "row" },
  stepText: { fontSize: 14, lineHeight: lineHeight(14, 1.55), color: palette.body },
  stepMarker: { width: 20, marginRight: 4, textAlign: "right" },
  stepBody: { flex: 1 },
  rowCard: {
    gap: 8,
    padding: 16,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: palette.ring,
    backgroundColor: palette.white,
  },
  cell: { gap: 2 },
  cellLabel: { fontSize: 12, color: palette.muted },
  cellValue: { fontSize: 15, lineHeight: lineHeight(15, 1.5) },
  note: { fontSize: 13, lineHeight: lineHeight(13, 1.55), color: palette.muted },
  source: { gap: 2, paddingVertical: 6 },
  sourceLink: { alignSelf: "flex-start" },
  sourceTitle: { fontSize: 14, lineHeight: lineHeight(14, 1.5) },
  link: { textDecorationLine: "underline" },
  pressed: { color: palette.muted },
  sourceChecked: { fontSize: 12, color: palette.muted },
  nextLine: { gap: 8, paddingVertical: 12, borderTopWidth: 1, borderTopColor: palette.divider },
  nextLabel: { fontSize: 15, lineHeight: lineHeight(15, 1.45) },
  nextButton: { alignSelf: "flex-start" },
  failed: { flex: 1, alignItems: "center", justifyContent: "center", gap: 18, paddingHorizontal: 22 },
  center: { textAlign: "center" },
});
