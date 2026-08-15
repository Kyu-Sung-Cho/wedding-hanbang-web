import { useEffect, useState } from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Sparkles, X } from "lucide-react-native";
import { colors, radius, spacing } from "@hanbang/design-tokens";

import { PrimaryButton } from "@/components/ui/AppUI";
import { normalizeAmoraMediationSummary } from "@/lib/amoraMediationRequest.mjs";

interface AmoraMediationConsentModalProps {
  visible: boolean;
  pending: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: (requesterSummary: string) => void | Promise<void>;
}

export default function AmoraMediationConsentModal({
  visible,
  pending,
  error,
  onCancel,
  onConfirm,
}: AmoraMediationConsentModalProps) {
  const [summary, setSummary] = useState("");
  const normalized = normalizeAmoraMediationSummary(summary);

  useEffect(() => {
    if (!visible) setSummary("");
  }, [visible]);

  function submit() {
    if (!normalized.ok || pending) return;
    void onConfirm(normalized.summary);
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={pending ? undefined : onCancel}
    >
      <KeyboardAvoidingView
        style={styles.overlay}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={pending ? undefined : onCancel}
          accessibilityRole="button"
          accessibilityLabel="조율 초안 요청 창 닫기"
        />
        <View
          style={styles.sheet}
          accessibilityViewIsModal
          accessibilityLabel="아모라 조율 초안 요청"
        >
          <View style={styles.headingRow}>
            <View style={styles.icon} accessibilityElementsHidden>
              <Sparkles size={18} color={colors.gold.DEFAULT} />
            </View>
            <View style={styles.headingCopy}>
              <Text style={styles.title}>아모라에게 조율 초안을 요청할까요?</Text>
              <Text style={styles.description}>
                상대방에게 보낸 원문이나 나만의 상담은 가져오지 않아요. 내가 아래에 직접 적은 요약만 사용해요.
                생성된 초안은 함께 대화에 표시되어 상대가 볼 수 있어요.
              </Text>
            </View>
            <Pressable
              style={styles.closeButton}
              onPress={onCancel}
              disabled={pending}
              accessibilityRole="button"
              accessibilityLabel="조율 초안 요청 취소"
              accessibilityState={{ disabled: pending }}
            >
              <X size={18} color={colors.textTertiary} />
            </Pressable>
          </View>

          <Text style={styles.label}>내가 전달할 상황 요약</Text>
          <TextInput
            style={styles.input}
            value={summary}
            onChangeText={setSummary}
            maxLength={600}
            multiline
            editable={!pending}
            autoFocus
            placeholder="예: 결혼식장 예산 상한선을 두고 의견이 달라요."
            placeholderTextColor={colors.taupe[400]}
            accessibilityLabel="조율 요청 상황 요약"
          />
          <View style={styles.metaRow}>
            <Text style={styles.disclaimer}>
              초안은 판결이 아니며, 두 사람이 각각 확인해야 공동 결정으로 남아요.
            </Text>
            <Text style={styles.counter}>{summary.length}/600</Text>
          </View>
          {error ? (
            <Text style={styles.error} accessibilityRole="alert">
              {error}
            </Text>
          ) : null}

          <PrimaryButton
            onPress={submit}
            disabled={!normalized.ok || pending}
            icon={<Sparkles size={17} color="#FFFFFF" />}
            accessibilityLabel="이 요약으로 조율 초안 요청"
          >
            {pending ? "안전하게 요청하는 중…" : "이 요약으로 초안 요청"}
          </PrimaryButton>
          <Pressable
            style={styles.cancelButton}
            onPress={onCancel}
            disabled={pending}
            accessibilityRole="button"
            accessibilityLabel="조율 초안 요청 취소"
            accessibilityState={{ disabled: pending }}
          >
            <Text style={styles.cancelText}>취소</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: "flex-end",
    padding: spacing[4],
    backgroundColor: "rgba(13, 13, 15, 0.38)",
  },
  sheet: {
    padding: spacing[5],
    paddingBottom: spacing[3],
    borderRadius: radius["2xl"],
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  headingRow: { flexDirection: "row", alignItems: "flex-start", gap: spacing[3] },
  headingCopy: { flex: 1 },
  icon: {
    width: 38,
    height: 38,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.lg,
    backgroundColor: colors.noir[800],
  },
  title: { fontSize: 18, lineHeight: 25, fontWeight: "600", color: colors.noir[800] },
  description: { marginTop: 6, fontSize: 13, lineHeight: 20, color: colors.textSecondary },
  closeButton: {
    width: 44,
    height: 44,
    marginRight: -10,
    marginTop: -10,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.full,
  },
  label: { marginTop: spacing[4], fontSize: 14, fontWeight: "600", color: colors.textPrimary },
  input: {
    minHeight: 116,
    marginTop: spacing[2],
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.ivory[50],
    fontSize: 14,
    lineHeight: 21,
    color: colors.textPrimary,
    textAlignVertical: "top",
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: spacing[3],
    marginTop: spacing[2],
    marginBottom: spacing[4],
  },
  disclaimer: { flex: 1, fontSize: 12, lineHeight: 18, color: colors.textSecondary },
  counter: { fontSize: 12, lineHeight: 18, color: colors.textTertiary },
  error: {
    marginBottom: spacing[3],
    padding: 10,
    borderRadius: radius.md,
    backgroundColor: "#FDF2F2",
    fontSize: 12,
    lineHeight: 18,
    color: "#8A4444",
  },
  cancelButton: { minHeight: 44, alignItems: "center", justifyContent: "center" },
  cancelText: { fontSize: 13, color: colors.textTertiary },
});
