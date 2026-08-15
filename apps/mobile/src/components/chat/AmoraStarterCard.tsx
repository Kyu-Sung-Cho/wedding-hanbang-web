import { Pressable, StyleSheet, Text, View } from "react-native";
import { ArrowRight, SlidersHorizontal } from "lucide-react-native";
import { colors, radius, spacing } from "@hanbang/design-tokens";

import { buildAmoraEntryPlan } from "@/lib/amoraEntryPlan.mjs";

interface AmoraStarterCardProps {
  activeScope: "private" | "shared";
  hasLinkedPartner: boolean;
  disabled?: boolean;
  onSelect: (prompt: string) => void;
  onPersonalize?: () => void;
}

export default function AmoraStarterCard({
  activeScope,
  hasLinkedPartner,
  disabled = false,
  onSelect,
  onPersonalize,
}: AmoraStarterCardProps) {
  const plan = buildAmoraEntryPlan({ activeScope, hasLinkedPartner });
  if (!plan) return null;

  return (
    <View style={styles.container} accessibilityRole="summary">
      <Text style={styles.title}>{plan.title}</Text>
      <Text style={styles.description}>{plan.description}</Text>
      <View style={styles.choices}>
        {plan.starters.map((starter) => (
          <Pressable
            key={starter.id}
            style={({ pressed }) => [
              styles.choice,
              starter.recommended && styles.choiceRecommended,
              pressed && !disabled && styles.choicePressed,
              disabled && styles.choiceDisabled,
            ]}
            onPress={() => onSelect(starter.prompt)}
            disabled={disabled}
            accessibilityRole="button"
            accessibilityLabel={`${starter.recommended ? "추천 시작. " : ""}${starter.label}. 먼저 보낼 문장 채우기`}
            accessibilityState={{ disabled }}
          >
            <View style={styles.choiceCopy}>
              {starter.recommended ? (
                <Text style={styles.recommendedLabel}>추천 시작</Text>
              ) : null}
              <Text style={styles.choiceText}>{starter.label}</Text>
            </View>
            <ArrowRight size={16} color={colors.rose[600]} />
          </Pressable>
        ))}
      </View>
      <Text style={styles.promise}>선택해도 바로 보내지 않아요. 문장을 보고 고칠 수 있어요.</Text>
      {activeScope === "private" && onPersonalize ? (
        <Pressable
          style={({ pressed }) => [
            styles.personalizeButton,
            pressed && !disabled && styles.choicePressed,
            disabled && styles.choiceDisabled,
          ]}
          onPress={onPersonalize}
          disabled={disabled}
          accessibilityRole="button"
          accessibilityLabel="아모라 도움 방식 맞추기. 먼저 들어줄지 바로 행동을 정리할지와 답변 길이를 선택"
          accessibilityState={{ disabled }}
        >
          <SlidersHorizontal size={16} color={colors.sage[500]} />
          <View style={styles.personalizeCopy}>
            <Text style={styles.personalizeLabel}>아모라 도움 방식 맞추기</Text>
            <Text style={styles.personalizeDescription}>두 가지만 고르면 다음 대화부터 반영돼요</Text>
          </View>
          <ArrowRight size={16} color={colors.sage[500]} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: "100%",
    marginTop: spacing[4],
    gap: spacing[2],
  },
  title: {
    textAlign: "center",
    fontSize: 16,
    lineHeight: 24,
    fontFamily: "NotoSansKR_700Bold",
    color: colors.noir[800],
  },
  description: {
    paddingHorizontal: spacing[3],
    textAlign: "center",
    fontSize: 12,
    lineHeight: 19,
    fontFamily: "NotoSansKR_400Regular",
    color: colors.textSecondary,
  },
  choices: {
    marginTop: spacing[2],
    gap: spacing[2],
  },
  choice: {
    minHeight: 48,
    paddingHorizontal: spacing[4],
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing[3],
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
  },
  choicePressed: {
    borderColor: colors.rose[500],
    backgroundColor: colors.rose.pale,
  },
  choiceRecommended: {
    borderColor: colors.rose[500],
    backgroundColor: colors.rose.pale,
  },
  choiceDisabled: {
    opacity: 0.5,
  },
  choiceCopy: {
    flex: 1,
    gap: 2,
  },
  recommendedLabel: {
    fontSize: 10,
    lineHeight: 15,
    fontFamily: "NotoSansKR_600SemiBold",
    color: colors.rose[600],
  },
  choiceText: {
    fontSize: 14,
    lineHeight: 21,
    fontFamily: "NotoSansKR_600SemiBold",
    color: colors.noir[800],
  },
  promise: {
    marginTop: spacing[1],
    textAlign: "center",
    fontSize: 11,
    lineHeight: 17,
    fontFamily: "NotoSansKR_400Regular",
    color: colors.textTertiary,
  },
  personalizeButton: {
    minHeight: 52,
    marginTop: spacing[2],
    paddingHorizontal: spacing[4],
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    borderWidth: 1,
    borderColor: colors.sage.pale,
    borderRadius: radius.lg,
    backgroundColor: colors.ivory[100],
  },
  personalizeCopy: { flex: 1, gap: spacing[1] },
  personalizeLabel: {
    fontSize: 13,
    lineHeight: 19,
    fontFamily: "NotoSansKR_600SemiBold",
    color: colors.noir[800],
  },
  personalizeDescription: {
    fontSize: 11,
    lineHeight: 17,
    fontFamily: "NotoSansKR_400Regular",
    color: colors.textSecondary,
  },
});
