import { useEffect, useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Text } from "@/components/ui/AppText";
import { Ban, Flag, X } from "lucide-react-native";
import { colors } from "@hanbang/design-tokens";

export type CommunityReportReason =
  | "spam"
  | "abuse"
  | "ad"
  | "privacy"
  | "inappropriate"
  | "other";

export type CommunitySafetyTarget = {
  kind: "post" | "comment";
  contentId: string;
  userId: string;
  nickname: string;
};

type CommunitySafetySheetProps = {
  target: CommunitySafetyTarget | null;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onReport: (reason: CommunityReportReason) => void;
  onBlock: () => void;
};

const REPORT_REASONS: ReadonlyArray<{
  value: CommunityReportReason;
  label: string;
}> = [
  { value: "privacy", label: "개인정보가 노출된 것 같아요" },
  { value: "abuse", label: "모욕·괴롭힘이 우려돼요" },
  { value: "spam", label: "스팸·도배로 보여요" },
  { value: "ad", label: "표시되지 않은 광고가 의심돼요" },
  { value: "inappropriate", label: "커뮤니티에 부적절해 보여요" },
  { value: "other", label: "다른 이유가 있어요" },
];

export function CommunitySafetySheet({
  target,
  busy,
  error,
  onClose,
  onReport,
  onBlock,
}: CommunitySafetySheetProps) {
  const [mode, setMode] = useState<"actions" | "report" | "block">("actions");
  const [reason, setReason] = useState<CommunityReportReason | null>(null);

  useEffect(() => {
    if (!target) return;
    setMode("actions");
    setReason(null);
  }, [target]);

  return (
    <Modal
      visible={Boolean(target)}
      transparent
      animationType="slide"
      onRequestClose={() => !busy && onClose()}
    >
      <View style={styles.backdrop}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={() => !busy && onClose()}
          accessibilityLabel="안전 메뉴 닫기"
        />
        <View style={styles.sheet}>
          <View style={styles.header}>
            <View style={styles.headerCopy}>
              <Text style={styles.title}>
                {mode === "report"
                  ? `${target?.kind === "post" ? "게시글" : "답변"} 신고`
                  : mode === "block"
                    ? `${target?.nickname ?? "이 회원"}님 차단`
                    : "안전 메뉴"}
              </Text>
              <Text style={styles.subtitle}>
                차단은 내 보기·연락 설정이고, 신고는 운영 검토 요청이에요.
              </Text>
            </View>
            <Pressable
              onPress={() => !busy && onClose()}
              disabled={busy}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="안전 메뉴 닫기"
              style={styles.closeButton}
            >
              <X size={20} color={colors.taupe[500]} />
            </Pressable>
          </View>

          {mode === "actions" ? (
            <View style={styles.body}>
              <Pressable
                style={styles.actionRow}
                onPress={() => setMode("report")}
                accessibilityRole="button"
              >
                <Flag size={19} color={colors.rose[600]} />
                <View style={styles.actionCopy}>
                  <Text style={styles.actionTitle}>
                    {target?.kind === "post" ? "게시글 신고" : "답변 신고"}
                  </Text>
                  <Text style={styles.actionDescription}>
                    개인정보·괴롭힘·광고 문제를 운영팀에 알려요.
                  </Text>
                </View>
              </Pressable>
              <Pressable
                style={styles.actionRow}
                onPress={() => setMode("block")}
                accessibilityRole="button"
              >
                <Ban size={19} color={colors.rose[600]} />
                <View style={styles.actionCopy}>
                  <Text style={styles.actionTitle}>이 회원 차단</Text>
                  <Text style={styles.actionDescription}>
                    로그인한 피드·검색·답변·알림에서 서로를 숨겨요.
                  </Text>
                </View>
              </Pressable>
            </View>
          ) : null}

          {mode === "report" ? (
            <ScrollView style={styles.reasonScroll} contentContainerStyle={styles.body}>
              <Text style={styles.sectionLabel}>가장 가까운 이유</Text>
              {REPORT_REASONS.map((item) => (
                <Pressable
                  key={item.value}
                  onPress={() => setReason(item.value)}
                  disabled={busy}
                  style={[
                    styles.reasonRow,
                    reason === item.value && styles.reasonRowSelected,
                  ]}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: reason === item.value }}
                >
                  <View style={[
                    styles.radio,
                    reason === item.value && styles.radioSelected,
                  ]} />
                  <Text style={styles.reasonLabel}>{item.label}</Text>
                </Pressable>
              ))}
              <Text style={styles.privacyWarning}>
                노출된 전화번호·주소·계좌번호를 신고 내용에 다시 옮겨 적지 않아요.
              </Text>
              {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
              <View style={styles.footerActions}>
                <Pressable
                  style={styles.secondaryButton}
                  onPress={() => setMode("actions")}
                  disabled={busy}
                >
                  <Text style={styles.secondaryButtonText}>뒤로</Text>
                </Pressable>
                <Pressable
                  style={[styles.primaryButton, (!reason || busy) && styles.disabled]}
                  onPress={() => reason && onReport(reason)}
                  disabled={!reason || busy}
                >
                  {busy ? <ActivityIndicator size="small" color="#fff" /> : null}
                  <Text style={styles.primaryButtonText}>
                    {busy ? "접수 중..." : "신고 접수"}
                  </Text>
                </Pressable>
              </View>
            </ScrollView>
          ) : null}

          {mode === "block" ? (
            <View style={styles.body}>
              <Text style={styles.blockCopy}>
                로그인한 커뮤니티에서 서로의 새 글·답변·동기방 메시지·알림을
                숨기고 새 답글과 직접 경험 답변 요청을 막아요. 상대에게 차단
                알림이나 차단한 사람의 이름은 보내지 않아요.
              </Text>
              <Text style={styles.publicWarning}>
                공개 글은 로그아웃한 공개 주소에서 계속 보일 수 있어요. 공개
                자체를 검토해야 한다면 차단과 별도로 신고해 주세요.
              </Text>
              {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
              <View style={styles.footerActions}>
                <Pressable
                  style={styles.secondaryButton}
                  onPress={() => setMode("actions")}
                  disabled={busy}
                >
                  <Text style={styles.secondaryButtonText}>뒤로</Text>
                </Pressable>
                <Pressable
                  style={[styles.dangerButton, busy && styles.disabled]}
                  onPress={onBlock}
                  disabled={busy}
                >
                  {busy ? <ActivityIndicator size="small" color="#fff" /> : <Ban size={17} color="#fff" />}
                  <Text style={styles.primaryButtonText}>
                    {busy ? "저장 중..." : "차단하기"}
                  </Text>
                </Pressable>
              </View>
            </View>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(13,13,15,0.46)",
  },
  sheet: {
    maxHeight: "88%",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    backgroundColor: colors.ivory[50],
    paddingBottom: 24,
  },
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 16,
    paddingHorizontal: 20,
    paddingVertical: 18,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.ivory[200],
  },
  headerCopy: { flex: 1 },
  title: { fontSize: 17, fontWeight: "700", color: colors.noir[800] },
  subtitle: { marginTop: 5, fontSize: 12, lineHeight: 18, color: colors.taupe[500] },
  closeButton: { padding: 4 },
  body: { paddingHorizontal: 20, paddingTop: 18, paddingBottom: 8 },
  actionRow: {
    minHeight: 72,
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    borderWidth: 1,
    borderColor: colors.ivory[200],
    borderRadius: 16,
    backgroundColor: "#fff",
    paddingHorizontal: 16,
    paddingVertical: 13,
    marginBottom: 10,
  },
  actionCopy: { flex: 1 },
  actionTitle: { fontSize: 15, fontWeight: "700", color: colors.noir[800] },
  actionDescription: { marginTop: 3, fontSize: 12, lineHeight: 18, color: colors.taupe[500] },
  reasonScroll: { flexGrow: 0 },
  sectionLabel: { marginBottom: 10, fontSize: 13, fontWeight: "700", color: colors.noir[800] },
  reasonRow: {
    minHeight: 46,
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
    borderWidth: 1,
    borderColor: colors.ivory[200],
    borderRadius: 13,
    backgroundColor: "#fff",
    paddingHorizontal: 13,
    marginBottom: 8,
  },
  reasonRowSelected: { borderColor: colors.noir[800], backgroundColor: colors.ivory[100] },
  radio: { width: 16, height: 16, borderRadius: 8, borderWidth: 1.5, borderColor: colors.taupe[400] },
  radioSelected: { borderWidth: 5, borderColor: colors.noir[800] },
  reasonLabel: { flex: 1, fontSize: 13, color: colors.noir[800] },
  privacyWarning: { marginTop: 3, fontSize: 11, lineHeight: 17, color: colors.taupe[500] },
  blockCopy: { fontSize: 14, lineHeight: 22, color: colors.noir[800] },
  publicWarning: {
    marginTop: 14,
    borderRadius: 13,
    backgroundColor: colors.ivory[100],
    padding: 13,
    fontSize: 12,
    lineHeight: 19,
    color: colors.paper.inkFaint,
  },
  error: { marginTop: 12, borderRadius: 10, backgroundColor: "#fbf2f0", padding: 10, fontSize: 12, color: colors.rose[700] },
  footerActions: { flexDirection: "row", gap: 10, marginTop: 18 },
  secondaryButton: {
    minHeight: 46,
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.ivory[200],
    borderRadius: 13,
    backgroundColor: "#fff",
  },
  secondaryButtonText: { fontSize: 14, fontWeight: "700", color: colors.paper.inkFaint },
  primaryButton: {
    minHeight: 46,
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    borderRadius: 13,
    backgroundColor: colors.noir[800],
  },
  dangerButton: {
    minHeight: 46,
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    borderRadius: 13,
    backgroundColor: colors.rose[600],
  },
  primaryButtonText: { fontSize: 14, fontWeight: "700", color: "#fff" },
  disabled: { opacity: 0.45 },
});
