import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { ShieldCheck } from "lucide-react-native";
import { colors, radius, spacing } from "@hanbang/design-tokens";
import type {
  MediationOutcomeFollowUpCard,
  MediationOutcomeFollowUpOutcome,
  MediationOutcomeFollowUpReceipt,
} from "@hanbang/shared";

const OUTCOME_COPY: Record<MediationOutcomeFollowUpOutcome, string> = {
  resolved: "이제 괜찮아졌어요",
  changed: "상황이 달라졌어요",
  blocked: "아직 막혀 있어요",
  stop: "여기서 멈출게요",
};

interface AmoraMediationOutcomeCardProps {
  card: MediationOutcomeFollowUpCard;
  receipt?: MediationOutcomeFollowUpReceipt | null;
  pendingOutcome?: MediationOutcomeFollowUpOutcome | null;
  error?: string | null;
  onChoose: (outcome: MediationOutcomeFollowUpOutcome) => void;
}

export default function AmoraMediationOutcomeCard({
  card,
  receipt = null,
  pendingOutcome = null,
  error = null,
  onChoose,
}: AmoraMediationOutcomeCardProps) {
  const [selectedOutcome, setSelectedOutcome] =
    useState<MediationOutcomeFollowUpOutcome | null>(null);

  if (receipt) {
    return (
      <View
        style={styles.card}
        accessibilityLiveRegion="polite"
        accessibilityLabel={`내 답변 ${OUTCOME_COPY[receipt.outcome]} 저장 완료`}
      >
        <View style={styles.headerRow}>
          <View style={styles.iconWrap}>
            <ShieldCheck size={20} color={colors.sage[500]} />
          </View>
          <View style={styles.headerCopy}>
            <Text style={styles.eyebrow}>PRIVATE FOLLOW-UP</Text>
            <Text style={styles.title}>내 답변을 저장했어요</Text>
          </View>
        </View>
        <Text style={styles.receiptChoice}>{OUTCOME_COPY[receipt.outcome]}</Text>
        <Text style={styles.privateCopy}>
          나에게만 저장돼요. 공동 기록과 상대방 카드에는 영향을 주지 않아요.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.card} accessibilityLabel={card.title}>
      <View style={styles.headerRow}>
        <View style={styles.iconWrap}>
          <ShieldCheck size={20} color={colors.sage[500]} />
        </View>
        <View style={styles.headerCopy}>
          <Text style={styles.eyebrow}>PRIVATE FOLLOW-UP</Text>
          <Text style={styles.title}>{card.title}</Text>
        </View>
      </View>

      <Text style={styles.question}>{card.question}</Text>
      <View style={styles.evidenceBox}>
        <Text style={styles.evidenceLabel}>확인된 것</Text>
        {card.confirmed.map((item) => (
          <Text key={item} style={styles.evidenceText}>• {item}</Text>
        ))}
        <Text style={styles.evidenceLabel}>아직 모르는 것</Text>
        {card.unknown.map((item) => (
          <Text key={item} style={styles.evidenceText}>• {item}</Text>
        ))}
      </View>

      <Text style={styles.privateCopy}>
        나에게만 저장돼요. 공동 기록과 상대방 카드에는 영향을 주지 않아요.
      </Text>

      <View style={styles.choiceList}>
        {card.choices.map((choice) => (
          <Pressable
            key={choice.outcome}
            style={({ pressed }) => [
              styles.choiceButton,
              selectedOutcome === choice.outcome && styles.choiceButtonSelected,
              pressed && styles.pressed,
            ]}
            onPress={() => setSelectedOutcome(choice.outcome)}
            disabled={pendingOutcome !== null}
            accessibilityRole="button"
            accessibilityState={{
              selected: selectedOutcome === choice.outcome,
              disabled: pendingOutcome !== null,
            }}
            accessibilityLabel={OUTCOME_COPY[choice.outcome]}
            accessibilityHint="선택 후 저장 확인을 한 번 더 눌러요"
          >
            <Text style={styles.choiceText}>{OUTCOME_COPY[choice.outcome]}</Text>
          </Pressable>
        ))}
      </View>

      {selectedOutcome ? (
        <View style={styles.confirmation} accessibilityLiveRegion="polite">
          <Text style={styles.confirmationText}>
            “{OUTCOME_COPY[selectedOutcome]}”로 나에게만 저장할까요?
          </Text>
          <View style={styles.confirmationActions}>
            <Pressable
              style={({ pressed }) => [styles.cancelButton, pressed && styles.pressed]}
              onPress={() => setSelectedOutcome(null)}
              disabled={pendingOutcome !== null}
              accessibilityRole="button"
              accessibilityLabel="선택 취소"
            >
              <Text style={styles.cancelText}>다시 고르기</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.saveButton, pressed && styles.pressed]}
              onPress={() => onChoose(selectedOutcome)}
              disabled={pendingOutcome !== null}
              accessibilityRole="button"
              accessibilityLabel={`${OUTCOME_COPY[selectedOutcome]}로 내 답변 저장`}
              accessibilityState={{ disabled: pendingOutcome !== null }}
            >
              <Text style={styles.saveText}>
                {pendingOutcome ? "확인 중…" : "내 답변 저장"}
              </Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      {error ? (
        <Text style={styles.error} accessibilityLiveRegion="polite">{error}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: spacing[5],
    gap: spacing[4],
    borderRadius: radius["3xl"],
    borderWidth: 1,
    borderColor: colors.sage.pale,
    backgroundColor: colors.surface,
  },
  headerRow: { flexDirection: "row", alignItems: "center", gap: spacing[3] },
  iconWrap: {
    width: 42,
    height: 42,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.xl,
    backgroundColor: colors.sage.pale,
  },
  headerCopy: { flex: 1, gap: 2 },
  eyebrow: { fontSize: 10, fontWeight: "700", color: colors.sage[500] },
  title: { fontSize: 18, lineHeight: 26, fontWeight: "700", color: colors.noir[800] },
  question: { fontSize: 15, lineHeight: 23, fontWeight: "600", color: colors.noir[800] },
  evidenceBox: {
    padding: spacing[4],
    gap: spacing[2],
    borderRadius: radius.xl,
    backgroundColor: colors.ivory[100],
  },
  evidenceLabel: { fontSize: 12, fontWeight: "700", color: colors.textSecondary },
  evidenceText: { fontSize: 13, lineHeight: 20, color: colors.noir[800] },
  privateCopy: { fontSize: 12, lineHeight: 19, color: colors.textSecondary },
  choiceList: { gap: spacing[2] },
  choiceButton: {
    minHeight: 48,
    justifyContent: "center",
    paddingHorizontal: spacing[4],
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  choiceButtonSelected: { borderColor: colors.rose[500], backgroundColor: colors.rose.glow },
  choiceText: { fontSize: 14, fontWeight: "600", color: colors.noir[800] },
  confirmation: {
    gap: spacing[3],
    paddingTop: spacing[3],
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  confirmationText: { fontSize: 13, lineHeight: 20, color: colors.noir[800] },
  confirmationActions: { flexDirection: "row", justifyContent: "flex-end", gap: spacing[2] },
  cancelButton: { minHeight: 44, justifyContent: "center", paddingHorizontal: spacing[3] },
  cancelText: { fontSize: 13, fontWeight: "600", color: colors.textSecondary },
  saveButton: {
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: spacing[4],
    borderRadius: radius.full,
    backgroundColor: colors.noir[800],
  },
  saveText: { fontSize: 13, fontWeight: "700", color: colors.surface },
  receiptChoice: { fontSize: 16, fontWeight: "700", color: colors.noir[800] },
  error: { fontSize: 12, lineHeight: 19, color: colors.danger },
  pressed: { opacity: 0.72 },
});
