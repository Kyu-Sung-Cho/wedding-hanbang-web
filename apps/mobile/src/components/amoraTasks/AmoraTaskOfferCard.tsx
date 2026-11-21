import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { router, type Href } from "expo-router";
import {
  AMORA_TASK_COPY,
  amoraTaskAppPath,
  parseAmoraTaskOffer,
  type AmoraTaskOffer,
} from "@hanbang/shared/amora-tasks";
import { Text } from "@/components/ui/AppText";
import InvitationButton from "@/components/invitation/InvitationButton";
import { lineHeight, palette, typo } from "@/components/invitation/invitationStyle";
import { apiFetchForExpectedUserQuiet } from "@/lib/api";
import { useLiveOwner } from "@/lib/invitationLive";
import { createReadGate } from "@/lib/readGate.mjs";
import {
  amoraTaskGateReply,
  amoraTaskOfferPhase,
  amoraTaskOfferPhaseCopyKey,
  amoraTaskStartOutcome,
  fetchAmoraTaskDetail,
  postAmoraTaskAction,
} from "@/lib/amoraTasks.mjs";

type Phase = ReturnType<typeof amoraTaskOfferPhase>;

/**
 * 대화의 「이 일을 맡을게요」 카드(`offer_amora_task` 도구 결과, D-84). 카드만 나온 상태에서는 아무것도 시작하지 않았다.
 * 사람이 「맡기기」를 눌러야 시작한다(`POST /api/amora/tasks/:id` `{ action: "start" }`).
 *
 * - 카드를 그릴 때 지금 상태를 한 번 읽는다. 이미 맡겼으면(두 사람 중 누가 먼저 눌렀을 수 있다) 「진행 보기」를,
 *   시간이 지났으면 닫힌 카드라고 보인다. 못 읽었으면 카드에 적힌 마감 시각만 본다.
 * - 이 카드는 대화를 막지 않는다. 401 에도 로그아웃 알림을 띄우지 않는 조회(`apiFetchForExpectedUserQuiet`)를 쓴다.
 * - 스위치가 꺼졌으면 아무것도 그리지 않는다. 글자는 전부 공유 계약의 문장이다. 하나 예외로, 문지기가 맡기기를 막으며
 *   준 문장은 `amoraTaskGateReply` 를 지나면 고치지 않고 그대로 보인다(문지기 담당 규칙).
 */
export default function AmoraTaskOfferCard({ toolOutput }: { toolOutput: unknown }) {
  const offer = useMemo(() => parseAmoraTaskOffer(toolOutput), [toolOutput]);
  if (!offer) return null;
  return <OfferCard key={offer.taskId} offer={offer} />;
}

