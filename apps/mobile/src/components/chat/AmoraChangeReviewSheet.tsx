import type { ReactNode } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Check, CircleCheck, Info, X } from "lucide-react-native";
import { Text } from "@/components/ui/AppText";
import { amoraIdentity, colors } from "@hanbang/design-tokens";
import {
  AMORA_CHANGE_REVIEW_COPY,
  describeAmoraChange,
  type BudgetImpactPreview,
} from "@hanbang/shared";

/**
 * 아모라 변경 제안의 「내용 확인하기」 창 — 웹 `AmoraSaveSheet` 와 같은 내용이다(2026-09-18).
 *
 * 앱 카드는 한 번 누르면 바로 반영했다. 이제 카드는 이 창을 열기만 하고, 반영은 여기의 확인 버튼에서만
 * 시작된다. 무엇이 바뀌는지(서버가 발급한 확인문), 도구별 안내("예약을 대신 진행하지 않아요" 등),
 * 공개 범위를 먼저 읽게 한다. 표와 문구는 `@hanbang/shared` 의 것을 웹과 함께 쓴다.
 *
 * 이 창은 원문 대화나 도구 입력을 보여 주거나 고치는 곳이 아니다. 반영 결과는 기존 채팅 흐름이 알린다 —
 * 여기서 "반영했어요"라고 말하지 않는다.
 */
