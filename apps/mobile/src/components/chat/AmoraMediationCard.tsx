import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import {
  BarChart3,
  Check,
  Heart,
  MessagesSquare,
  RefreshCw,
  Scale,
  Users,
} from "lucide-react-native";
import { colors } from "@hanbang/design-tokens";
import {
  acceptMediationResolution,
  canWithdrawMediationAcceptance,
  getMediationAcceptance,
  withdrawMediationAcceptance,
  type MediationBlock,
  type MediationAcceptanceState,
} from "@/lib/amoraMediation";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type AcceptanceLoadState = "idle" | "loading" | "ready" | "error";
type AcceptanceActionError = {
  kind: "accept" | "withdraw";
  message: string;
};

export default function AmoraMediationCard({
  block,
  messageId,
}: {
  block: MediationBlock;
  messageId?: string;
}) {
  const [acceptance, setAcceptance] = useState<MediationAcceptanceState | null>(null);
  const [loadState, setLoadState] = useState<AcceptanceLoadState>("idle");
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [accepting, setAccepting] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);
  const [actionError, setActionError] = useState<AcceptanceActionError | null>(null);
  const canConfirm = Boolean(
    block.resolution?.trim()
    && messageId
    && UUID_PATTERN.test(messageId),
  );

  useEffect(() => {
    if (!canConfirm || !messageId) {
      setAcceptance(null);
      setLoadState("idle");
      return;
    }

    let active = true;
    setAcceptance(null);
    setActionError(null);
    setLoadState("loading");
    getMediationAcceptance(messageId)
      .then((nextAcceptance) => {
        if (!active) return;
        setAcceptance(nextAcceptance);
        setLoadState("ready");
      })
      .catch(() => {
        if (!active) return;
        setLoadState("error");
      });

    return () => {
      active = false;
    };
  }, [canConfirm, loadAttempt, messageId]);

  async function acceptResolution() {
    if (
      !messageId
      || accepting
      || loadState !== "ready"
      || !acceptance
      || acceptance.accepted
    ) return;

    setAccepting(true);
    setActionError(null);
    try {
      const nextAcceptance = await acceptMediationResolution(messageId);
      setAcceptance(nextAcceptance);
    } catch {
      setActionError({
        kind: "accept",
        message: "동의를 저장하지 못했어요. 기존 상태는 바꾸지 않았어요.",
      });
    } finally {
      setAccepting(false);
    }
  }

  async function withdrawAcceptance() {
    if (
      !messageId
      || withdrawing
      || loadState !== "ready"
      || !canWithdrawMediationAcceptance(acceptance)
    ) return;

    setWithdrawing(true);
    setActionError(null);
    try {
      const nextAcceptance = await withdrawMediationAcceptance(messageId);
      setAcceptance(nextAcceptance);
    } catch {
      setActionError({
        kind: "withdraw",
        message: "내 확인을 취소하지 못했어요. 기존 확인 상태는 그대로 유지했어요.",
      });
    } finally {
      setWithdrawing(false);
    }
  }

  const sections = [
    {
      key: "empathy",
      title: "공감",
      Icon: Heart,
      color: "#8B6B24",
      backgroundColor: "#FEF9E8",
      borderColor: "#E9D59F",
      text: block.empathy,
    },
    {
      key: "translation",
      title: "양쪽 입장 통역",
      Icon: MessagesSquare,
      color: colors.noir[800],
      backgroundColor: "#F2F7F5",
      borderColor: colors.sage.pale,
      text: block.translation,
    },
    {
      key: "data",
      title: "확인된 정보",
      Icon: BarChart3,
      color: colors.textSecondary,
      backgroundColor: colors.ivory[100],
      borderColor: colors.border,
      text: block.data,
    },
    {
      key: "resolution",
      title: "제안 합의안",
      Icon: Scale,
      color: colors.rose[600],
      backgroundColor: colors.surface,
      borderColor: colors.rose.light,
      text: block.resolution,
    },
  ].filter((section) => Boolean(section.text));

  if (sections.length === 0) return null;

  return (
    <View style={styles.container} accessibilityLabel="아모라 중재 정리">
      <View style={styles.intro}>
        <Scale size={16} color={colors.noir[800]} />
        <View style={styles.introTextWrap}>
          <Text style={styles.introTitle}>아모라가 정리한 중재 제안</Text>
          <Text style={styles.introCopy}>
            AI가 정리한 내용이에요. 사실과 서로의 의도는 두 분이 직접 확인해 주세요.
          </Text>
        </View>
      </View>

      <View style={styles.sectionList}>
        {sections.map(({ key, title, Icon, color, backgroundColor, borderColor, text }) => (
          <View
            key={key}
            style={[styles.section, { backgroundColor, borderColor }]}
          >
            <View style={styles.sectionHeading}>
              <View style={[styles.sectionIcon, { borderColor }]}>
                <Icon size={14} color={color} strokeWidth={2.4} />
              </View>
              <Text style={[styles.sectionTitle, { color }]}>{title}</Text>
            </View>
            <Text style={styles.sectionText}>{text}</Text>
          </View>
        ))}
      </View>

      {canConfirm && (
        <View style={styles.confirmationPanel}>
          <Text style={styles.confirmationTitle}>이 제안을 합의로 남길까요?</Text>
          <Text style={styles.confirmationCopy}>
            한 사람만 누르면 그 사람의 동의만 저장돼요. 함께 연결된 사람이 모두 동의하기 전에는 공동 합의로 기록하지 않아요.
          </Text>

          {loadState === "loading" && (
            <View
              style={styles.statusRow}
              accessibilityLiveRegion="polite"
              accessibilityLabel="동의 상태를 확인하는 중이에요"
            >
              <ActivityIndicator size="small" color={colors.noir[800]} />
              <Text style={styles.loadingText}>동의 상태를 확인하는 중이에요</Text>
            </View>
          )}

          {loadState === "error" && (
            <View style={styles.errorBlock} accessibilityLiveRegion="polite">
              <Text style={styles.errorText} accessibilityRole="alert">
                동의 상태를 확인하지 못했어요. 확인 전에는 동의 버튼을 열지 않았어요.
              </Text>
              <Pressable
                style={({ pressed }) => [styles.retryButton, pressed && styles.buttonPressed]}
                onPress={() => setLoadAttempt((attempt) => attempt + 1)}
                accessibilityRole="button"
                accessibilityLabel="동의 상태 다시 확인하기"
              >
                <RefreshCw size={16} color={colors.noir[800]} />
                <Text style={styles.retryButtonText}>다시 확인하기</Text>
              </Pressable>
            </View>
          )}

          {loadState === "ready" && acceptance?.completed && (
            <View style={styles.successStatus} accessibilityLiveRegion="polite">
              <Check size={18} color={colors.success} />
              <Text style={styles.successText}>
                {acceptance.requiredCount > 1
                  ? "두 분 모두 동의해 공동 기억에 저장했어요"
                  : "내가 동의한 합의로 기억했어요"}
              </Text>
            </View>
          )}

          {loadState === "ready" && acceptance?.accepted && !acceptance.completed && (
            <View style={styles.waitingBlock}>
              <View style={styles.waitingStatus} accessibilityLiveRegion="polite">
                <Users size={18} color={colors.rose[600]} />
                <Text style={styles.waitingText}>
                  내 동의는 저장됐어요{"\n"}상대방의 확인을 기다리고 있어요
                </Text>
              </View>
              {canWithdrawMediationAcceptance(acceptance) && actionError?.kind !== "withdraw" && (
                <Pressable
                  style={({ pressed }) => [
                    styles.withdrawButton,
                    pressed && styles.buttonPressed,
                    withdrawing && styles.buttonDisabled,
                  ]}
                  onPress={() => void withdrawAcceptance()}
                  disabled={withdrawing}
                  accessibilityRole="button"
                  accessibilityLabel="내 확인 취소"
                  accessibilityState={{ disabled: withdrawing, busy: withdrawing }}
                >
                  {withdrawing && <ActivityIndicator size="small" color={colors.danger} />}
                  <Text style={styles.withdrawButtonText}>
                    {withdrawing ? "내 확인을 취소하는 중이에요" : "내 확인 취소"}
                  </Text>
                </Pressable>
              )}
              <Pressable
                style={({ pressed }) => [styles.retryButton, pressed && styles.buttonPressed]}
                onPress={() => setLoadAttempt((attempt) => attempt + 1)}
                accessibilityRole="button"
                accessibilityLabel="상대방 동의 상태 새로고침"
              >
                <RefreshCw size={16} color={colors.noir[800]} />
                <Text style={styles.retryButtonText}>동의 상태 새로고침</Text>
              </Pressable>
            </View>
          )}

          {loadState === "ready" && acceptance && !acceptance.accepted && actionError?.kind !== "accept" && (
            <Pressable
              style={({ pressed }) => [
                styles.confirmButton,
                pressed && styles.buttonPressed,
                accepting && styles.buttonDisabled,
              ]}
              onPress={() => void acceptResolution()}
              disabled={accepting}
              accessibilityRole="button"
              accessibilityLabel="이 제안에 나는 동의해요"
              accessibilityState={{ disabled: accepting, busy: accepting }}
            >
              {accepting
                ? <ActivityIndicator size="small" color={colors.surface} />
                : <Check size={18} color={colors.surface} />}
              <Text style={styles.confirmButtonText}>
                {accepting ? "동의를 저장하는 중이에요" : "이 제안에 나는 동의해요"}
              </Text>
            </Pressable>
          )}

          {loadState === "ready" && acceptance && !acceptance.completed && acceptance.requiredCount > 1 && (
            <Text style={styles.progressText} accessibilityLiveRegion="polite">
              {acceptance.acceptedCount}/{acceptance.requiredCount}명 확인 · 두 분 모두 동의해야 공동 기억에 저장돼요
            </Text>
          )}

          {actionError && (
            <View style={styles.errorBlock} accessibilityLiveRegion="polite">
              <Text style={styles.errorText} accessibilityRole="alert">
                {actionError.message}
              </Text>
              <Pressable
                style={({ pressed }) => [
                  styles.retryButton,
                  pressed && styles.buttonPressed,
                  (accepting || withdrawing) && styles.buttonDisabled,
                ]}
                onPress={() => {
                  if (actionError.kind === "withdraw") void withdrawAcceptance();
                  else void acceptResolution();
                }}
                disabled={accepting || withdrawing}
                accessibilityRole="button"
                accessibilityLabel={
                  actionError.kind === "withdraw"
                    ? "내 확인 취소 다시 시도"
                    : "동의 저장 다시 시도"
                }
                accessibilityState={{
                  disabled: accepting || withdrawing,
                  busy: accepting || withdrawing,
                }}
              >
                <RefreshCw size={16} color={colors.noir[800]} />
                <Text style={styles.retryButtonText}>
                  {actionError.kind === "withdraw"
                    ? "내 확인 취소 다시 시도"
                    : "동의 저장 다시 시도"}
                </Text>
              </Pressable>
            </View>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 10,
    marginTop: 8,
  },
  intro: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: 14,
    backgroundColor: colors.ivory[100],
    borderWidth: 1,
    borderColor: colors.border,
  },
  introTextWrap: {
    flex: 1,
    gap: 3,
  },
  introTitle: {
    fontSize: 13,
    fontFamily: "NotoSansKR_600SemiBold",
    color: colors.noir[800],
  },
  introCopy: {
    fontSize: 12,
    lineHeight: 18,
    fontFamily: "NotoSansKR_400Regular",
    color: colors.textSecondary,
  },
  sectionList: {
    gap: 8,
  },
  section: {
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: 14,
    borderWidth: 1,
  },
  sectionHeading: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    marginBottom: 6,
  },
  sectionIcon: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface,
    borderWidth: 1,
  },
  sectionTitle: {
    fontSize: 12,
    fontFamily: "NotoSansKR_600SemiBold",
  },
  sectionText: {
    fontSize: 14,
    lineHeight: 21,
    fontFamily: "NotoSansKR_400Regular",
    color: colors.textPrimary,
  },
  confirmationPanel: {
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.gold.light,
    backgroundColor: colors.surface,
  },
  confirmationTitle: {
    fontSize: 14,
    fontFamily: "NotoSansKR_600SemiBold",
    color: colors.noir[800],
  },
  confirmationCopy: {
    fontSize: 12,
    lineHeight: 18,
    fontFamily: "NotoSansKR_400Regular",
    color: colors.textSecondary,
  },
  statusRow: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  loadingText: {
    fontSize: 13,
    fontFamily: "NotoSansKR_500Medium",
    color: colors.textSecondary,
  },
  errorBlock: {
    gap: 8,
  },
  errorText: {
    fontSize: 12,
    lineHeight: 18,
    fontFamily: "NotoSansKR_400Regular",
    color: colors.danger,
    textAlign: "center",
  },
  retryButton: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.ivory[50],
  },
  retryButtonText: {
    fontSize: 13,
    fontFamily: "NotoSansKR_600SemiBold",
    color: colors.noir[800],
  },
  withdrawButton: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.rose.light,
    backgroundColor: colors.surface,
  },
  withdrawButtonText: {
    fontSize: 13,
    fontFamily: "NotoSansKR_600SemiBold",
    color: colors.danger,
  },
  successStatus: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: "#F2F6F1",
  },
  successText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 19,
    fontFamily: "NotoSansKR_600SemiBold",
    color: colors.success,
  },
  waitingBlock: {
    gap: 8,
  },
  waitingStatus: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: colors.ivory.warm,
  },
  waitingText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 19,
    fontFamily: "NotoSansKR_600SemiBold",
    color: colors.rose[600],
  },
  confirmButton: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: colors.rose[600],
  },
  confirmButtonText: {
    fontSize: 14,
    fontFamily: "NotoSansKR_600SemiBold",
    color: colors.surface,
  },
  progressText: {
    fontSize: 11,
    lineHeight: 17,
    fontFamily: "NotoSansKR_400Regular",
    color: colors.success,
    textAlign: "center",
  },
  buttonPressed: {
    opacity: 0.72,
  },
  buttonDisabled: {
    opacity: 0.55,
  },
});
