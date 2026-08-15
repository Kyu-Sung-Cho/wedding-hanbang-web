import { useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { CheckCircle2, LockKeyhole, Sparkles, X } from "lucide-react-native";
import { colors, radius, spacing } from "@hanbang/design-tokens";
import {
  TODAY_ONE_CARE_V2_BLOCKER_CHOICES,
  type TodayOneCareV2BlockerCode,
  type TodayOneCareV2Card,
  type TodayOneCareV2Outcome,
  type TodayOneCareV2OutcomeReceipt,
} from "@hanbang/shared";

import { appShadow, PrimaryButton } from "@/components/ui/AppUI";
import { getActionFollowUpOutcomePresentation } from "@/lib/amoraActionFollowUp.mjs";

const VISIBLE_OUTCOMES = [
  { outcome: "completed", label: "끝냈어요" },
  { outcome: "blocked", label: "막혔어요" },
  { outcome: "changed", label: "내용이 바뀌었어요" },
  { outcome: "not_sure", label: "아직 모르겠어요" },
] as const satisfies readonly { outcome: TodayOneCareV2Outcome; label: string }[];

type Selection =
  | { kind: "confirmation"; outcome: "completed" | "changed" }
  | { kind: "blocker" }
  | null;

interface AmoraActionFollowUpCardProps {
  card: TodayOneCareV2Card;
  whyNow?: string;
  pendingOutcome?: TodayOneCareV2Outcome | null;
  receipt?: TodayOneCareV2OutcomeReceipt | null;
  receiptAcknowledgementPending?: boolean;
  error?: string | null;
  onAcknowledgeReceipt?: () => void | Promise<void>;
  onPrivateRescue?: () => void;
  onPersonalizeAfterBlocked?: () => void;
  onPersonalizeAfterUncertain?: () => void;
  onPersonalizeAfterChanged?: () => void;
  onPersonalizeAfterCompleted?: () => void;
  onSubmit: (
    outcome: TodayOneCareV2Outcome,
    blockerCode: TodayOneCareV2BlockerCode | null,
    confirmed: boolean,
  ) => void | Promise<void>;
}

function receiptMessage(receipt: TodayOneCareV2OutcomeReceipt): string {
  if (receipt.outcome === "completed") return "완료로 기록했어요.";
  if (receipt.outcome === "changed") return "바뀐 상태를 기록했어요. 기존 행동은 그대로 열어둬요.";
  if (receipt.outcome === "blocked") return "막힘을 기록했어요. 행동은 그대로 열어뒀어요.";
  return "아직 모름으로 기록했어요. 행동은 그대로 열어뒀어요.";
}

export default function AmoraActionFollowUpCard({
  card,
  whyNow = card.whyNow,
  pendingOutcome = null,
  receipt = null,
  receiptAcknowledgementPending = false,
  error = null,
  onAcknowledgeReceipt,
  onPrivateRescue,
  onPersonalizeAfterBlocked,
  onPersonalizeAfterUncertain,
  onPersonalizeAfterChanged,
  onPersonalizeAfterCompleted,
  onSubmit,
}: AmoraActionFollowUpCardProps) {
  const [selection, setSelection] = useState<Selection>(null);
  const pending = pendingOutcome !== null || receiptAcknowledgementPending;
  const { height: windowHeight } = useWindowDimensions();
  const safeAreaInsets = useSafeAreaInsets();
  const modalTopPadding = Math.max(safeAreaInsets.top, spacing[4]);
  const modalBottomPadding = Math.max(safeAreaInsets.bottom, spacing[4]);
  const sheetMaxHeight = Math.max(
    1,
    windowHeight - modalTopPadding - modalBottomPadding,
  );

  function chooseOutcome(outcome: TodayOneCareV2Outcome) {
    if (pending) return;
    const presentation = getActionFollowUpOutcomePresentation(outcome);
    if (!presentation) return;
    if (outcome === "blocked") {
      setSelection({ kind: "blocker" });
      return;
    }
    if (
      presentation.requiresConfirmation
      && (outcome === "completed" || outcome === "changed")
    ) {
      setSelection({ kind: "confirmation", outcome });
      return;
    }
    void onSubmit(outcome, null, false);
  }

  function submitBlocker(blockerCode: TodayOneCareV2BlockerCode) {
    if (pending) return;
    setSelection(null);
    void onSubmit("blocked", blockerCode, false);
  }

  function confirmMutation() {
    if (pending || selection?.kind !== "confirmation") return;
    const { outcome } = selection;
    setSelection(null);
    void onSubmit(outcome, null, true);
  }

  if (receipt) {
    const personalizationPrompt = receipt.outcome === "completed" && onPersonalizeAfterCompleted
      ? {
          onPress: onPersonalizeAfterCompleted,
          title: "다음 준비도 우리 방식에 맞출까요?",
          buttonLabel: "협업 방식 맞추기",
          accessibilityLabel: "다음 준비의 협업 방식 맞추기",
        }
      : receipt.outcome === "blocked" && onPersonalizeAfterBlocked
      ? {
          onPress: onPersonalizeAfterBlocked,
          title: "다음에는 더 맞게 도울까요?",
          buttonLabel: "다음부터 도와주는 순서 맞추기",
          accessibilityLabel: "막혔을 때 아모라가 도와주는 순서 맞추기",
        }
      : receipt.outcome === "changed" && onPersonalizeAfterChanged
        ? {
            onPress: onPersonalizeAfterChanged,
            title: "다음 변경은 더 편하게 볼까요?",
            buttonLabel: "변경 영향 보기 방식 맞추기",
            accessibilityLabel: "내용이 바뀌었을 때 아모라의 변경 영향 보기 방식 맞추기",
          }
        : receipt.outcome === "not_sure" && onPersonalizeAfterUncertain
          ? {
            onPress: onPersonalizeAfterUncertain,
            title: "다음 결정은 더 쉽게 시작할까요?",
            buttonLabel: "결정 시작 방식 맞추기",
            accessibilityLabel: "아직 모를 때 아모라의 결정 시작 방식 맞추기",
          }
          : null;

    return (
      <View style={styles.receiptCard} accessibilityRole="summary">
        <View style={styles.receiptIcon} accessibilityElementsHidden>
          <CheckCircle2 size={20} color={colors.sage[500]} />
        </View>
        <View style={styles.receiptCopy}>
          <Text style={styles.receiptTitle}>서버 기록을 다시 확인했어요</Text>
          <Text style={styles.receiptText}>{receiptMessage(receipt)}</Text>
          <Text style={styles.receiptMeta}>행동 기록 {receipt.actionRevision} · 확인된 영수증</Text>
          {(
            receipt.outcome === "completed"
            || receipt.outcome === "blocked"
            || receipt.outcome === "changed"
            || receipt.outcome === "not_sure"
          )
            && onPrivateRescue ? (
            <Pressable
              onPress={onPrivateRescue}
              disabled={pending}
              style={({ pressed }) => [
                styles.rescueButton,
                pressed && !pending && styles.pressed,
                pending && styles.disabled,
              ]}
              accessibilityRole="button"
              accessibilityState={{ disabled: pending }}
            >
              <Text style={styles.rescueText}>
                {receipt.outcome === "completed"
                  ? "다음 한 가지 정하기"
                  : receipt.outcome === "blocked"
                    ? "아모라와 해결 방법 정리하기"
                    : receipt.outcome === "changed"
                      ? "바뀐 내용 정리하기"
                      : "먼저 확인할 것 찾기"}
              </Text>
            </Pressable>
          ) : null}
          {personalizationPrompt ? (
            <View style={styles.personalizationPrompt}>
              <Text style={styles.personalizationTitle}>{personalizationPrompt.title}</Text>
              <Text style={styles.personalizationDescription}>
                선택하기 전에는 도움 방식을 바꾸지 않아요.
              </Text>
              <Pressable
                onPress={personalizationPrompt.onPress}
                disabled={pending}
                style={({ pressed }) => [
                  styles.personalizationButton,
                  pressed && !pending && styles.pressed,
                  pending && styles.disabled,
                ]}
                accessibilityRole="button"
                accessibilityLabel={personalizationPrompt.accessibilityLabel}
                accessibilityState={{ disabled: pending }}
              >
                <Text style={styles.personalizationButtonText}>
                  {personalizationPrompt.buttonLabel}
                </Text>
              </Pressable>
            </View>
          ) : null}
          {onAcknowledgeReceipt ? (
            <Pressable
              onPress={() => void onAcknowledgeReceipt()}
              disabled={receiptAcknowledgementPending}
              style={({ pressed }) => [
                styles.receiptContinueButton,
                pressed && !receiptAcknowledgementPending && styles.pressed,
                receiptAcknowledgementPending && styles.disabled,
              ]}
              accessibilityRole="button"
              accessibilityState={{ disabled: receiptAcknowledgementPending }}
            >
              {receiptAcknowledgementPending ? (
                <ActivityIndicator size="small" color={colors.sage[500]} />
              ) : null}
              <Text style={styles.receiptContinueText}>
                {receiptAcknowledgementPending
                  ? "다음 준비를 불러오는 중이에요"
                  : "확인했어요 · 다음 준비 보기"}
              </Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    );
  }

  return (
    <View style={styles.card} accessibilityLabel="아모라 행동 후속 확인">
      <View style={styles.header}>
        <View style={styles.eyebrowRow}>
          <Sparkles size={15} color={colors.ivory[100]} />
          <Text style={styles.eyebrow}>AMORA · 함께 마무리하기</Text>
        </View>
        <Text style={styles.title}>{card.title}</Text>
        <Text style={styles.whyNow}>{whyNow}</Text>
      </View>

      <View style={styles.body}>
        <Text style={styles.revisionText}>
          행동 기록 {card.sourceRevision} 기준 · 선택 전에는 아무것도 바꾸지 않아요
        </Text>
        <View style={styles.factBlock}>
          <Text style={styles.blockTitle}>확인된 내용</Text>
          {card.confirmed.map((item) => (
            <Text key={item} style={styles.factText}>· {item}</Text>
          ))}
        </View>
        {card.unknown.length > 0 ? (
          <View style={styles.unknownBlock}>
            <Text style={styles.blockTitle}>아직 확인되지 않은 점</Text>
            {card.unknown.map((item) => (
              <Text key={item} style={styles.unknownText}>· {item}</Text>
            ))}
          </View>
        ) : null}
        <Text style={styles.impact}>{card.impact}</Text>

        {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
        {pending ? (
          <View style={styles.pendingRow} accessibilityRole="progressbar">
            <ActivityIndicator size="small" color={colors.sage[500]} />
            <Text style={styles.pendingText}>서버 기록과 영수증을 다시 확인하고 있어요.</Text>
          </View>
        ) : null}

        <View style={styles.outcomeGrid}>
          {VISIBLE_OUTCOMES.map((choice) => (
            <Pressable
              key={choice.outcome}
              onPress={() => chooseOutcome(choice.outcome)}
              disabled={pending}
              style={({ pressed }) => [
                styles.outcomeButton,
                pressed && !pending && styles.pressed,
                pending && styles.disabled,
              ]}
              accessibilityRole="button"
              accessibilityLabel={choice.label}
              accessibilityState={{ disabled: pending }}
            >
              <Text style={styles.outcomeText}>{choice.label}</Text>
            </Pressable>
          ))}
        </View>
      </View>

      <Modal
        visible={selection !== null}
        transparent
        animationType="slide"
        onRequestClose={pending ? undefined : () => setSelection(null)}
      >
        <View
          style={[
            styles.overlay,
            {
              paddingTop: modalTopPadding,
              paddingBottom: modalBottomPadding,
            },
          ]}
        >
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={pending ? undefined : () => setSelection(null)}
            accessibilityRole="button"
            accessibilityLabel="후속 선택 창 닫기"
          />
          <ScrollView
            style={[styles.sheet, { maxHeight: sheetMaxHeight }]}
            accessibilityViewIsModal
            contentContainerStyle={styles.sheetContent}
            showsVerticalScrollIndicator
            keyboardShouldPersistTaps="handled"
          >
            <View style={styles.sheetHeading}>
              <View style={styles.lockIcon} accessibilityElementsHidden>
                <LockKeyhole size={18} color={colors.gold.DEFAULT} />
              </View>
              <View style={styles.sheetCopy}>
                <Text style={styles.sheetTitle}>
                  {selection?.kind === "blocker"
                    ? "어디에서 막혔나요?"
                    : selection?.outcome === "completed"
                      ? "이 행동을 완료로 남길까요?"
                      : "내용이 바뀐 상태로 기록할까요?"}
                </Text>
                <Text style={styles.sheetDescription}>
                  {selection?.kind === "blocker"
                    ? "막힌 이유는 나에게만 보여요. 정해진 사유만 기록하고 자유 입력은 받지 않아요."
                    : selection?.outcome === "changed"
                      ? "확인 후에만 변경 상태를 기록해요. 기존 행동은 그대로 열어둬요."
                      : "확인 후에만 현재 행동 기록을 바꿔요. 되돌아가면 아무것도 바뀌지 않아요."}
                </Text>
              </View>
              <Pressable
                onPress={() => setSelection(null)}
                disabled={pending}
                style={styles.closeButton}
                accessibilityRole="button"
                accessibilityLabel="후속 선택 취소"
              >
                <X size={18} color={colors.textTertiary} />
              </Pressable>
            </View>

            {selection?.kind === "blocker" ? (
              <View style={styles.blockerList}>
                {TODAY_ONE_CARE_V2_BLOCKER_CHOICES.map((choice) => (
                  <Pressable
                    key={choice.code}
                    onPress={() => submitBlocker(choice.code)}
                    disabled={pending}
                    style={({ pressed }) => [
                      styles.blockerButton,
                      pressed && !pending && styles.pressed,
                    ]}
                    accessibilityRole="button"
                  >
                    <Text style={styles.blockerText}>{choice.label}</Text>
                  </Pressable>
                ))}
              </View>
            ) : (
              <PrimaryButton onPress={confirmMutation} disabled={pending}>
                {selection?.outcome === "completed" ? "완료로 기록하기" : "바뀐 상태 기록하기"}
              </PrimaryButton>
            )}
            <Pressable
              onPress={() => setSelection(null)}
              disabled={pending}
              style={styles.cancelButton}
              accessibilityRole="button"
            >
              <Text style={styles.cancelText}>돌아가기</Text>
            </Pressable>
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    overflow: "hidden",
    borderWidth: 1,
    borderColor: colors.sage.pale,
    borderRadius: radius["2xl"],
    backgroundColor: colors.surface,
    ...appShadow,
  },
  header: { padding: spacing[5], gap: spacing[2], backgroundColor: colors.noir[800] },
  eyebrowRow: { flexDirection: "row", alignItems: "center", gap: spacing[1] },
  eyebrow: { fontSize: 11, fontWeight: "600", color: colors.ivory[100] },
  title: { fontSize: 18, lineHeight: 26, fontWeight: "700", color: colors.surface },
  whyNow: { fontSize: 14, lineHeight: 22, color: colors.ivory[100] },
  body: { padding: spacing[5], gap: spacing[4] },
  revisionText: { fontSize: 11, lineHeight: 18, color: colors.textTertiary },
  factBlock: { gap: spacing[1] },
  unknownBlock: { gap: spacing[1], paddingTop: spacing[3], borderTopWidth: 1, borderTopColor: colors.border },
  blockTitle: { fontSize: 12, fontWeight: "600", color: colors.rose[600] },
  factText: { fontSize: 14, lineHeight: 21, color: colors.noir[800] },
  unknownText: { fontSize: 13, lineHeight: 20, color: colors.textSecondary },
  impact: {
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    borderRadius: radius.lg,
    fontSize: 12,
    lineHeight: 19,
    color: colors.noir[800],
    backgroundColor: colors.ivory[100],
  },
  outcomeGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing[2] },
  outcomeButton: {
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: spacing[4],
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
  },
  outcomeText: { fontSize: 13, fontWeight: "600", color: colors.noir[800] },
  pendingRow: { flexDirection: "row", alignItems: "center", gap: spacing[2] },
  pendingText: { flex: 1, fontSize: 12, lineHeight: 18, color: colors.sage[500] },
  error: { fontSize: 13, lineHeight: 20, color: colors.danger },
  pressed: { opacity: 0.72 },
  disabled: { opacity: 0.5 },
  overlay: {
    flex: 1,
    justifyContent: "flex-end",
    padding: spacing[4],
    backgroundColor: "rgba(13, 13, 15, 0.38)",
  },
  sheet: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius["2xl"],
    backgroundColor: colors.surface,
  },
  sheetContent: {
    padding: spacing[5],
    paddingBottom: spacing[3],
  },
  sheetHeading: { flexDirection: "row", alignItems: "flex-start", gap: spacing[3], marginBottom: spacing[4] },
  lockIcon: {
    width: 38,
    height: 38,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.lg,
    backgroundColor: colors.noir[800],
  },
  sheetCopy: { flex: 1 },
  sheetTitle: { fontSize: 18, lineHeight: 25, fontWeight: "600", color: colors.noir[800] },
  sheetDescription: { marginTop: spacing[1], fontSize: 13, lineHeight: 20, color: colors.textSecondary },
  closeButton: { width: 44, height: 44, marginTop: -10, marginRight: -10, alignItems: "center", justifyContent: "center" },
  blockerList: { gap: spacing[2] },
  blockerButton: {
    minHeight: 48,
    justifyContent: "center",
    paddingHorizontal: spacing[4],
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    backgroundColor: colors.ivory[50],
  },
  blockerText: { fontSize: 14, fontWeight: "600", color: colors.noir[800] },
  cancelButton: { minHeight: 44, alignItems: "center", justifyContent: "center", marginTop: spacing[1] },
  cancelText: { fontSize: 13, color: colors.textTertiary },
  receiptCard: {
    flexDirection: "row",
    gap: spacing[3],
    padding: spacing[4],
    borderWidth: 1,
    borderColor: colors.sage.pale,
    borderRadius: radius.xl,
    backgroundColor: colors.ivory[100],
  },
  receiptIcon: {
    width: 38,
    height: 38,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.full,
    backgroundColor: colors.surface,
  },
  receiptCopy: { flex: 1, gap: spacing[1] },
  receiptTitle: { fontSize: 14, fontWeight: "600", color: colors.noir[800] },
  receiptText: { fontSize: 13, lineHeight: 20, color: colors.textSecondary },
  receiptMeta: { fontSize: 11, lineHeight: 18, color: colors.textTertiary },
  rescueButton: {
    alignSelf: "flex-start",
    minHeight: 44,
    justifyContent: "center",
    paddingVertical: spacing[2],
  },
  rescueText: { fontSize: 13, fontWeight: "600", color: colors.rose[600] },
  personalizationPrompt: {
    gap: spacing[1],
    marginTop: spacing[3],
    paddingTop: spacing[3],
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  personalizationTitle: { fontSize: 13, lineHeight: 20, fontWeight: "600", color: colors.noir[800] },
  personalizationDescription: { fontSize: 12, lineHeight: 18, color: colors.textSecondary },
  personalizationButton: {
    alignSelf: "flex-start",
    minHeight: 44,
    justifyContent: "center",
    paddingVertical: spacing[2],
  },
  personalizationButtonText: { fontSize: 13, lineHeight: 20, fontWeight: "600", color: colors.sage[500] },
  receiptContinueButton: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing[2],
    marginTop: spacing[1],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    borderRadius: radius.lg,
    backgroundColor: colors.sage[500],
  },
  receiptContinueText: { fontSize: 13, lineHeight: 20, fontWeight: "600", color: colors.ivory[50] },
});