function OfferCard({ offer }: { offer: AmoraTaskOffer }) {
  const { taskId, offerExpiresAt } = offer;
  const liveOwner = useLiveOwner();
  const ownerId = liveOwner.status === "ready" ? liveOwner.ownerId : null;
  const [phase, setPhase] = useState<Phase>(() =>
    amoraTaskOfferPhase({ offerExpiresAt }, { kind: "failed", status: 0 }, Date.now()),
  );
  const [retry, setRetry] = useState(false);
  const [starting, setStarting] = useState(false);
  // 문지기가 맡기기를 막으며 준 문장(`amoraTaskGateReply` 를 지난 것만). 맡을 수 없는 모습에서 계약 문장 대신 그대로 보인다.
  const [gateReply, setGateReply] = useState<string | null>(null);
  // 맡기기와 엇갈린 첫 읽기가 맡은 뒤의 모습을 덮지 않게 한다.
  const gateRef = useRef(createReadGate());
  const startingRef = useRef(false);
  const ownerRef = useRef<string | null>(null);
  ownerRef.current = ownerId;

  useEffect(() => {
    if (!ownerId) return undefined;
    let active = true;
    const ticket = gateRef.current.beginRead();
    if (!ticket) return undefined;
    void fetchAmoraTaskDetail((path, init) => apiFetchForExpectedUserQuiet(ownerId, path, init), taskId).then((read) => {
      if (!active || gateRef.current.endRead(ticket) !== "apply") return;
      // 새로 읽은 모습에는 앞서 맡기기에서 받은 문장이 남지 않는다(다른 계정으로 바뀌었을 수 있다).
      setGateReply(null);
      setPhase(amoraTaskOfferPhase({ offerExpiresAt }, read, Date.now()));
    });
    return () => {
      active = false;
    };
  }, [ownerId, taskId, offerExpiresAt]);

  const start = useCallback(async () => {
    if (!ownerId || startingRef.current) return;
    startingRef.current = true;
    setStarting(true);
    setRetry(false);
    gateRef.current.beginWrite();
    const result = await postAmoraTaskAction(
      (path, init) => apiFetchForExpectedUserQuiet(ownerId, path, init),
      taskId,
      "start",
    );
    gateRef.current.endWrite();
    startingRef.current = false;
    setStarting(false);
    if (ownerRef.current !== ownerId) return;
    const outcome = amoraTaskStartOutcome(result);
    setGateReply(amoraTaskGateReply(result));
    setPhase(outcome.phase);
    setRetry(outcome.retry);
  }, [ownerId, taskId]);

  const open = useCallback(() => {
    const path = amoraTaskAppPath(taskId);
    if (path) router.push(path as Href);
  }, [taskId]);

  if (phase === "off") return null;
  const lineKey = amoraTaskOfferPhaseCopyKey(phase);
  const canOpen = phase === "started" || phase === "cancelled";

  return (
    <View style={styles.card}>
      <Text style={[typo.sansMedium, styles.eyebrow]}>{AMORA_TASK_COPY.offerTitle}</Text>
      <Text style={[typo.serifBold, styles.title]}>{offer.title}</Text>
      {phase === "open" ? (
        <>
          {offer.plan.length > 0 ? (
            <View style={styles.plan}>
              {offer.plan.map((line, index) => (
                <View key={`${index}:${line}`} style={styles.planLine}>
                  <Text style={[typo.sans, styles.planText, styles.planMarker]}>{`${index + 1}.`}</Text>
                  <Text style={[typo.sans, styles.planText, styles.planBody]}>{line}</Text>
                </View>
              ))}
            </View>
          ) : null}
          <Text style={[typo.sans, styles.body]}>{AMORA_TASK_COPY.offerBody}</Text>
          {retry ? (
            <Text accessibilityLiveRegion="polite" style={[typo.sans, styles.body]}>
              {AMORA_TASK_COPY.startFailed}
            </Text>
          ) : null}
          <InvitationButton
            label={starting ? AMORA_TASK_COPY.offerStarting : AMORA_TASK_COPY.offerStart}
            onPress={() => void start()}
            variant="ink"
            height={44}
            paddingHorizontal={22}
            fontSize={14}
            weight="700"
            disabled={starting || !ownerId}
            style={[styles.button, (starting || !ownerId) && styles.busy]}
          />
        </>
      ) : (
        <>
          {lineKey ? (
            <Text accessibilityLiveRegion="polite" style={[typo.sans, styles.body]}>
              {phase === "unavailable" && gateReply ? gateReply : AMORA_TASK_COPY[lineKey]}
            </Text>
          ) : null}
          {canOpen ? (
            <InvitationButton
              label={AMORA_TASK_COPY.offerOpen}
              onPress={open}
              variant="outline"
              height={44}
              paddingHorizontal={20}
              fontSize={14}
              style={styles.button}
            />
          ) : null}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    width: "100%",
    marginTop: 8,
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: palette.ring,
    backgroundColor: palette.paper,
  },
  eyebrow: { fontSize: 12, color: palette.muted },
  title: { fontSize: 17, lineHeight: lineHeight(17, 1.45) },
  plan: { gap: 4 },
  planLine: { flexDirection: "row" },
  planText: { fontSize: 14, lineHeight: lineHeight(14, 1.55), color: palette.body },
  planMarker: { width: 18, marginRight: 4, textAlign: "right" },
  planBody: { flex: 1 },
  body: { fontSize: 14, lineHeight: lineHeight(14, 1.55), color: palette.body },
  button: { alignSelf: "flex-start", marginTop: 4 },
  busy: { opacity: 0.5 },
});
