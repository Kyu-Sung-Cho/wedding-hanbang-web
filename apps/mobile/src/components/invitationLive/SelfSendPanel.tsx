// 직접 보내기 칸(D-83 1단계, 2026-11-18). 편지 시트의 알려줄 정보 아래에 둔다.
//
// 아모라가 쓴 편지를 두 분 폰에서 보낸다. 아모라 서버는 보내지 않는다. 그래서 이 칸은 "보냈어요"라고 말하지 않고,
// 복사했는지·공유 창이나 문자 앱이 열렸는지까지만 말한다(`SELF_SEND_COPY`).
//   - 보낼 글은 서버가 저장한 판으로 엮은 그대로 보여 주고 그대로 넘긴다. 화면에서 고쳐 쓰지 않는다.
//   - 고치는 중이면 글 대신 "저장하면 글이 나온다"는 한 줄만 둔다(옛 판의 글을 보내지 않게).
//   - 고친 것은 없지만 저장한 판이 없으면(처음이거나, 담은 웨딩홀이 바뀌어 서버가 판을 내렸다) 저장하면 업체마다
//     보낼 글이 나온다고 한 줄 둔다. 저장 단추는 시트 맨 아래에 있다.
//   - 아직 저장한 판이 없고 희망 시기나 하객 수를 모르면 먼저 묻는다. 모르는 것만 묻고, 누르면 첫 대화가 열린다.
//   - 편지를 한 번이라도 저장했으면 업체 답을 상담 화면에 붙여 넣으라는 줄과 상담 화면 단추를 둔다. 고치는 중이거나
//     담은 웨딩홀이 바뀌어 보낼 글이 없을 때도 둔다(앞서 보낸 글의 답은 그 사이에도 온다).
//   - 공유 창이나 문자 앱이 열리지 않아 대신 복사했으면 그냥 복사와 다르게 말하고, 네이버를 못 열면 그 글 아래에서
//     그렇다고 말한다. 네이버 단추도 다른 단추처럼 한 번에 하나만 연다.
//   - 글은 글자 크기 그대로 고딕(Noto Sans KR 전체 음절)으로 그린다. 명조 서브셋에는 드문 글자가 없다.
//   - 글은 읽어 주는 이름(accessibilityLabel)에 넣지 않는다. 터치 기록에 글이 실리지 않게 한다.
//   - 보낼 글이 나오면 그 위 첫 줄을 읽어 준다(안드로이드 `accessibilityLiveRegion`). 아이폰은 저장한 화면
//     (`app/halls/letter.tsx` 의 `prepare`)이 같은 줄을 읽어 준다.
import { useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { SELF_SEND_COPY, type LetterSelfSend, type LetterSelfSendMessage } from "@hanbang/shared/invitation";
import { Text } from "@/components/ui/AppText";
import InvitationButton from "@/components/invitation/InvitationButton";
import { lineHeight, palette, typo } from "@/components/invitation/invitationStyle";
import type { LetterConditionsToAsk, LetterSelfSendView } from "@/lib/invitationApi.mjs";
import {
  copyLetterText,
  openHallSearch,
  openLetterSms,
  shareLetterText,
  type SelfSendOutcome,
} from "@/lib/selfSendActions";

/** 말할 것이 있는 결과. 사람이 공유 창을 닫았거나(cancelled) 네이버가 열렸으면(hallSearchOpened) 줄을 비운다. */
type Spoken = Exclude<SelfSendOutcome, "cancelled" | "hallSearchOpened">;
type Run = (action: () => Promise<SelfSendOutcome>) => void;

const FEEDBACK: Record<Spoken, string> = {
  copied: SELF_SEND_COPY.copied,
  copiedInstead: SELF_SEND_COPY.copiedInstead,
  copyFailed: SELF_SEND_COPY.copyFailed,
  shareOpened: SELF_SEND_COPY.shareOpened,
  smsOpened: SELF_SEND_COPY.smsOpened,
  findHallFailed: SELF_SEND_COPY.findHallFailed,
};

const isSpoken = (outcome: SelfSendOutcome): outcome is Spoken => outcome !== "cancelled" && outcome !== "hallSearchOpened";

/** 모르는 조건만 묻는 말. 이미 알려 준 것(정한 예식일 같은)을 다시 묻지 않는다. */
const ASK_CONDITIONS: Record<LetterConditionsToAsk, string> = {
  month: SELF_SEND_COPY.missingMonth,
  guests: SELF_SEND_COPY.missingGuests,
  both: SELF_SEND_COPY.missingConditions,
};

type Props = {
  view: LetterSelfSendView;
  onAskConditions: () => void;
  onOpenConsultation: () => void;
};

export default function SelfSendPanel({ view, onAskConditions, onOpenConsultation }: Props) {
  if (!view.askConditions && !view.saveFirst && !view.beforeSave && !view.messages && !view.afterSend) return null;
  return (
    <View style={styles.root}>
      {view.askConditions ? (
        <View style={styles.group}>
          <Text style={[typo.sans, styles.note]}>{ASK_CONDITIONS[view.askConditions]}</Text>
          <SmallButton label={SELF_SEND_COPY.missingConditionsAction} onPress={onAskConditions} />
        </View>
      ) : null}
      {view.saveFirst ? <Text style={[typo.sans, styles.note]}>{SELF_SEND_COPY.saveFirst}</Text> : null}
      {view.beforeSave ? <Text style={[typo.sans, styles.note]}>{SELF_SEND_COPY.beforeSave}</Text> : null}
      {view.messages ? <SelfSendMessages selfSend={view.messages} /> : null}
      {view.afterSend ? (
        <View style={styles.group}>
          <Text style={[typo.sans, styles.note]}>{SELF_SEND_COPY.afterSend}</Text>
          <SmallButton label={SELF_SEND_COPY.openConsultation} onPress={onOpenConsultation} />
        </View>
      ) : null}
    </View>
  );
}

function SelfSendMessages({ selfSend }: { selfSend: LetterSelfSend }) {
  // 마지막으로 누른 글과 그 결과. 결과 줄은 누른 글 아래에 둔다.
  const [feedback, setFeedback] = useState<{ hallId: string; outcome: Spoken } | null>(null);
  // 공유 창·문자 앱을 여는 동안 다시 누르면 창이 겹친다. 한 번에 하나만 연다.
  const busyRef = useRef(false);
  const run = async (hallId: string, action: () => Promise<SelfSendOutcome>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setFeedback(null);
    try {
      const outcome = await action();
      setFeedback(isSpoken(outcome) ? { hallId, outcome } : null);
    } finally {
      busyRef.current = false;
    }
  };
  return (
    <View style={styles.group}>
      <Text accessibilityLiveRegion="polite" style={[typo.sans, styles.intro]}>{SELF_SEND_COPY.intro}</Text>
      {selfSend.messages.map((message) => (
        <MessageCard
          key={message.hallId}
          message={message}
          feedback={feedback?.hallId === message.hallId ? FEEDBACK[feedback.outcome] : null}
          onAction={(action) => {
            void run(message.hallId, action);
          }}
        />
      ))}
      {selfSend.phoneOmitted ? <Text style={[typo.sans, styles.note]}>{SELF_SEND_COPY.phoneOmitted}</Text> : null}
    </View>
  );
}

function MessageCard({ message, feedback, onAction }: { message: LetterSelfSendMessage; feedback: string | null; onAction: Run }) {
  const title = SELF_SEND_COPY.messageFor(message.name);
  return (
    <View style={styles.card}>
      <Text style={[typo.sansBold, styles.cardTitle]}>{title}</Text>
      <View style={styles.textBox}>
        <Text selectable style={[typo.sans, styles.text]}>{message.text}</Text>
      </View>
      <View style={styles.buttons}>
        <SmallButton label={SELF_SEND_COPY.copy} spoken={`${title} ${SELF_SEND_COPY.copy}`} onPress={() => onAction(() => copyLetterText(message.text))} />
        <SmallButton label={SELF_SEND_COPY.share} spoken={`${title} ${SELF_SEND_COPY.share}`} onPress={() => onAction(() => shareLetterText(message.text))} />
        <SmallButton label={SELF_SEND_COPY.sms} spoken={`${title} ${SELF_SEND_COPY.sms}`} onPress={() => onAction(() => openLetterSms(message.text))} />
      </View>
      <InvitationButton
        label={SELF_SEND_COPY.findHall}
        onPress={() => onAction(() => openHallSearch(message.name))}
        accessibilityLabel={`${message.name} ${SELF_SEND_COPY.findHall}`}
        accessibilityRole="link"
        variant="plain"
        height={36}
        paddingHorizontal={2}
        fontSize={13}
        weight="500"
        color={palette.goldInk}
        underline
        style={styles.link}
      />
      {feedback ? <Text accessibilityLiveRegion="polite" style={[typo.sans, styles.note]}>{feedback}</Text> : null}
    </View>
  );
}

function SmallButton({ label, spoken, onPress }: { label: string; spoken?: string; onPress: () => void }) {
  return (
    <InvitationButton
      label={label}
      onPress={onPress}
      accessibilityLabel={spoken}
      variant="outline"
      height={38}
      paddingHorizontal={16}
      fontSize={13}
      weight="500"
      style={styles.small}
    />
  );
}

const styles = StyleSheet.create({
  root: { gap: 14 },
  group: { gap: 12 },
  intro: { fontSize: 14, lineHeight: lineHeight(14, 1.6), color: palette.body },
  note: { fontSize: 13, lineHeight: lineHeight(13, 1.6), color: palette.body },
  card: { borderWidth: 1, borderColor: palette.ring, borderRadius: 16, padding: 14, gap: 10 },
  cardTitle: { fontSize: 14, lineHeight: lineHeight(14, 1.45) },
  textBox: { backgroundColor: palette.paperSoft, borderRadius: 10, padding: 12 },
  text: { fontSize: 14, lineHeight: lineHeight(14, 1.7), color: palette.letter },
  buttons: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  small: { alignSelf: "flex-start" },
  link: { alignSelf: "flex-start" },
});
