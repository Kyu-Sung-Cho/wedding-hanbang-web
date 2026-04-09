import { View, Text, ScrollView, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { colors } from "@hanbang/design-tokens";

export default function DashboardScreen() {
  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.content}>
        <Text style={styles.overline}>오늘</Text>
        <Text style={styles.brandTitle}>웨딩한방</Text>

        {/* D-day 카드 */}
        <View style={styles.ddayCard}>
          <Text style={styles.ddayLabel}>결혼까지</Text>
          <Text style={styles.ddayValue}>D-—</Text>
          <Text style={styles.ddayHint}>결혼 예정일을 설정해보세요</Text>
        </View>

        {/* 진행률 */}
        <View style={styles.card}>
          <Text style={styles.cardLabel}>전체 진행률</Text>
          <Text style={styles.progressValue}>0%</Text>
          <View style={styles.progressBar}>
            <View style={[styles.progressFill, { width: "0%" }]} />
          </View>
        </View>

        {/* 오늘의 할 일 */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>오늘의 할 일</Text>
          <Text style={styles.cardEmpty}>아직 등록된 할 일이 없어요</Text>
        </View>

        {/* Phase 0 알림 */}
        <View style={styles.noticeCard}>
          <Text style={styles.noticeLabel}>Phase 0 · 앱 뼈대</Text>
          <Text style={styles.noticeText}>
            웨딩한방 모바일 앱이 성공적으로 실행되고 있어요. 다음 단계에서 카카오 로그인, AI 채팅, 커뮤니티가 추가됩니다.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 20 },
  overline: { fontSize: 13, color: colors.textSecondary, marginBottom: 4 },
  brandTitle: {
    fontSize: 32,
    fontWeight: "500",
    color: colors.noir[800],
    marginBottom: 24,
    letterSpacing: -0.5,
  },
  ddayCard: {
    backgroundColor: colors.noir[800],
    borderRadius: 28,
    padding: 24,
    marginBottom: 16,
  },
  ddayLabel: { fontSize: 12, color: colors.taupe[400], marginBottom: 8 },
  ddayValue: { fontSize: 56, fontWeight: "500", color: "#FFFFFF", marginBottom: 4 },
  ddayHint: { fontSize: 13, color: colors.taupe[400] },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 28,
    padding: 24,
    marginBottom: 16,
  },
  cardLabel: { fontSize: 13, color: colors.textSecondary, marginBottom: 8 },
  progressValue: {
    fontSize: 32,
    fontWeight: "500",
    color: colors.noir[800],
    marginBottom: 12,
  },
  progressBar: {
    height: 8,
    backgroundColor: colors.ivory[200],
    borderRadius: 999,
    overflow: "hidden",
  },
  progressFill: { height: "100%", backgroundColor: colors.rose[500], borderRadius: 999 },
  cardTitle: { fontSize: 16, fontWeight: "600", color: colors.noir[800], marginBottom: 16 },
  cardEmpty: { fontSize: 13, color: colors.textTertiary },
  noticeCard: {
    backgroundColor: colors.rose.pale,
    borderRadius: 20,
    padding: 16,
    marginTop: 8,
  },
  noticeLabel: { fontSize: 12, fontWeight: "600", color: colors.rose[600], marginBottom: 4 },
  noticeText: { fontSize: 12, color: colors.noir[800], lineHeight: 18 },
});
