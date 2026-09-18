import type { ReactNode } from "react";
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Text } from "@/components/ui/AppText";
import { colors } from "@hanbang/design-tokens";
import {
  CHAT_VIEW_CLEAR_COPY,
  type ChatViewClearMode,
  type ChatViewClearStep,
} from "@/lib/chatViewClear";

/**
 * 「대화 화면 정리」 창 — 웹 채팅의 같은 창(`ChatContent.tsx` 의 `clearStep`)과 같은 단계·문구다(2026-09-18).
 *
 * - 함께 대화: 「내 화면만 정리 (추천)」, 그리고 상대가 연결돼 있을 때만 「둘의 화면 함께 정리」. 불러온 대화에
 *   아직 답이 없는 요청 카드가 있으면 「둘 다」는 이유와 함께 막는다.
 * - 나만 상담: 「내 화면만 정리 (추천)」과 「비공개 대화·아모라 기억 삭제」. 삭제는 네이티브 확인 창에서
 *   「삭제」를 한 번 더 눌러야만 시작된다 — 「취소」나 창 밖을 누르면 아무것도 보내지 않는다.
 *
 * 이 창은 결과를 말하지 않는다. 정리됐는지는 서버가 확인해 준 뒤 화면이 알린다 — 여기서는 진행 중과 실패만 보인다.
 * 정리 요청이 가는 동안에는 닫지 않는다(닫으면 실패를 볼 곳이 사라진다). 동의 요청은 가는 중에도 닫을 수 있고,
 * 다시 열어도 「보내는 중」이 유지된다(화면이 사람·커플별로 쥔다).
 */
