// 시세 정보 화면 — 웨딩 비용 참고 데이터
import { View, Text, ScrollView, StyleSheet, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { ArrowLeft } from "lucide-react-native";
import { colors } from "@hanbang/design-tokens";

interface PriceCategory {
  name: string;
  base: string;
  extra: string;
  note?: string;
  basePercent: number;
  extraPercent: number;
}

const PRICE_DATA: PriceCategory[] = [
  { name: "스튜디오", base: "150~200만", extra: "50~80만", basePercent: 70, extraPercent: 40 },
  { name: "드레스", base: "100~150만", extra: "50~80만", basePercent: 55, extraPercent: 40 },
  { name: "메이크업", base: "50~80만", extra: "20~30만", basePercent: 35, extraPercent: 18 },
  { name: "예식장 식대", base: "인당 5~8만", extra: "", note: "200명 기준 1,000~1,600만", basePercent: 90, extraPercent: 0 },
  { name: "한복", base: "50~200만", extra: "", basePercent: 50, extraPercent: 0 },
  { name: "예물 (반지)", base: "100~500만", extra: "", basePercent: 65, extraPercent: 0 },
  { name: "신혼여행", base: "300~800만", extra: "", basePercent: 80, extraPercent: 0 },
];

export default function MarketPricesScreen() {
  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      {/* 헤더 */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <ArrowLeft size={24} color={colors.noir[800]} />
        </Pressable>
        <Text style={styles.headerTitle}>시세 정보</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* 요약 카드 */}
        <View style={styles.summaryCard}>
          <View style={styles.summaryBadge}>
            <Text style={styles.summaryBadgeText}>2024 기재부 기준</Text>
          </View>
          <Text style={styles.summaryTitle}>스드메 평균 비용</Text>

          <View style={styles.summaryRow}>
            <View style={styles.summaryItem}>
              <Text style={styles.summaryLabel}>기본금 평균</Text>
              <Text style={styles.summaryValue}>346만원</Text>
            </View>
            <View style={styles.summaryDivider} />
            <View style={styles.summaryItem}>
              <Text style={styles.summaryLabel}>추가금 평균</Text>
              <Text style={styles.summaryValue}>174만원</Text>
            </View>
          </View>

          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>총 평균</Text>
            <Text style={styles.totalValue}>520만원</Text>
          </View>
        </View>

        {/* 카테고리별 시세 */}
        <Text style={styles.sectionTitle}>항목별 시세</Text>

        {PRICE_DATA.map((item) => (
          <View key={item.name} style={styles.priceCard}>
            <Text style={styles.priceName}>{item.name}</Text>

            <View style={styles.priceRow}>
              <Text style={styles.priceLabel}>기본</Text>
              <View style={styles.priceBarTrack}>
                <View style={[styles.priceBarFill, { width: `${item.basePercent}%` }]} />
              </View>
              <Text style={styles.priceValue}>{item.base}</Text>
            </View>

            {item.extra ? (
              <View style={styles.priceRow}>
                <Text style={styles.priceLabel}>추가</Text>
                <View style={styles.priceBarTrack}>
                  <View style={[styles.priceBarFill, styles.priceBarExtra, { width: `${item.extraPercent}%` }]} />
                </View>
                <Text style={styles.priceValue}>{item.extra}</Text>
              </View>
            ) : null}

            {item.note && (
              <Text style={styles.priceNote}>{item.note}</Text>
            )}
          </View>
        ))}

        <Text style={styles.disclaimer}>
          * 상기 금액은 참고용 평균 시세이며, 지역/업체에 따라 상이할 수 있습니다.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: colors.noir[800],
    fontFamily: "NotoSerifKR_500Medium",
  },
  content: { padding: 20, paddingBottom: 40 },

  // 요약 카드
  summaryCard: {
    backgroundColor: colors.noir[800],
    borderRadius: 24,
    padding: 24,
    marginBottom: 28,
  },
  summaryBadge: {
    alignSelf: "flex-start",
    backgroundColor: "rgba(255,255,255,0.15)",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    marginBottom: 16,
  },
  summaryBadgeText: { fontSize: 11, fontWeight: "600", color: "rgba(255,255,255,0.8)" },
  summaryTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: "#FFFFFF",
    marginBottom: 20,
    fontFamily: "NotoSerifKR_500Medium",
  },
  summaryRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 16,
  },
  summaryItem: { flex: 1, alignItems: "center" },
  summaryLabel: { fontSize: 13, color: "rgba(255,255,255,0.6)", marginBottom: 4 },
  summaryValue: {
    fontSize: 24,
    fontWeight: "700",
    color: colors.rose[500],
    fontFamily: "CormorantGaramond_600SemiBold",
  },
  summaryDivider: { width: 1, height: 36, backgroundColor: "rgba(255,255,255,0.15)" },
  totalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.15)",
  },
  totalLabel: { fontSize: 15, fontWeight: "500", color: "rgba(255,255,255,0.7)" },
  totalValue: {
    fontSize: 28,
    fontWeight: "700",
    color: colors.gold.DEFAULT,
    fontFamily: "CormorantGaramond_600SemiBold",
  },

  // 섹션
  sectionTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: colors.noir[800],
    marginBottom: 16,
    fontFamily: "NotoSerifKR_500Medium",
  },

  // 가격 카드
  priceCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 20,
    padding: 18,
    marginBottom: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 12,
    elevation: 2,
  },
  priceName: {
    fontSize: 16,
    fontWeight: "700",
    color: colors.noir[800],
    marginBottom: 14,
    fontFamily: "NotoSerifKR_500Medium",
  },
  priceRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 10,
  },
  priceLabel: {
    fontSize: 12,
    color: colors.textSecondary,
    width: 28,
  },
  priceBarTrack: {
    flex: 1,
    height: 10,
    backgroundColor: colors.ivory[200],
    borderRadius: 5,
    overflow: "hidden",
  },
  priceBarFill: {
    height: "100%",
    backgroundColor: colors.rose[500],
    borderRadius: 5,
  },
  priceBarExtra: {
    backgroundColor: colors.taupe[400],
  },
  priceValue: {
    fontSize: 14,
    fontWeight: "700",
    color: colors.noir[800],
    minWidth: 90,
    textAlign: "right",
    fontFamily: "CormorantGaramond_600SemiBold",
  },
  priceNote: {
    fontSize: 12,
    color: colors.textTertiary,
    marginTop: 4,
  },

  disclaimer: {
    fontSize: 12,
    color: colors.textTertiary,
    lineHeight: 18,
    marginTop: 16,
  },
});
