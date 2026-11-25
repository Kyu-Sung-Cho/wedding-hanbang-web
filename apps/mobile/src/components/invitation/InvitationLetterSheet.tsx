import { useState, type ReactNode } from "react";
import { Image, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LETTER_COPY, type InvitationRouteKey, type LetterModel, type LetterShare } from "@hanbang/shared/invitation";
import { Text, TextInput } from "@/components/ui/AppText";
import AmoraOrb from "@/components/ui/AmoraOrb";
import InvitationButton from "./InvitationButton";
import { invitationPhotoSource } from "./invitationPhotos";
import { hitSlopFor, lineHeight, palette, photoFill, shadow, typo } from "./invitationStyle";

type Props = {
  model: LetterModel;
  onToggleShare: (key: LetterShare["key"]) => void;
  /** "문자로 보내기". 없으면 상담 화면으로 간다(아티팩트 링크). */
  onSend?: () => void;
  /** "나중에 할게요". 없으면 비교 화면으로 간다(아티팩트 링크). */
  onLater?: () => void;
  onNavigate: (route: InvitationRouteKey) => void;
  /** "문구 고치기". 주면 편지 본문을 그 자리에서 고칠 수 있다. 없으면 단추가 눌리지 않는다. */
  onChangeBody?: (body: string) => void;
  /** 실제 커플: 누가 승인할지 고르는 작은 칸(D-76). 알려줄 정보 아래에 둔다. 없으면 그리지 않는다(예시). */
  approver?: ReactNode;
  /** 실제 커플: 승인·보내기 결과처럼 보내기 단추 위에 사실대로 알릴 한 줄. 없으면 그리지 않는다. */
  notice?: string | null;
  /** 저장·승인을 기다리는 동안 보내기를 다시 누르지 못하게 한다. */
  sendBusy?: boolean;
  /**
   * 직접 보내기(D-83 1단계)에서만 쓰는 칸들. 주지 않으면 시트는 오늘과 똑같다. 제목은 두 모드 모두 LETTER_COPY.title
   * (파운더 확정 D-83 문구 "N곳에 보낼 편지예요", 2026-11-23 결정으로 직접 보내기에서도 같다)이다.
   * - hidePartnerRead: 상대가 읽고 좋다고 했다는 줄을 숨긴다. 직접 보내기에는 상대 승인이 없어(승인 경로는 409) 그 줄은
   *   스위치를 켜기 전에 받은 승인만 말할 수 있어서다(파운더 결정 2026-11-23: 숨긴다).
   * - selfSend: 알려줄 정보 아래에 두는 보낼 글 묶음.
   * - mainAction: 보내기 단추 대신 둘 주 단추. 주면 보내기 단추를 그리지 않는다(승인하지 않는다).
   *   `onPress` 가 없으면 눌리지 않는다.
   */
  hidePartnerRead?: boolean;
  selfSend?: ReactNode;
  mainAction?: { label: string; onPress?: () => void };
};

/**
 * 보내기 전 편지 확인(`Approve.dc`, 390×960). 어두운 사진 위 흰 시트에 편지 한 장, 함께 알려줄 정보의 스위치,
 * 상대 확인 문장, 보내기. 시트 위 손잡이는 모양만 옮겼다(끌어서 닫기는 없다).
 */
