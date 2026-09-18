import { useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { router } from "expo-router";
import { Text } from "@/components/ui/AppText";
import { colors, spacing, radius } from "@hanbang/design-tokens";
import { AMORA_RECAP_REQUEST, type ConversationRecap } from "@hanbang/shared";

const labels: Record<ConversationRecap["actions"][number]["state"], string> = {
  applied: "반영 결과 확인됨", pending: "확인 전 · 아직 반영 안 됨", awaiting_result: "승인 후 결과 확인 중", failed: "반영 실패 · 다시 확인 필요", expired: "기한 만료 · 새 제안 필요", superseded: "이전 제안 · 다시 확인 필요",
};

/**
 * 정리 아래에 두는 다음 행선지 — 웹 정리 패널과 같은 갈래다(2026-09-18).
 * 함께 대화는 공유 할 일과 현재 예산, 나만 상담은 개인 할 일. 이름은 앱에서 도착하는 화면의 제목을 쓴다
 * (웹 결정 보드의 「공유 할 일」은 앱에서 같은 이름의 화면이고, 「개인 할 일」은 「나만 보는 할 일」 화면이다).
 */
const RECAP_DESTINATIONS = {
  shared: [
    { label: "공유 할 일", pathname: "/amora-preparation" },
    { label: "현재 예산", pathname: "/budget" },
  ],
  private: [
    { label: "나만 보는 할 일", pathname: "/amora-personal" },
  ],
} as const;

export function AmoraConversationRecap({ recap, scope, scopeLabel, disabled, onPrefill }: {
  recap: ConversationRecap; scope: "shared" | "private"; scopeLabel: string; disabled: boolean; onPrefill: (text: string) => boolean;
}) {
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const prefill = (text: string) => {
    if (disabled) return;
    if (onPrefill(text)) { setNotice(null); setOpen(false); }
    else setNotice("작성 중인 메시지는 그대로 두었어요. 보내거나 비운 뒤 다시 선택해 주세요.");
  };
  const go = (pathname: (typeof RECAP_DESTINATIONS)[keyof typeof RECAP_DESTINATIONS][number]["pathname"]) => {
    // 열린 시트 위에 새 화면을 쌓지 않는다 — 닫고 옮겨 간다.
    setOpen(false);
    router.push(pathname);
  };
  return <View style={styles.entry}>
    <Pressable accessibilityRole="button" disabled={disabled} style={styles.button} onPress={() => setOpen(true)}>
      <Text style={styles.link}>최근 대화 정리{recap.day ? ` · ${recap.day}` : ""}</Text>
    </Pressable>
    <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
      <View style={styles.overlay}><View style={styles.sheet} accessibilityViewIsModal>
        <Text accessibilityRole="header" style={styles.title}>{scopeLabel} · 최근 대화 정리</Text>
        <ScrollView contentContainerStyle={styles.body}>
          <Text style={styles.hint}>현재 불러온 대화 {recap.messageCount}개에서 확인한 내용이에요. AI가 새로 요약하거나 별도 기억으로 저장한 내용은 아니에요.</Text>
          {recap.lastQuestion ? <><Text style={styles.label}>마지막으로 내가 물은 내용</Text><Text style={styles.text}>{recap.lastQuestion.text}</Text>
            <Pressable accessibilityRole="button" disabled={disabled} style={styles.button} onPress={() => prefill(`이전에 내가 물어본 내용이에요:\n${recap.lastQuestion!.text}\n\n현재 상태를 확인하고 여기서 이어서 이야기해줘. 이미 반영된 변경은 다시 실행하지 마.`)}><Text style={styles.link}>이 질문 이어서 상담</Text></Pressable></>
            : <Text style={styles.hint}>이 범위에서 이어갈 내 질문을 아직 확인하지 못했어요.</Text>}
          {recap.actions.length > 0 && <Text style={styles.hint}>제안은 확정된 결정이 아니에요. 반영 후 변경된 최신 값은 예산·일정 화면에서 확인해 주세요.</Text>}
          {recap.actions.map(action => <View key={action.actionId} style={styles.card}><Text style={styles.label}>{labels[action.state]}</Text><Text style={styles.text}>{action.text}</Text></View>)}
          {recap.actions.length === 0 && <Text style={styles.hint}>이 범위에서 확인할 공유 반영 제안은 없어요.</Text>}
          <Text style={styles.hint}>버튼을 누르면 현재 상담 범위의 입력창에만 문장을 넣어요. 직접 보내기 전에는 전송하지 않아요.</Text>
          <Pressable accessibilityRole="button" disabled={disabled} style={styles.button} onPress={() => prefill(AMORA_RECAP_REQUEST)}><Text style={styles.link}>아모라에게 정리 요청하기</Text></Pressable>
          {notice && <Text accessibilityRole="alert" style={styles.hint}>{notice}</Text>}
          <View style={styles.destinations}>
            {RECAP_DESTINATIONS[scope].map(destination => <Pressable key={destination.pathname} accessibilityRole="link" style={styles.destination} onPress={() => go(destination.pathname)}>
              <Text style={styles.destinationText}>{destination.label}</Text>
            </Pressable>)}
          </View>
        </ScrollView>
        <Pressable accessibilityRole="button" style={styles.button} onPress={() => setOpen(false)}><Text>닫기</Text></Pressable>
      </View></View>
    </Modal>
  </View>;
}
const styles = StyleSheet.create({
  entry: { paddingHorizontal: spacing[4], borderBottomWidth: 1, borderBottomColor: colors.border },
  button: { minHeight: 44, justifyContent: "center", paddingHorizontal: spacing[2] }, link: { color: colors.rose[700], fontSize: 12, textDecorationLine: "underline" },
  overlay: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(37,26,24,0.4)" },
  sheet: { maxHeight: "85%", padding: spacing[4], paddingBottom: spacing[6], backgroundColor: colors.surface, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl },
  body: { gap: spacing[3], paddingVertical: spacing[4] }, title: { fontSize: 18, fontWeight: "700", color: colors.noir[800] },
  label: { fontSize: 13, fontWeight: "700", color: colors.noir[800] }, text: { fontSize: 14, lineHeight: 21, color: colors.noir[800] },
  hint: { fontSize: 12, lineHeight: 19, color: colors.textSecondary }, card: { padding: spacing[3], gap: spacing[2], borderRadius: radius.md, backgroundColor: colors.ivory[100] },
  destinations: { flexDirection: "row", flexWrap: "wrap", gap: spacing[2], paddingTop: spacing[3], borderTopWidth: 1, borderTopColor: colors.border },
  destination: { minHeight: 44, justifyContent: "center", paddingHorizontal: spacing[3], borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  destinationText: { fontSize: 13, fontWeight: "600", color: colors.rose[700] },
});
