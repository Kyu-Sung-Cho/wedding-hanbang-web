import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors, radius, spacing } from "@hanbang/design-tokens";
import type { AmoraPreparationTopicDetail } from "@hanbang/shared/amora-preparation-topic";

import { ActionRow, AppText, StatusPill } from "@/components/ui/AppUI";
import { AmoraSourceDisclosureView } from "@/components/common/AmoraSourceDisclosureView";
import { buildPreparationTopicPresentation } from "@/lib/preparationTopicPresentation.mjs";
import type {
  PreparationTopicPayerPresentationContext,
  PreparationTopicPresentation,
} from "@/lib/preparationTopicPresentation.mjs";
import type {
  PreparationTopicAmoraHandoff,
  PreparationTopicPersonalizationSection,
} from "@/lib/preparationTopicPersonalization.mjs";

function GuideBulletSection({
  title,
  items,
}: {
  title: string;
  items: readonly string[];
}) {
  return (
    <View style={styles.guideSubsection}>
      <Text style={styles.guideSubsectionTitle} accessibilityRole="header">
        {title}
      </Text>
      {items.map((item) => (
        <View key={item} style={styles.guideBulletRow}>
          <View style={styles.guideBullet} />
          <AppText variant="caption" style={styles.guideBulletText}>
            {item}
          </AppText>
        </View>
      ))}
    </View>
  );
}

function SupportingRecordSections({
  presentation,
}: {
  presentation: PreparationTopicPresentation;
}) {
  return (
    <>
      {presentation.confirmedScheduleSection ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle} accessibilityRole="header">
            {presentation.confirmedScheduleSection.title}
          </Text>
          {presentation.confirmedScheduleSection.items.map((item) => (
            <View
              key={item.id}
              style={styles.confirmedRow}
              accessible
              accessibilityLabel={item.accessibilityLabel}
            >
              <View style={styles.confirmedDot} />
              <View style={styles.confirmedCopy}>
                <AppText variant="bodyStrong">{item.title}</AppText>
                <AppText variant="caption" style={styles.confirmedMeta}>
                  {item.meta}
                </AppText>
              </View>
            </View>
          ))}
          {presentation.confirmedScheduleSection.additionalLabel ? (
            <AppText variant="caption" style={styles.additionalLabel}>
              {presentation.confirmedScheduleSection.additionalLabel}
            </AppText>
          ) : null}
        </View>
      ) : null}

      {presentation.confirmedBudgetSection ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle} accessibilityRole="header">
            {presentation.confirmedBudgetSection.title}
          </Text>
          {presentation.confirmedBudgetSection.items.map((item) => (
            <View
              key={item.key}
              style={styles.confirmedRow}
              accessible
              accessibilityLabel={item.accessibilityLabel}
            >
              <View style={styles.confirmedDot} />
              <View style={styles.confirmedCopy}>
                <AppText variant="bodyStrong">{item.title}</AppText>
                <AppText variant="caption" style={styles.confirmedMeta}>
                  {item.meta}
                </AppText>
              </View>
            </View>
          ))}
          {presentation.confirmedBudgetSection.notice ? (
            <View accessibilityRole="alert">
              <AppText variant="caption" style={styles.savedConversationNotice}>
                {presentation.confirmedBudgetSection.notice}
              </AppText>
            </View>
          ) : null}
        </View>
      ) : null}

      {presentation.catchUpSection ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle} accessibilityRole="header">
            {presentation.catchUpSection.title}
          </Text>
          {presentation.catchUpSection.items.map((item) => (
            <View
              key={item.key}
              style={styles.confirmedRow}
              accessible
              accessibilityLabel={item.accessibilityLabel}
            >
              <View style={styles.confirmedDot} />
              <View style={styles.confirmedCopy}>
                <AppText variant="bodyStrong">{item.title}</AppText>
                <AppText variant="caption" style={styles.confirmedMeta}>
                  {item.meta}
                </AppText>
              </View>
            </View>
          ))}
          {presentation.catchUpSection.notice ? (
            <View accessibilityRole="alert">
              <AppText variant="caption" style={styles.savedConversationNotice}>
                {presentation.catchUpSection.notice}
              </AppText>
            </View>
          ) : null}
        </View>
      ) : null}

      {presentation.completedBookingOutcomeSection ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle} accessibilityRole="header">
            {presentation.completedBookingOutcomeSection.title}
          </Text>
          {presentation.completedBookingOutcomeSection.items.map((item) => (
            <View
              key={item.id}
              style={styles.confirmedRow}
              accessible
              accessibilityLabel={item.accessibilityLabel}
            >
              <View style={styles.confirmedDot} />
              <View style={styles.confirmedCopy}>
                <AppText variant="bodyStrong">{item.title}</AppText>
                <AppText variant="caption" style={styles.confirmedMeta}>
                  {item.detail}
                </AppText>
                <AppText variant="caption" style={styles.confirmedMeta}>
                  {item.amount}
                </AppText>
                <AppText variant="caption" style={styles.confirmedMeta}>
                  {item.meta}
                </AppText>
              </View>
            </View>
          ))}
          {presentation.completedBookingOutcomeSection.additionalLabel ? (
            <AppText variant="caption" style={styles.additionalLabel}>
              {presentation.completedBookingOutcomeSection.additionalLabel}
            </AppText>
          ) : null}
          {presentation.completedBookingOutcomeSection.notice ? (
            <View accessibilityRole="alert">
              <AppText variant="caption" style={styles.savedConversationNotice}>
                {presentation.completedBookingOutcomeSection.notice}
              </AppText>
            </View>
          ) : null}
        </View>
      ) : null}

      {presentation.bookingDecisionSection ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle} accessibilityRole="header">
            {presentation.bookingDecisionSection.title}
          </Text>
          {presentation.bookingDecisionSection.items.map((item) => (
            <View
              key={item.id}
              style={styles.confirmedRow}
              accessible
              accessibilityLabel={item.accessibilityLabel}
            >
              <View style={styles.confirmedDot} />
              <View style={styles.confirmedCopy}>
                <AppText variant="bodyStrong">{item.title}</AppText>
                <AppText variant="caption" style={styles.confirmedMeta}>
                  {item.detail}
                </AppText>
                <AppText variant="caption" style={styles.confirmedMeta}>
                  {item.meta}
                </AppText>
              </View>
            </View>
          ))}
          {presentation.bookingDecisionSection.additionalLabel ? (
            <AppText variant="caption" style={styles.additionalLabel}>
              {presentation.bookingDecisionSection.additionalLabel}
            </AppText>
          ) : null}
          {presentation.bookingDecisionSection.notice ? (
            <AppText variant="caption" style={styles.additionalLabel}>
              {presentation.bookingDecisionSection.notice}
            </AppText>
          ) : null}
        </View>
      ) : null}
    </>
  );
}