export default function InvitationLetterSheet({
  model,
  onToggleShare,
  onSend,
  onLater,
  onNavigate,
  onChangeBody,
  approver,
  notice,
  sendBusy = false,
  hidePartnerRead = false,
  selfSend,
  mainAction,
}: Props) {
  const insets = useSafeAreaInsets();
  const [editing, setEditing] = useState(false);
  const backdrop = invitationPhotoSource(model.backdropPhoto);
  const count = model.recipients.length;
  return (
    <View style={styles.root}>
      {backdrop ? (
        <Image
          source={backdrop}
          resizeMode="cover"
          style={[photoFill, styles.backdrop]}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        />
      ) : null}
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} bounces={false}>
        <View
          accessibilityViewIsModal
          accessibilityLabel={LETTER_COPY.dialogLabel}
          style={[styles.sheet, { paddingBottom: Math.max(24, insets.bottom) }]}
        >
          <View style={styles.handle} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />
          <View style={styles.titleRow}>
            <AmoraOrb size={44} mood="calm" />
            <Text accessibilityRole="header" style={[typo.sansBold, styles.title]}>{LETTER_COPY.title(count)}</Text>
          </View>

          <View style={styles.letter}>
            <View style={styles.letterHead}>
              <Text style={[typo.serif, styles.to]}>{LETTER_COPY.to(model.recipients)}</Text>
              <Text style={[typo.numeralItalic, styles.date]}>{model.dateLabel}</Text>
            </View>
            {editing && onChangeBody ? (
              <TextInput
                value={model.body}
                onChangeText={onChangeBody}
                multiline
                autoFocus
                accessibilityLabel={LETTER_COPY.editText}
                style={[typo.serif, styles.body, styles.bodyInput]}
              />
            ) : (
              <Text style={[typo.serif, styles.body]}>{model.body}</Text>
            )}
            <View style={styles.letterFoot}>
              <Text style={[typo.serif, styles.signature]}>{model.signature}</Text>
              <InvitationButton
                label={LETTER_COPY.editText}
                onPress={onChangeBody ? () => setEditing((value) => !value) : undefined}
                selected={editing}
                variant="plain"
                height={36}
                paddingHorizontal={2}
                fontSize={13}
                weight="500"
                color={palette.goldInk}
                underline
              />
            </View>
          </View>

          <View>
            <Text style={[typo.sans, styles.sharesHeading]}>{LETTER_COPY.sharesHeading}</Text>
            {model.shares.map((share) => (
              <ShareRow key={share.key} share={share} onToggle={() => onToggleShare(share.key)} />
            ))}
          </View>

          {approver}

          {selfSend}

          {model.partnerApprovedName && !hidePartnerRead ? (
            <Text style={[typo.sans, styles.note]}>{LETTER_COPY.partnerRead(model.partnerApprovedName)}</Text>
          ) : null}

          {notice ? (
            <Text accessibilityLiveRegion="polite" style={[typo.sans, styles.note]}>{notice}</Text>
          ) : null}

          <View style={styles.actions}>
            {mainAction ? (
              <InvitationButton
                label={mainAction.label}
                onPress={mainAction.onPress}
                variant="ink"
                height={56}
                fontSize={16}
                weight="700"
                style={!mainAction.onPress && styles.unavailable}
              />
            ) : (
              <InvitationButton
                label={LETTER_COPY.send}
                // 받을 곳이 없으면 보낼 수 없다. 저장·승인을 기다리는 동안에도 다시 누르지 못한다.
                onPress={count > 0 && !sendBusy ? (onSend ?? (() => onNavigate("status"))) : undefined}
                variant="ink"
                height={56}
                fontSize={16}
                weight="700"
                style={(count === 0 || sendBusy) && styles.unavailable}
              />
            )}
            <InvitationButton
              label={LETTER_COPY.later}
              onPress={onLater ?? (() => onNavigate("compare"))}
              variant="plain"
              height={44}
              fontSize={14}
            />
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

function ShareRow({ share, onToggle }: { share: LetterShare; onToggle: () => void }) {
  return (
    <View style={styles.share}>
      <View style={styles.shareText}>
        <Text style={[typo.sans, styles.shareLabel]}>{share.label}</Text>
        <Text style={[typo.sans, styles.shareValue]}>{share.on ? share.value : LETTER_COPY.notShared}</Text>
      </View>
      <Pressable
        onPress={onToggle}
        accessibilityRole="switch"
        accessibilityLabel={LETTER_COPY.switchLabel(share.label)}
        accessibilityState={{ checked: share.on }}
        hitSlop={hitSlopFor(32)}
        style={[styles.track, share.on ? styles.trackOn : styles.trackOff]}
      >
        <View style={styles.knob} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, overflow: "hidden", backgroundColor: palette.sheetBackdrop },
  backdrop: { opacity: 0.55 },
  scroll: { flex: 1 },
  scrollContent: { flexGrow: 1, justifyContent: "flex-end" },
  sheet: {
    backgroundColor: palette.white,
    borderTopLeftRadius: 34,
    borderTopRightRadius: 34,
    paddingTop: 10,
    paddingHorizontal: 22,
    gap: 18,
  },
  handle: { alignSelf: "center", width: 38, height: 5, borderRadius: 3, backgroundColor: palette.chipLine },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  title: { flex: 1, fontSize: 18, lineHeight: lineHeight(18, 1.45) },
  letter: {
    backgroundColor: palette.paper,
    borderRadius: 6,
    boxShadow: shadow.letter,
    paddingTop: 22,
    paddingHorizontal: 22,
    paddingBottom: 18,
    gap: 12,
  },
  letterHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" },
  to: { fontSize: 15, flexShrink: 1 },
  date: { fontSize: 16, color: palette.goldInk },
  body: { fontSize: 15, lineHeight: lineHeight(15, 1.85), color: palette.letter },
  bodyInput: { padding: 0, textAlignVertical: "top" },
  letterFoot: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: palette.letterRule,
  },
  signature: { fontSize: 14 },
  sharesHeading: { fontSize: 13, color: palette.muted, paddingBottom: 2 },
  share: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    // 아티팩트는 div 의 min-height: 52px(내용 상자) 아래에 1px 선을 더해 한 줄이 53px 이다.
    // React Native 의 minHeight 는 테두리까지 포함하므로 53 을 둔다.
    minHeight: 53,
    borderBottomWidth: 1,
    borderBottomColor: palette.rowLine,
  },
  shareText: { gap: 2, flexShrink: 1 },
  shareLabel: { fontSize: 15 },
  shareValue: { fontSize: 12, color: palette.muted },
  track: { width: 52, height: 32, borderRadius: 16, padding: 3, flexDirection: "row", alignItems: "center" },
  trackOn: { backgroundColor: palette.ink, justifyContent: "flex-end" },
  trackOff: { backgroundColor: palette.switchOff, justifyContent: "flex-start" },
  knob: { width: 26, height: 26, borderRadius: 13, backgroundColor: palette.white, boxShadow: shadow.knob },
  note: { fontSize: 13, lineHeight: lineHeight(13, 1.6), color: palette.body },
  actions: { gap: 4 },
  unavailable: { opacity: 0.4 },
});
