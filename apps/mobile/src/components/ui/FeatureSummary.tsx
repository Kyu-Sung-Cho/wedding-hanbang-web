/**
 * 기능 첫 화면의 요약 면과 그 안의 상태 알약.
 *
 * 웹 `FEATURE_SUMMARY_CLASS`(샴페인 면 · 3px 위 선 · 16px 모서리)와 같은 모양이다. 수치·빈 상태·
 * 편집·이동은 각 화면이 가진다 — 여기는 표시만 공유한다. 색 근거는 `@/lib/featureSummaryPalette`.
 */
import type { ReactNode } from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { radius, spacing } from "@hanbang/design-tokens";
import { Text } from "@/components/ui/AppText";
import {
  summaryColors,
  summaryPillColors,
  type SummaryPillTone,
} from "@/lib/featureSummaryPalette";

export { summaryColors, summaryPillColors, type SummaryPillTone };

export function FeatureSummarySurface({
  children,
  style,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return <View style={[styles.surface, style]}>{children}</View>;
}

export function SummaryPill({
  label,
  tone = "neutral",
}: {
  label: string;
  tone?: SummaryPillTone;
}) {
  const palette = summaryPillColors[tone];
  return (
    <View style={[styles.pill, { backgroundColor: palette.background }]}>
      <Text style={[styles.pillText, { color: palette.text }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  surface: {
    // 웹 `rounded-2xl` 은 16px 이다. 토큰 이름이 달라 `xl` 을 쓴다.
    borderRadius: radius.xl,
    padding: spacing[5],
    borderWidth: 1,
    borderTopWidth: 3,
    borderColor: summaryColors.line,
    borderTopColor: summaryColors.accent,
    backgroundColor: summaryColors.surface,
  },
  pill: {
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: summaryColors.line,
    paddingHorizontal: spacing[2],
    paddingVertical: 3,
  },
  pillText: {
    fontSize: 12,
    lineHeight: 18,
    fontFamily: "NotoSansKR_600SemiBold",
  },
});
