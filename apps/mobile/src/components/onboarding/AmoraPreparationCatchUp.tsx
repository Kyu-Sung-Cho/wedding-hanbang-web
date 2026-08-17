import { Check, ChevronRight, LockKeyhole, Users } from "lucide-react-native";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { colors } from "@hanbang/design-tokens";
import {
  AMORA_PREPARATION_CATCH_UP_TOPICS,
  type AmoraPreparationCatchUpPreview,
  type AmoraPreparationCatchUpScope,
  type AmoraPreparationCatchUpState,
  type AmoraPreparationCatchUpTopicKey,
} from "@hanbang/shared/amora-preparation-catch-up";
import { PrimaryButton } from "@/components/ui/AppUI";

export type AmoraPreparationCatchUpDraftItem = Readonly<{
  topicKey: AmoraPreparationCatchUpTopicKey;
  state: AmoraPreparationCatchUpState;
  scope: AmoraPreparationCatchUpScope;
}>;

const STATE_OPTIONS: readonly Readonly<{
  value: AmoraPreparationCatchUpState;
  label: string;
}>[] = [
  { value: "completed", label: "이미 끝냈어요" },
  { value: "in_progress", label: "진행 중이에요" },
  { value: "unknown", label: "아직 잘 모르겠어요" },
  { value: "not_applicable", label: "해당 없어요" },
];

type Props = {
  coupleAction: "create" | "join";
  phase: "edit" | "preview";
  items: readonly AmoraPreparationCatchUpDraftItem[];
  preview: AmoraPreparationCatchUpPreview | null;
  submitting: boolean;
  requestLocked: boolean;
  onChangeItems: (items: readonly AmoraPreparationCatchUpDraftItem[]) => void;
  onPreview: () => void;
  onEdit: () => void;
  onConfirm: () => void;
  onSkip: () => void;
};

function replaceItem(
  items: readonly AmoraPreparationCatchUpDraftItem[],
  topicKey: AmoraPreparationCatchUpTopicKey,
  patch: Partial<Pick<AmoraPreparationCatchUpDraftItem, "state" | "scope">>,
) {
  return items.map((item) => item.topicKey === topicKey ? { ...item, ...patch } : item);
}