export function ChatViewClearSheet({
  step,
  hasLinkedPartner,
  pendingRequestExists,
  clearingMode,
  requestSending,
  error,
  onChoose,
  onChooseBoth,
  onBack,
  onSubmitRequest,
  onConfirmDeletePrivate,
  onClose,
}: {
  step: ChatViewClearStep;
  hasLinkedPartner: boolean;
  /** 불러온 공유 대화에 누가 보냈든 아직 답이 없는 「함께 새로 시작」 요청 카드가 있다. */
  pendingRequestExists: boolean;
  /** 지금 서버로 가고 있는 정리. 없으면 null. */
  clearingMode: ChatViewClearMode | null;
  requestSending: boolean;
  error: string | null;
  onChoose: (mode: "view_reset_shared" | "view_reset_private") => void;
  onChooseBoth: () => void;
  onBack: () => void;
  onSubmitRequest: () => void;
  onConfirmDeletePrivate: () => void;
  onClose: () => void;
}) {
  const copy = CHAT_VIEW_CLEAR_COPY;
  const busy = clearingMode !== null;
  const close = () => { if (!busy) onClose(); };
  const askDeletePrivate = () => {
    if (busy) return;
    Alert.alert(
      copy.deleteConfirm.title,
      copy.deleteConfirm.message,
      [
        { text: copy.deleteConfirm.cancel, style: "cancel" },
        { text: copy.deleteConfirm.confirm, style: "destructive", onPress: onConfirmDeletePrivate },
      ],
      { cancelable: true },
    );
  };
  const errorLine = error ? (
    <Text style={styles.error} accessibilityRole="alert" accessibilityLiveRegion="polite">{error}</Text>
  ) : null;
  const cancel = (
    <Pressable
      style={({ pressed }) => [styles.secondary, pressed && !busy && styles.secondaryPressed, busy && styles.disabled]}
      onPress={close}
      disabled={busy}
      accessibilityRole="button"
      accessibilityLabel={copy.cancel}
      accessibilityState={{ disabled: busy }}
    >
      <Text style={styles.secondaryText}>{copy.cancel}</Text>
    </Pressable>
  );

  return (
    <Modal visible={step !== "closed"} transparent animationType="slide" onRequestClose={close}>
      <View style={styles.overlay}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={close}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        />
        <View style={styles.sheet} accessibilityViewIsModal>
          <View style={styles.handle} />
          <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
            {step === "shared_choose" && (
              <>
                <Text accessibilityRole="header" style={styles.title}>{copy.shared.title}</Text>
                <Text style={styles.intro}>{copy.shared.intro}</Text>
                <Text style={styles.note}>{copy.shared.introNote}</Text>
                <View style={styles.options}>
                  <ClearOption
                    title={copy.shared.ownTitle}
                    tone="recommended"
                    disabled={busy}
                    busy={clearingMode === "view_reset_shared"}
                    onPress={() => onChoose("view_reset_shared")}
                  >
                    <Text style={styles.optionDescription}>{copy.shared.ownDescription}</Text>
                  </ClearOption>
                  {hasLinkedPartner && (
                    <ClearOption
                      title={copy.shared.bothTitle}
                      tone="plain"
                      disabled={busy || pendingRequestExists}
                      busy={false}
                      onPress={onChooseBoth}
                    >
                      <Text style={styles.optionDescription}>
                        {copy.shared.bothDescription.before}
                        <Text style={styles.strong}>{copy.shared.bothDescription.strong}</Text>
                        {copy.shared.bothDescription.after}
                      </Text>
                    </ClearOption>
                  )}
                  {hasLinkedPartner && pendingRequestExists && (
                    <Text style={styles.reason} accessibilityLiveRegion="polite">{copy.shared.bothPendingReason}</Text>
                  )}
                </View>
                {errorLine}
                {cancel}
              </>
            )}

            {step === "shared_confirm_both" && (
              <>
                <Text accessibilityRole="header" style={styles.title}>{copy.sharedBoth.title}</Text>
                <Text style={styles.intro}>{copy.sharedBoth.body}</Text>
                <Text style={styles.note}>{copy.sharedBoth.note}</Text>
                {pendingRequestExists && (
                  <Text style={styles.reason} accessibilityLiveRegion="polite">{copy.shared.bothPendingReason}</Text>
                )}
                {errorLine}
                <View style={styles.row}>
                  <Pressable
                    style={({ pressed }) => [styles.secondary, styles.rowButton, pressed && styles.secondaryPressed]}
                    onPress={onBack}
                    accessibilityRole="button"
                    accessibilityLabel={copy.sharedBoth.back}
                  >
                    <Text style={styles.secondaryText}>{copy.sharedBoth.back}</Text>
                  </Pressable>
                  <Pressable
                    style={({ pressed }) => [
                      styles.primary,
                      styles.rowButton,
                      pressed && !(requestSending || pendingRequestExists) && styles.primaryPressed,
                      (requestSending || pendingRequestExists) && styles.primaryDisabled,
                    ]}
                    onPress={onSubmitRequest}
                    disabled={requestSending || pendingRequestExists}
                    accessibilityRole="button"
                    accessibilityLabel={requestSending ? copy.sharedBoth.submitting : copy.sharedBoth.submit}
                    accessibilityState={{ disabled: requestSending || pendingRequestExists, busy: requestSending }}
                  >
                    {requestSending ? <ActivityIndicator size="small" color={colors.surface} /> : null}
                    <Text style={styles.primaryText}>{requestSending ? copy.sharedBoth.submitting : copy.sharedBoth.submit}</Text>
                  </Pressable>
                </View>
              </>
            )}

            {step === "private_confirm" && (
              <>
                <Text accessibilityRole="header" style={styles.title}>{copy.private.title}</Text>
                <Text style={styles.intro}>{copy.private.intro}</Text>
                <Text style={styles.note}>{copy.private.introNote}</Text>
                <View style={styles.options}>
                  <ClearOption
                    title={copy.private.ownTitle}
                    tone="recommended"
                    disabled={busy}
                    busy={clearingMode === "view_reset_private"}
                    onPress={() => onChoose("view_reset_private")}
                  >
                    <Text style={styles.optionDescription}>{copy.private.ownDescription}</Text>
                  </ClearOption>
                  <ClearOption
                    title={copy.private.deleteTitle}
                    tone="danger"
                    disabled={busy}
                    busy={clearingMode === "delete_private"}
                    onPress={askDeletePrivate}
                  >
                    <Text style={styles.optionDescription}>{copy.private.deleteDescription}</Text>
                  </ClearOption>
                </View>
                {errorLine}
                {cancel}
              </>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function ClearOption({
  title,
  tone,
  disabled,
  busy,
  onPress,
  children,
}: {
  title: string;
  tone: "recommended" | "plain" | "danger";
  disabled: boolean;
  busy: boolean;
  onPress: () => void;
  children: ReactNode;
}) {
  return (
    <Pressable
      style={({ pressed }) => [
        styles.option,
        tone === "recommended" && styles.optionRecommended,
        tone === "danger" && styles.optionDanger,
        pressed && !disabled && styles.optionPressed,
        disabled && styles.disabled,
      ]}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled, busy }}
    >
      <View style={styles.optionHeading}>
        <Text
          style={[
            styles.optionTitle,
            tone === "recommended" && styles.optionTitleRecommended,
            tone === "danger" && styles.optionTitleDanger,
          ]}
        >
          {title}
        </Text>
        {busy ? <ActivityIndicator size="small" color={colors.noir[800]} /> : null}
      </View>
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(37,26,24,0.45)" },
  sheet: { maxHeight: "92%", paddingHorizontal: 20, paddingTop: 10, paddingBottom: 28, borderTopLeftRadius: 22, borderTopRightRadius: 22, backgroundColor: colors.surface },
  handle: { alignSelf: "center", width: 38, height: 4, marginBottom: 14, borderRadius: 2, backgroundColor: colors.border },
  body: { flexGrow: 0 },
  bodyContent: { paddingBottom: 4 },
  title: { fontSize: 18, lineHeight: 26, fontWeight: "700", color: colors.noir[800] },
  intro: { marginTop: 8, fontSize: 14, lineHeight: 21, color: colors.textSecondary },
  note: { marginTop: 4, fontSize: 12, lineHeight: 18, color: colors.textTertiary },
  options: { marginTop: 16, gap: 8 },
  option: { minHeight: 44, paddingHorizontal: 16, paddingVertical: 12, borderRadius: 12, borderWidth: 1, borderColor: colors.paper.outline, backgroundColor: colors.surface },
  optionRecommended: { borderColor: colors.sage.deep, backgroundColor: colors.ivory[50] },
  optionDanger: { borderColor: colors.danger, backgroundColor: colors.surface },
  optionPressed: { backgroundColor: colors.ivory[100] },
  optionHeading: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  optionTitle: { flex: 1, fontSize: 15, lineHeight: 22, fontWeight: "600", color: colors.noir[800] },
  optionTitleRecommended: { color: colors.sage.deep },
  optionTitleDanger: { color: colors.dangerDeep },
  optionDescription: { marginTop: 4, fontSize: 13, lineHeight: 19, color: colors.textSecondary },
  strong: { fontWeight: "700", color: colors.noir[800] },
  reason: { fontSize: 12, lineHeight: 18, color: colors.textSecondary },
  error: { marginTop: 12, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12, fontSize: 13, lineHeight: 19, color: colors.dangerDeep, backgroundColor: colors.rose.pale },
  row: { flexDirection: "row", gap: 8, marginTop: 16 },
  rowButton: { flex: 1, marginTop: 0 },
  primary: { minHeight: 48, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingHorizontal: 16, borderRadius: 12, backgroundColor: colors.rose[600] },
  primaryPressed: { backgroundColor: colors.rose[700] },
  primaryDisabled: { backgroundColor: colors.taupe[400] },
  primaryText: { fontSize: 15, fontWeight: "700", color: colors.surface },
  secondary: { minHeight: 48, marginTop: 16, alignItems: "center", justifyContent: "center", paddingHorizontal: 16, borderRadius: 12, borderWidth: 1, borderColor: colors.paper.outline, backgroundColor: colors.surface },
  secondaryPressed: { backgroundColor: colors.ivory[100] },
  secondaryText: { fontSize: 15, fontWeight: "600", color: colors.noir[800] },
  disabled: { opacity: 0.6 },
});
