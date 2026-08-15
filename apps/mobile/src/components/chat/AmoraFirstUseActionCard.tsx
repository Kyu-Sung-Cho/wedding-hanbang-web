import { Pressable, StyleSheet, Text, View } from "react-native";
import { ArrowRight, Lock, Pencil } from "lucide-react-native";
import { colors, radius, spacing } from "@hanbang/design-tokens";

import {
  getReviewedActionContinuationPresentation,
  type GroundedFirstUseActionDraft,
} from "@/lib/amoraEntryPlan.mjs";
import {
  getFirstUsePromotionPresentation,
  type FirstUsePromotionUiStatus,
} from "@/lib/amoraFirstUsePromotion.mjs";

interface AmoraFirstUseActionCardProps {
  draft: Readonly<GroundedFirstUseActionDraft>;
  disabled?: boolean;
  correctionDisabled?: boolean;
  skipped?: boolean;
  promotionStatus?: FirstUsePromotionUiStatus | null;
  onContinue: (draft: Readonly<GroundedFirstUseActionDraft>) => void;
  onRecovery: () => void;
  onCorrect: () => void;
  onSkip: () => void;
  onRestore: () => void;
}

export default function AmoraFirstUseActionCard({
  draft,
  disabled = false,
  correctionDisabled = false,
  skipped = false,
  promotionStatus = null,
  onContinue,
  onRecovery,
  onCorrect,
  onSkip,
  onRestore,
}: AmoraFirstUseActionCardProps) {
  if (skipped) {
    return (
      <View style={styles.container} accessibilityRole="summary">
        <Text style={styles.skippedTitle}>이번 제안은 넘겼어요</Text>
        <Text style={styles.skippedCopy}>저장하거나 공유한 내용은 없어요.</Text>
        <Pressable
          style={({ pressed }) => [
            styles.restoreButton,
            pressed && styles.correctionButtonPressed,
          ]}
          onPress={onRestore}
          accessibilityRole="button"
          accessibilityLabel="넘긴 개인화 제안 다시 보기"
        >
          <Text style={styles.correctionButtonText}>다시 보기</Text>
        </Pressable>
      </View>
    );
  }

  const promotionPresentation = promotionStatus
    ? getFirstUsePromotionPresentation(promotionStatus)
    : null;
  const primaryDisabled = promotionPresentation
    ? promotionPresentation.recovery === "none"
      || (promotionPresentation.recovery === "retry" && disabled)
      || (promotionPresentation.recovery === "correct" && correctionDisabled)
    : disabled;
  const primaryAction = promotionPresentation
    && promotionPresentation.recovery !== "none"
    ? onRecovery
    : () => onContinue(draft);
  const continuationPresentation = getReviewedActionContinuationPresentation();
  const primaryLabel = promotionPresentation?.actionLabel
    ?? continuationPresentation.label;

  return (
    <View style={styles.container} accessibilityRole="summary">
      <View style={styles.privateLabel} accessibilityElementsHidden>
        <Lock size={13} color={colors.sage[500]} />
        <Text style={styles.privateLabelText}>나만 상담에서 정리했어요</Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.label}>지금 할 한 가지</Text>
        <Text style={styles.value}>{draft.action}</Text>
      </View>
      <View style={styles.section}>
        <Text style={styles.label}>이유</Text>
        <Text style={styles.value}>{draft.reason}</Text>
      </View>
      <View style={styles.section}>
        <Text style={styles.label}>완료 기준</Text>
        <Text style={styles.value}>{draft.completionCriterion}</Text>
      </View>

      {(draft.assumptions.length > 0 || draft.unknowns.length > 0) && (
        <View style={styles.contextSection}>
          {draft.assumptions.length > 0 && (
            <View style={styles.contextGroup}>
              <Text style={styles.contextLabel}>아모라가 이렇게 이해했어요</Text>
              {draft.assumptions.map((item, index) => (
                <View key={`assumption-${index}`} style={styles.contextRow}>
                  <Text style={styles.contextBullet}>•</Text>
                  <Text style={styles.contextValue}>{item}</Text>
                </View>
              ))}
            </View>
          )}
          {draft.unknowns.length > 0 && (
            <View style={styles.contextGroup}>
              <Text style={styles.contextLabel}>아직 같이 확인할 것</Text>
              {draft.unknowns.map((item, index) => (
                <View key={`unknown-${index}`} style={styles.contextRow}>
                  <Text style={styles.contextBullet}>•</Text>
                  <Text style={styles.contextValue}>{item}</Text>
                </View>
              ))}
            </View>
          )}
          <Text style={styles.contextPromise}>
            다르거나 바뀐 내용이 있으면 바로 고쳐주세요.
          </Text>
        </View>
      )}

      <Text style={styles.privacyCopy}>
        {continuationPresentation.scopeCopy}
      </Text>
      {promotionPresentation && (
        <View
          style={styles.promotionNotice}
          accessible
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
        >
          <Text style={styles.promotionNoticeText}>
            {promotionPresentation.message}
          </Text>
        </View>
      )}
      <Pressable
        style={({ pressed }) => [
          styles.button,
          pressed && !primaryDisabled && styles.buttonPressed,
          primaryDisabled && styles.buttonDisabled,
        ]}
        onPress={primaryAction}
        disabled={primaryDisabled}
        accessibilityRole="button"
        accessibilityLabel={promotionPresentation
          ? primaryLabel
          : continuationPresentation.accessibilityLabel}
        accessibilityHint={promotionPresentation
          ? promotionPresentation.message
          : continuationPresentation.accessibilityHint}
        accessibilityState={{ disabled: primaryDisabled }}
      >
        <Text style={styles.buttonText}>{primaryLabel}</Text>
        <ArrowRight size={17} color={colors.surface} />
      </Pressable>
      <Text style={styles.promise}>
        {continuationPresentation.promise}
      </Text>
      <View style={styles.choiceRow}>
        <Pressable
          style={({ pressed }) => [
            styles.correctionButton,
            pressed && !correctionDisabled && styles.correctionButtonPressed,
            correctionDisabled && styles.buttonDisabled,
          ]}
          onPress={onCorrect}
          disabled={correctionDisabled}
          accessibilityRole="button"
          accessibilityLabel="아모라가 이해한 내용 고치기"
          accessibilityHint="나만 상담 입력창에 수정 문장을 채우며 자동으로 보내지 않습니다"
          accessibilityState={{ disabled: correctionDisabled }}
        >
          <Pencil size={15} color={colors.noir[800]} />
          <Text style={styles.correctionButtonText}>조금 바꿀래요</Text>
        </Pressable>
        <Pressable
          style={({ pressed }) => [
            styles.skipButton,
            pressed && styles.correctionButtonPressed,
          ]}
          onPress={onSkip}
          accessibilityRole="button"
          accessibilityLabel="이번 개인화 제안 넘기기"
          accessibilityHint="저장하거나 공유하지 않고 이 카드만 접습니다"
        >
          <Text style={styles.skipButtonText}>지금은 아니에요</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginTop: spacing[3],
    padding: spacing[4],
    gap: spacing[3],
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    backgroundColor: colors.ivory[100],
  },
  privateLabel: {
    alignSelf: "flex-start",
    minHeight: 28,
    paddingHorizontal: spacing[2],
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[1],
    borderRadius: radius.full,
    backgroundColor: colors.sage.pale,
  },
  privateLabelText: {
    fontSize: 11,
    lineHeight: 16,
    fontFamily: "NotoSansKR_600SemiBold",
    color: colors.noir[800],
  },
  section: {
    gap: spacing[1],
  },
  label: {
    fontSize: 11,
    lineHeight: 16,
    fontFamily: "NotoSansKR_600SemiBold",
    color: colors.textSecondary,
  },
  value: {
    fontSize: 14,
    lineHeight: 21,
    fontFamily: "NotoSansKR_500Medium",
    color: colors.noir[800],
  },
  contextSection: {
    paddingVertical: spacing[3],
    gap: spacing[3],
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: colors.border,
  },
  contextGroup: {
    gap: spacing[1],
  },
  contextLabel: {
    fontSize: 11,
    lineHeight: 16,
    fontFamily: "NotoSansKR_600SemiBold",
    color: colors.noir[800],
  },
  contextRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing[2],
  },
  contextBullet: {
    width: spacing[2],
    fontSize: 14,
    lineHeight: 20,
    fontFamily: "NotoSansKR_500Medium",
    color: colors.sage[500],
  },
  contextValue: {
    flex: 1,
    fontSize: 12,
    lineHeight: 19,
    fontFamily: "NotoSansKR_400Regular",
    color: colors.textSecondary,
  },
  contextPromise: {
    fontSize: 11,
    lineHeight: 17,
    fontFamily: "NotoSansKR_400Regular",
    color: colors.textTertiary,
  },
  correctionButton: {
    flex: 1,
    minHeight: 44,
    paddingHorizontal: spacing[3],
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing[2],
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
  },
  correctionButtonPressed: {
    opacity: 0.78,
  },
  correctionButtonText: {
    fontSize: 12,
    lineHeight: 18,
    fontFamily: "NotoSansKR_600SemiBold",
    color: colors.noir[800],
  },
  privacyCopy: {
    fontSize: 11,
    lineHeight: 17,
    fontFamily: "NotoSansKR_400Regular",
    color: colors.textSecondary,
  },
  promotionNotice: {
    padding: spacing[3],
    borderWidth: 1,
    borderColor: colors.sage.pale,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  promotionNoticeText: {
    fontSize: 12,
    lineHeight: 19,
    fontFamily: "NotoSansKR_500Medium",
    color: colors.noir[800],
  },
  button: {
    minHeight: 48,
    paddingHorizontal: spacing[4],
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing[2],
    borderRadius: radius.lg,
    backgroundColor: colors.noir[800],
  },
  buttonPressed: {
    opacity: 0.84,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonText: {
    fontSize: 13,
    lineHeight: 19,
    fontFamily: "NotoSansKR_600SemiBold",
    color: colors.surface,
  },
  promise: {
    textAlign: "center",
    fontSize: 10,
    lineHeight: 15,
    fontFamily: "NotoSansKR_400Regular",
    color: colors.textTertiary,
  },
  choiceRow: {
    flexDirection: "row",
    gap: spacing[2],
  },
  skipButton: {
    flex: 1,
    minHeight: 44,
    paddingHorizontal: spacing[3],
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.lg,
  },
  skipButtonText: {
    fontSize: 12,
    lineHeight: 18,
    fontFamily: "NotoSansKR_600SemiBold",
    color: colors.textSecondary,
  },
  skippedTitle: {
    fontSize: 14,
    lineHeight: 21,
    fontFamily: "NotoSansKR_600SemiBold",
    color: colors.noir[800],
  },
  skippedCopy: {
    fontSize: 12,
    lineHeight: 19,
    fontFamily: "NotoSansKR_400Regular",
    color: colors.textSecondary,
  },
  restoreButton: {
    minHeight: 44,
    paddingHorizontal: spacing[3],
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
  },
});