export default function PreparationTopicSummary({
  view,
  messageReferenceRead,
  payerPresentationContext,
  personalizationSection,
  amoraHandoff,
  onOpenBudget,
  onOpenSavedConversation,
  onContinueWithAmora,
}: {
  view: AmoraPreparationTopicDetail | null;
  messageReferenceRead?: NonNullable<
    Parameters<typeof buildPreparationTopicPresentation>[1]
  >;
  payerPresentationContext?: PreparationTopicPayerPresentationContext | null;
  personalizationSection?: PreparationTopicPersonalizationSection | null;
  amoraHandoff?: PreparationTopicAmoraHandoff | null;
  onOpenBudget?: (categoryKey: string) => void;
  onOpenSavedConversation?: (topicMessageRefId: string) => void;
  onContinueWithAmora?: (handoff: PreparationTopicAmoraHandoff) => void;
}) {
  const [expandedSavedConversations, setExpandedSavedConversations] = useState(false);
  const [expandedGuide, setExpandedGuide] = useState(false);
  useEffect(() => {
    setExpandedSavedConversations(false);
    setExpandedGuide(false);
  }, [view?.topicKey, view?.guideModules?.[0]?.moduleId]);

  const presentation = buildPreparationTopicPresentation(
    view,
    messageReferenceRead,
    payerPresentationContext,
  );
  if (!presentation) return null;
  const budgetAction = presentation.budgetAction;
  const guideSection = presentation.guideSection;
  const savedConversationSection = presentation.savedConversationSection;
  const visibleSavedConversations = savedConversationSection?.items.slice(
    0,
    expandedSavedConversations
      ? savedConversationSection.items.length
      : savedConversationSection.initialVisibleCount,
  ) ?? [];

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerCopy}>
          <AppText variant="eyebrow">우리 준비 상태</AppText>
          <AppText variant="caption" style={styles.progressText}>
            {presentation.progressLabel}
          </AppText>
        </View>
        <StatusPill
          label={presentation.statusLabel}
          tone={presentation.statusTone}
        />
      </View>

      {presentation.nextAction ? (
        <View style={styles.nextAction} accessibilityRole="summary">
          <AppText variant="eyebrow">{presentation.nextAction.eyebrow}</AppText>
          <AppText variant="bodyStrong">{presentation.nextAction.title}</AppText>
          <AppText variant="caption" style={styles.nextActionReason}>
            {presentation.nextAction.reason}
          </AppText>
          <AppText variant="caption" style={styles.completionCriterion}>
            끝나는 기준 · {presentation.nextAction.completionCriterion}
          </AppText>
          {presentation.actionReadNotice ? (
            <View accessibilityRole="alert" style={styles.actionReadNotice}>
              <AppText variant="caption" style={styles.actionReadNoticeText}>
                {presentation.actionReadNotice}
              </AppText>
            </View>
          ) : null}
        </View>
      ) : null}

      {personalizationSection ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle} accessibilityRole="header">
            {personalizationSection.title}
          </Text>
          {personalizationSection.items.map((item) => (
            <View
              key={item.key}
              style={styles.personalizationRow}
              accessible
              accessibilityLabel={item.accessibilityLabel}
            >
              <View style={styles.personalizationCopy}>
                <AppText variant="bodyStrong">{item.title}</AppText>
                <AppText variant="caption" style={styles.personalizationDetail}>
                  {item.detail}
                </AppText>
              </View>
              <AppText variant="caption" style={styles.personalizationScope}>
                {item.scopeLabel}
              </AppText>
            </View>
          ))}
          {personalizationSection.notices.map((notice) => (
            <View key={notice} accessibilityRole="alert">
              <AppText variant="caption" style={styles.personalizationNotice}>
                {notice}
              </AppText>
            </View>
          ))}
          {personalizationSection.note ? (
            <AppText variant="caption" style={styles.personalizationNote}>
              {personalizationSection.note}
            </AppText>
          ) : null}
        </View>
      ) : null}

      {presentation.evidenceLines.length > 0 ? (
        <View style={styles.section}>
          <AppText variant="bodyStrong">{presentation.evidenceTitle}</AppText>
          {presentation.evidenceLines.map((line, index) => (
            <View key={`${index}:${line}`} style={styles.evidenceRow}>
              <View style={styles.evidenceDot} />
              <AppText variant="caption" style={styles.evidenceText}>
                {line}
              </AppText>
            </View>
          ))}
        </View>
      ) : null}

      {presentation.remainingLabel ? (
        <AppText variant="caption" style={styles.remainingText}>
          {presentation.remainingLabel}
        </AppText>
      ) : null}

      {guideSection ? (
        <View style={styles.guideSection}>
          <Pressable
            style={({ pressed }) => [
              styles.guideToggle,
              pressed && styles.guideTogglePressed,
            ]}
            onPress={() => setExpandedGuide((current) => !current)}
            accessibilityRole="button"
            accessibilityLabel={guideSection.accessibilityLabel}
            accessibilityHint={expandedGuide
              ? "가이드 내용을 접습니다"
              : "가이드 내용을 펼칩니다"}
            accessibilityState={{ expanded: expandedGuide }}
          >
            <View style={styles.guideToggleCopy}>
              <AppText variant="eyebrow">{guideSection.eyebrow}</AppText>
              <AppText variant="bodyStrong">{guideSection.title}</AppText>
              <AppText variant="caption" style={styles.guideWhyShown}>
                {guideSection.whyShown}
              </AppText>
            </View>
            <AppText variant="caption" style={styles.guideToggleLabel}>
              {expandedGuide ? "접기" : "보기"}
            </AppText>
          </Pressable>

          {expandedGuide ? (
            <View style={styles.guideBody}>
              <GuideBulletSection
                title="먼저 맞출 것"
                items={guideSection.decisions}
              />
              <GuideBulletSection
                title="놓치기 쉬운 경우"
                items={guideSection.exceptions}
              />
              <View style={styles.guideSubsection}>
                <Text style={styles.guideSubsectionTitle} accessibilityRole="header">
                  이렇게 물어보세요
                </Text>
                {guideSection.dialogueLines.map((line) => (
                  <View key={`${line.say}:${line.note ?? ""}`} style={styles.guideDialogue}>
                    <AppText variant="bodyStrong">“{line.say}”</AppText>
                    {line.note ? (
                      <AppText variant="caption" style={styles.guideDialogueNote}>
                        {line.note}
                      </AppText>
                    ) : null}
                  </View>
                ))}
              </View>
              <GuideBulletSection
                title="끝났다고 확인할 것"
                items={guideSection.completionEvidence}
              />
              <View style={styles.guideProvenance}>
                <AmoraSourceDisclosureView
                  disclosure={guideSection.sourceDisclosure}
                  showDetails
                />
                <AppText variant="caption" style={styles.guideProvenanceTitle}>
                  {guideSection.provenance.sourceLabel}
                </AppText>
                <AppText variant="caption" style={styles.guideProvenanceText}>
                  {guideSection.provenance.reviewedLabel}
                </AppText>
                <AppText variant="caption" style={styles.guideProvenanceText}>
                  {guideSection.provenance.scopeLabel}
                </AppText>
                {guideSection.provenance.limitations.map((limitation) => (
                  <AppText
                    key={limitation}
                    variant="caption"
                    style={styles.guideProvenanceText}
                  >
                    · {limitation}
                  </AppText>
                ))}
              </View>
            </View>
          ) : null}
        </View>
      ) : null}

      {savedConversationSection ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle} accessibilityRole="header">
            {savedConversationSection.title}
          </Text>
          {savedConversationSection.notice ? (
            <View accessibilityRole="alert">
              <AppText variant="caption" style={styles.savedConversationNotice}>
                {savedConversationSection.notice}
              </AppText>
            </View>
          ) : null}
          {visibleSavedConversations.map((item) => (
            <Pressable
              key={item.refId}
              style={({ pressed }) => [
                styles.savedConversationRow,
                pressed && styles.savedConversationRowPressed,
              ]}
              onPress={() => onOpenSavedConversation?.(item.refId)}
              disabled={!onOpenSavedConversation}
              accessibilityRole="button"
              accessibilityLabel={item.accessibilityLabel}
              accessibilityHint="저장한 대화의 정확한 원문으로 이동합니다"
              accessibilityState={{ disabled: !onOpenSavedConversation }}
            >
              <View style={styles.savedConversationCopy}>
                <AppText variant="caption" numberOfLines={2}>
                  {item.excerpt}
                </AppText>
                <AppText variant="caption" style={styles.savedConversationMeta}>
                  {item.meta}
                </AppText>
              </View>
            </Pressable>
          ))}
          {savedConversationSection.items.length
            > savedConversationSection.initialVisibleCount ? (
            <Pressable
              style={styles.savedConversationToggle}
              onPress={() => setExpandedSavedConversations((current) => !current)}
              accessibilityRole="button"
              accessibilityLabel={expandedSavedConversations
                ? "저장한 대화 접기"
                : `저장한 대화 ${savedConversationSection.items.length - savedConversationSection.initialVisibleCount}개 더 보기`}
              accessibilityState={{ expanded: expandedSavedConversations }}
            >
              <AppText variant="caption" style={styles.savedConversationToggleText}>
                {expandedSavedConversations
                  ? "접기"
                  : `${savedConversationSection.items.length - savedConversationSection.initialVisibleCount}개 더 보기`}
              </AppText>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      <SupportingRecordSections presentation={presentation} />

      {budgetAction ? (
        budgetAction.canOpen ? (
          <ActionRow
            title={budgetAction.title}
            description={budgetAction.description ?? undefined}
            onPress={() => onOpenBudget?.(budgetAction.categoryKey)}
            disabled={!onOpenBudget}
          />
        ) : (
          <View style={styles.planNotice} accessibilityRole="alert">
            <AppText variant="bodyStrong">
              {budgetAction.title}
            </AppText>
            {budgetAction.description ? (
              <AppText variant="caption" style={styles.planNoticeText}>
                {budgetAction.description}
              </AppText>
            ) : null}
          </View>
        )
      ) : null}

      {amoraHandoff ? (
        <ActionRow
          title={amoraHandoff.title}
          description={amoraHandoff.description}
          onPress={() => onContinueWithAmora?.(amoraHandoff)}
          disabled={!onContinueWithAmora}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing[3],
    paddingVertical: spacing[4],
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: colors.border,
  },
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: spacing[3],
  },
  headerCopy: {
    flex: 1,
    gap: spacing[1],
  },
  progressText: {
    color: colors.textSecondary,
  },
  section: {
    gap: spacing[2],
  },
  sectionTitle: {
    fontSize: 15,
    lineHeight: 22,
    fontFamily: "NotoSansKR_600SemiBold",
    color: colors.noir[800],
  },
  personalizationRow: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing[3],
    paddingVertical: spacing[1],
  },
  personalizationCopy: {
    flex: 1,
    gap: spacing[1],
  },
  personalizationDetail: {
    color: colors.textSecondary,
  },
  personalizationScope: {
    color: colors.rose[600],
  },
  personalizationNotice: {
    color: colors.textSecondary,
  },
  personalizationNote: {
    color: colors.textTertiary,
  },
  confirmedRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing[2],
  },
  confirmedDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginTop: 8,
    backgroundColor: colors.rose[500],
  },
  confirmedCopy: {
    flex: 1,
    gap: spacing[1],
  },
  confirmedMeta: {
    color: colors.textTertiary,
  },
  additionalLabel: {
    color: colors.textSecondary,
    paddingLeft: spacing[4],
  },
  savedConversationRow: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: spacing[2],
    paddingHorizontal: spacing[2],
    borderRadius: radius.lg,
    backgroundColor: colors.ivory[100],
  },
  savedConversationRowPressed: {
    opacity: 0.72,
  },
  savedConversationCopy: {
    flex: 1,
    gap: spacing[1],
  },
  savedConversationMeta: {
    color: colors.textTertiary,
  },
  savedConversationNotice: {
    color: colors.textSecondary,
  },
  savedConversationToggle: {
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
  },
  savedConversationToggleText: {
    color: colors.rose[600],
  },
  evidenceRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing[2],
  },
  evidenceDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginTop: 6,
    backgroundColor: colors.sage[500],
  },
  evidenceText: {
    flex: 1,
    color: colors.textSecondary,
  },
  remainingText: {
    color: colors.textSecondary,
  },
  planNotice: {
    gap: spacing[1],
    paddingVertical: spacing[2],
  },
  planNoticeText: {
    color: colors.textSecondary,
  },
  nextAction: {
    gap: spacing[1],
    paddingVertical: spacing[4],
    paddingHorizontal: spacing[4],
    borderLeftWidth: 3,
    borderLeftColor: colors.rose[500],
    borderRadius: radius.lg,
    backgroundColor: colors.ivory[100],
  },
  nextActionReason: {
    color: colors.textSecondary,
  },
  completionCriterion: {
    color: colors.sage[500],
  },
  actionReadNotice: {
    marginTop: spacing[2],
    paddingTop: spacing[2],
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  actionReadNoticeText: {
    color: colors.textSecondary,
  },
  guideSection: {
    gap: spacing[3],
    paddingTop: spacing[3],
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  guideToggle: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
  },
  guideTogglePressed: {
    opacity: 0.72,
  },
  guideToggleCopy: {
    flex: 1,
    gap: spacing[1],
  },
  guideWhyShown: {
    color: colors.textSecondary,
  },
  guideToggleLabel: {
    color: colors.rose[600],
  },
  guideBody: {
    gap: spacing[4],
  },
  guideSubsection: {
    gap: spacing[2],
  },
  guideSubsectionTitle: {
    fontSize: 14,
    lineHeight: 21,
    fontFamily: "NotoSansKR_600SemiBold",
    color: colors.noir[800],
  },
  guideBulletRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing[2],
  },
  guideBullet: {
    width: 5,
    height: 5,
    borderRadius: 3,
    marginTop: 7,
    backgroundColor: colors.rose[500],
  },
  guideBulletText: {
    flex: 1,
    color: colors.textSecondary,
  },
  guideDialogue: {
    gap: spacing[1],
    paddingVertical: spacing[2],
    paddingHorizontal: spacing[3],
    borderLeftWidth: 2,
    borderLeftColor: colors.rose[500],
    backgroundColor: colors.ivory[100],
  },
  guideDialogueNote: {
    color: colors.textSecondary,
  },
  guideProvenance: {
    gap: spacing[1],
    paddingTop: spacing[3],
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  guideProvenanceTitle: {
    color: colors.noir[800],
  },
  guideProvenanceText: {
    color: colors.textTertiary,
  },
});