export function AmoraPreparationCatchUp({
  coupleAction,
  phase,
  items,
  preview,
  submitting,
  requestLocked,
  onChangeItems,
  onPreview,
  onEdit,
  onConfirm,
  onSkip,
}: Props) {
  if (phase === "preview" && preview) {
    return (
      <View style={styles.panel} accessibilityLabel="준비 상태 변경 미리보기">
        <Text style={styles.eyebrow}>저장 전 미리보기</Text>
        <Text style={styles.title}>{preview.title}</Text>
        <Text style={styles.description}>{preview.description}</Text>
        <View style={styles.previewList}>
          {preview.items.map((item) => (
            <View key={item.topicKey} style={styles.previewItem}>
              <View style={styles.previewTopline}>
                <Text style={styles.previewTopic}>{item.topicLabel}</Text>
                <Text style={styles.previewScope}>{item.scopeLabel}</Text>
              </View>
              <Text style={styles.previewState}>{item.stateLabel}</Text>
              <Text style={styles.boundary}>{item.boundaryLabel}</Text>
            </View>
          ))}
        </View>
        <View style={styles.notice}>
          <LockKeyhole size={16} color={colors.textSecondary} />
          <Text style={styles.noticeText}>
            확인 버튼을 누르기 전에는 아무 기록도 바뀌지 않아요.
          </Text>
        </View>
        <PrimaryButton
          onPress={onConfirm}
          disabled={submitting}
          accessibilityLabel="확인한 준비 상태 반영하기"
          accessibilityState={{ disabled: submitting, busy: submitting }}
        >
          {submitting ? "현재 상태를 확인하고 있어요" : "확인한 내용 반영하기"}
        </PrimaryButton>
        <Pressable
          style={styles.secondaryButton}
          onPress={onEdit}
          disabled={submitting || requestLocked}
          accessibilityRole="button"
          accessibilityLabel="준비 상태 다시 수정하기"
          accessibilityState={{ disabled: submitting || requestLocked }}
        >
          <Text style={styles.secondaryButtonText}>
            {requestLocked ? "반영 여부를 먼저 확인해 주세요" : "다시 수정하기"}
          </Text>
        </Pressable>
      </View>
    );
  }

  const selectedKeys = new Set(items.map((item) => item.topicKey));
  return (
    <View style={styles.panel} accessibilityLabel="이미 준비한 것 빠르게 정리">
      <Text style={styles.eyebrow}>최대 3개 · 선택 사항</Text>
      <Text style={styles.title}>이미 준비한 주제를 골라주세요</Text>
      <Text style={styles.description}>
        확실한 것만 고르면 돼요. 완료율을 추정하거나 기존 체크리스트를 자동 완료하지 않아요.
      </Text>

      <View style={styles.topicGrid}>
        {AMORA_PREPARATION_CATCH_UP_TOPICS.map((topic) => {
          const selected = selectedKeys.has(topic.topicKey);
          const disabled = !selected && items.length >= 3;
          return (
            <Pressable
              key={topic.topicKey}
              style={[styles.topicChip, selected && styles.topicChipSelected, disabled && styles.disabled]}
              onPress={() => {
                if (selected) {
                  onChangeItems(items.filter((item) => item.topicKey !== topic.topicKey));
                  return;
                }
                if (disabled) return;
                onChangeItems([
                  ...items,
                  { topicKey: topic.topicKey, state: "in_progress", scope: "owner_private" },
                ]);
              }}
              disabled={disabled}
              accessibilityRole="checkbox"
              accessibilityLabel={topic.topicLabel}
              accessibilityState={{ checked: selected, disabled }}
            >
              {selected ? <Check size={14} color={colors.rose[600]} /> : null}
              <Text style={[styles.topicChipText, selected && styles.topicChipTextSelected]}>
                {topic.topicLabel}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {items.map((item) => {
        const topic = AMORA_PREPARATION_CATCH_UP_TOPICS.find(
          (candidate) => candidate.topicKey === item.topicKey,
        );
        if (!topic) return null;
        return (
          <View key={item.topicKey} style={styles.selectionCard}>
            <Text style={styles.selectionTitle}>{topic.topicLabel}</Text>
            <Text style={styles.fieldLabel}>현재 상태</Text>
            <View style={styles.optionGrid}>
              {STATE_OPTIONS.map((option) => (
                <Pressable
                  key={option.value}
                  style={[styles.option, item.state === option.value && styles.optionSelected]}
                  onPress={() => onChangeItems(replaceItem(items, item.topicKey, { state: option.value }))}
                  accessibilityRole="radio"
                  accessibilityLabel={`${topic.topicLabel}, ${option.label}`}
                  accessibilityState={{ selected: item.state === option.value }}
                >
                  <Text style={[styles.optionText, item.state === option.value && styles.optionTextSelected]}>
                    {option.label}
                  </Text>
                </Pressable>
              ))}
            </View>
            <Text style={styles.fieldLabel}>보는 사람</Text>
            <View style={styles.scopeRow}>
              <Pressable
                style={[styles.scopeOption, item.scope === "owner_private" && styles.optionSelected]}
                onPress={() => onChangeItems(replaceItem(items, item.topicKey, { scope: "owner_private" }))}
                accessibilityRole="radio"
                accessibilityLabel={`${topic.topicLabel}, 나만 보기`}
                accessibilityState={{ selected: item.scope === "owner_private" }}
              >
                <LockKeyhole size={15} color={colors.textSecondary} />
                <Text style={styles.optionText}>나만 보기</Text>
              </Pressable>
              {coupleAction === "create" ? (
                <Pressable
                  style={[styles.scopeOption, item.scope === "couple_shared" && styles.optionSelected]}
                  onPress={() => onChangeItems(replaceItem(items, item.topicKey, { scope: "couple_shared" }))}
                  accessibilityRole="radio"
                  accessibilityLabel={`${topic.topicLabel}, 함께 보기`}
                  accessibilityState={{ selected: item.scope === "couple_shared" }}
                >
                  <Users size={15} color={colors.textSecondary} />
                  <Text style={styles.optionText}>함께 보기</Text>
                </Pressable>
              ) : null}
            </View>
          </View>
        );
      })}

      {coupleAction === "join" ? (
        <Text style={styles.sharedGuard}>
          파트너가 있는 준비 공간에서는 먼저 나만 보기로 정리해요. 함께 보기는 파트너 확인 단계에서 바꿀 수 있어요.
        </Text>
      ) : null}

      <PrimaryButton
        onPress={onPreview}
        disabled={items.length === 0}
        accessibilityLabel="준비 상태 변경 미리보기"
        accessibilityState={{ disabled: items.length === 0 }}
      >
        {items.length === 0 ? "먼저 주제를 골라주세요" : `${items.length}개 변경 미리보기`}
      </PrimaryButton>
      <Pressable
        style={styles.skipButton}
        onPress={onSkip}
        accessibilityRole="button"
        accessibilityLabel="지금은 건너뛰고 아모라 시작하기"
      >
        <Text style={styles.skipText}>지금은 건너뛰기</Text>
        <ChevronRight size={16} color={colors.textTertiary} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    marginTop: 20,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: 18,
    gap: 12,
  },
  eyebrow: { fontSize: 12, fontWeight: "700", color: colors.rose[600] },
  title: { fontSize: 20, fontWeight: "700", color: colors.textPrimary },
  description: { fontSize: 14, lineHeight: 21, color: colors.textSecondary },
  topicGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  topicChip: {
    minHeight: 40,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: colors.bg,
  },
  topicChipSelected: { borderColor: colors.rose.light, backgroundColor: colors.rose.pale },
  topicChipText: { fontSize: 13, color: colors.textSecondary },
  topicChipTextSelected: { color: colors.rose[600], fontWeight: "700" },
  disabled: { opacity: 0.38 },
  selectionCard: {
    borderRadius: 16,
    backgroundColor: colors.bg,
    padding: 14,
    gap: 10,
  },
  selectionTitle: { fontSize: 16, fontWeight: "700", color: colors.textPrimary },
  fieldLabel: { marginTop: 2, fontSize: 12, fontWeight: "700", color: colors.textSecondary },
  optionGrid: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  option: {
    minHeight: 38,
    justifyContent: "center",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 10,
    paddingVertical: 7,
    backgroundColor: colors.surface,
  },
  optionSelected: { borderColor: colors.rose.light, backgroundColor: colors.rose.pale },
  optionText: { fontSize: 12, color: colors.textSecondary },
  optionTextSelected: { color: colors.rose[600], fontWeight: "700" },
  scopeRow: { flexDirection: "row", gap: 8 },
  scopeOption: {
    minHeight: 40,
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  sharedGuard: { fontSize: 12, lineHeight: 18, color: colors.textTertiary },
  previewList: { gap: 10 },
  previewItem: { borderRadius: 14, backgroundColor: colors.bg, padding: 14, gap: 5 },
  previewTopline: { flexDirection: "row", justifyContent: "space-between", gap: 12 },
  previewTopic: { flex: 1, fontSize: 15, fontWeight: "700", color: colors.textPrimary },
  previewScope: { fontSize: 12, color: colors.textSecondary },
  previewState: { fontSize: 14, color: colors.rose[600], fontWeight: "700" },
  boundary: { fontSize: 12, lineHeight: 18, color: colors.textTertiary },
  notice: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  noticeText: { flex: 1, fontSize: 12, lineHeight: 18, color: colors.textSecondary },
  secondaryButton: { minHeight: 44, alignItems: "center", justifyContent: "center" },
  secondaryButtonText: { fontSize: 14, fontWeight: "700", color: colors.textSecondary },
  skipButton: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  skipText: { fontSize: 14, color: colors.textTertiary },
});