export function AmoraChangeReviewSheet({
  visible,
  confirmation,
  tool,
  impactPreview,
  carriedLabel,
  disabled,
  busy,
  applyLabel,
  applyAccessibilityLabel,
  notice,
  error,
  children,
  onConfirm,
  onClose,
  onDefer,
}: {
  visible: boolean;
  confirmation: string;
  tool: string;
  /** 호출부가 같은 도구·입력·기준 revision 에 묶어 검증한 미리보기(`getPendingAmoraBudgetImpactPreview`). */
  impactPreview: BudgetImpactPreview | null;
  carriedLabel: string | null;
  disabled: boolean;
  busy: boolean;
  applyLabel: string;
  applyAccessibilityLabel: string;
  notice: string | null;
  error: string | null;
  children?: ReactNode;
  onConfirm: () => void;
  onClose: () => void;
  onDefer: () => void;
}) {
  const copy = AMORA_CHANGE_REVIEW_COPY;
  const details = describeAmoraChange(tool, impactPreview);
  // 반영 요청 중에는 닫지 않는다 — 닫으면 결과·실패를 볼 곳이 사라진다.
  const close = () => { if (!busy) onClose(); };
  const defer = () => { if (!busy) onDefer(); };
  const message = error ?? notice;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
      <View style={styles.overlay}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={close}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        />
        <View style={styles.sheet} accessibilityViewIsModal>
          <View style={styles.handle} />
          <View style={styles.header}>
            <Text accessibilityRole="header" style={styles.title}>{copy.title}</Text>
            <Pressable
              style={({ pressed }) => [styles.close, pressed && styles.closePressed]}
              onPress={close}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel={copy.close}
              accessibilityState={{ disabled: busy }}
            >
              <X size={18} color={colors.textTertiary} />
            </Pressable>
          </View>
          <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
            <Text style={styles.description}>{copy.description}</Text>

            <Text style={styles.label}>{copy.confirmationLabel}</Text>
            <View style={styles.confirmationBox}>
              <Text style={styles.confirmation}>{confirmation}</Text>
            </View>

            <Text style={styles.label}>{copy.reasonLabel}</Text>
            <View style={styles.reasonBox}>
              {carriedLabel ? <Text style={styles.carried}>{carriedLabel}</Text> : null}
              <Text style={styles.reason}>{copy.reason}</Text>
            </View>

            <Text style={styles.label}>{copy.categoryLabel}</Text>
            <View style={styles.categoryPill}>
              <Check size={14} color={colors.surface} />
              <Text style={styles.categoryText}>{details.category}</Text>
            </View>
            <View style={styles.effectRow}>
              <Info size={13} color={colors.textTertiary} />
              <Text style={styles.effect}>{details.effect}</Text>
            </View>

            {children}

            <View style={styles.scopeBox}>
              <CircleCheck size={16} color={amoraIdentity.ink} />
              <View style={styles.scopeCopy}>
                <Text style={styles.scopeTitle}>{copy.scopeTitle}</Text>
                <Text style={styles.scopeBody}>{copy.scopeBody}</Text>
              </View>
            </View>
          </ScrollView>

          {message ? (
            <Text
              style={[styles.message, error ? styles.errorMessage : null]}
              accessibilityRole={error ? "alert" : undefined}
              accessibilityLiveRegion="polite"
            >
              {message}
            </Text>
          ) : null}
          <Pressable
            style={({ pressed }) => [
              styles.confirm,
              pressed && !disabled && styles.confirmPressed,
              disabled && styles.confirmDisabled,
            ]}
            onPress={onConfirm}
            disabled={disabled}
            accessibilityRole="button"
            accessibilityLabel={applyAccessibilityLabel}
            accessibilityState={{ disabled, busy }}
          >
            {busy ? <ActivityIndicator size="small" color={colors.surface} /> : null}
            <Text style={styles.confirmText}>{applyLabel}</Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [styles.defer, pressed && !busy && styles.deferPressed]}
            onPress={defer}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel={copy.defer}
            accessibilityState={{ disabled: busy }}
          >
            <Text style={styles.deferText}>{copy.defer}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(37,26,24,0.45)" },
  sheet: { maxHeight: "92%", paddingHorizontal: 20, paddingTop: 10, paddingBottom: 28, borderTopLeftRadius: 22, borderTopRightRadius: 22, backgroundColor: colors.surface },
  handle: { alignSelf: "center", width: 38, height: 4, marginBottom: 14, borderRadius: 2, backgroundColor: colors.border },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  title: { flex: 1, fontSize: 18, lineHeight: 26, fontWeight: "700", color: colors.noir[800] },
  close: { width: 44, height: 44, alignItems: "center", justifyContent: "center", borderRadius: 22 },
  closePressed: { backgroundColor: colors.ivory[100] },
  body: { flexGrow: 0 },
  bodyContent: { paddingTop: 4, paddingBottom: 12 },
  description: { marginBottom: 16, fontSize: 13, lineHeight: 20, color: colors.textSecondary },
  label: { marginBottom: 6, fontSize: 12, color: colors.textTertiary },
  confirmationBox: { marginBottom: 16, paddingHorizontal: 14, paddingVertical: 12, borderRadius: 11, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.ivory[50] },
  confirmation: { fontSize: 15, lineHeight: 22, fontWeight: "600", color: colors.noir[800] },
  reasonBox: { marginBottom: 16, paddingHorizontal: 14, paddingVertical: 12, borderRadius: 11, backgroundColor: colors.ivory.warm },
  carried: { marginBottom: 4, fontSize: 13, lineHeight: 19, fontWeight: "700", color: amoraIdentity.ink },
  reason: { fontSize: 13, lineHeight: 20, color: colors.textSecondary },
  categoryPill: { alignSelf: "flex-start", minHeight: 36, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, borderRadius: 999, backgroundColor: colors.rose[600] },
  categoryText: { fontSize: 14, fontWeight: "700", color: colors.surface },
  effectRow: { flexDirection: "row", alignItems: "flex-start", gap: 6, marginTop: 8, marginBottom: 16 },
  effect: { flex: 1, fontSize: 12, lineHeight: 18, color: colors.textSecondary },
  scopeBox: { flexDirection: "row", alignItems: "flex-start", gap: 10, marginTop: 4, padding: 14, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.ivory.warm },
  scopeCopy: { flex: 1 },
  scopeTitle: { marginBottom: 4, fontSize: 13, fontWeight: "700", color: colors.noir[800] },
  scopeBody: { fontSize: 13, lineHeight: 20, color: colors.textSecondary },
  message: { marginBottom: 10, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12, fontSize: 13, lineHeight: 19, color: colors.textSecondary, backgroundColor: colors.ivory.warm },
  errorMessage: { color: colors.dangerDeep, backgroundColor: colors.rose.pale },
  confirm: { minHeight: 52, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingHorizontal: 16, borderRadius: 12, backgroundColor: colors.rose[600] },
  confirmPressed: { backgroundColor: colors.rose[700] },
  confirmDisabled: { backgroundColor: colors.taupe[400] },
  confirmText: { fontSize: 15, fontWeight: "700", color: colors.surface },
  defer: { minHeight: 52, marginTop: 9, alignItems: "center", justifyContent: "center", paddingHorizontal: 16, borderRadius: 12, borderWidth: 1, borderColor: colors.paper.outline, backgroundColor: colors.surface },
  deferPressed: { backgroundColor: colors.ivory[100] },
  deferText: { fontSize: 15, fontWeight: "600", color: colors.noir[800] },
});
