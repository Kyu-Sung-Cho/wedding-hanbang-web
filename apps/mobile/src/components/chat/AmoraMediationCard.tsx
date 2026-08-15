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
  hasUnsafeStoredMediationRenderContent,
  MEDIATION_RENDER_SAFETY_FALLBACK,
} from "@hanbang/shared/mediation-render-safety";
import {
  acceptMediationResolution,
  canAcceptMediationResolution,
  canWithdrawMediationAcceptance,
  getExpectedMediationRevision,
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
  const expectedRevision = getExpectedMediationRevision(block);
  const renderSafetyFallback = block.renderSafetyFallback === true
    || hasUnsafeStoredMediationRenderContent(block);
  const expectedProposalVersion = expectedRevision?.expectedProposalVersion;
  const expectedRosterFingerprint = expectedRevision?.expectedRosterFingerprint;
  const canConfirm = Boolean(
    block.resolution?.trim()
    && messageId
    && UUID_PATTERN.test(messageId)
    && expectedProposalVersion
    && expectedRosterFingerprint,
  );

  useEffect(() => {
    if (
      !canConfirm
      || !messageId
      || !expectedProposalVersion
      || !expectedRosterFingerprint
    ) {
      setAcceptance(null);
      setLoadState("idle");
      return;
    }

    let active = true;
    setAcceptance(null);
    setActionError(null);
    setLoadState("loading");
    const exactRevision = { expectedProposalVersion, expectedRosterFingerprint };
    getMediationAcceptance(messageId, exactRevision)
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
  }, [
    canConfirm,
    expectedProposalVersion,
    expectedRosterFingerprint,
    loadAttempt,
    messageId,
  ]);

  async function acceptResolution() {
    if (
      !messageId
      || !expectedProposalVersion
      || !expectedRosterFingerprint
      || accepting
      || loadState !== "ready"
      || !canAcceptMediationResolution(acceptance)
    ) return;

    setAccepting(true);
    setActionError(null);
    try {
      const exactRevision = { expectedProposalVersion, expectedRosterFingerprint };
      const nextAcceptance = await acceptMediationResolution(messageId, exactRevision);
      setAcceptance({
        ...nextAcceptance,
        partnerLinked: nextAcceptance.partnerLinked ?? acceptance?.partnerLinked,
      });
    } catch {
      setActionError({
        kind: "accept",
        message: "확인을 저장하지 못했어요. 기존 상태는 바꾸지 않았어요.",
      });
    } finally {
      setAccepting(false);
    }
  }

  async function withdrawAcceptance() {
    if (
      !messageId
      || !expectedProposalVersion
      || !expectedRosterFingerprint
      || withdrawing
      || loadState !== "ready"
      || !canWithdrawMediationAcceptance(acceptance)
    ) return;

    setWithdrawing(true);
    setActionError(null);
    try {
      const exactRevision = { expectedProposalVersion, expectedRosterFingerprint };
      const nextAcceptance = await withdrawMediationAcceptance(messageId, exactRevision);
      setAcceptance({
        ...nextAcceptance,
        partnerLinked: nextAcceptance.partnerLinked ?? acceptance?.partnerLinked,
      });
    } catch {
      setActionError({
        kind: "withdraw",
        message: "내 확인을 취소하지 못했어요. 기존 확인 상태는 그대로 유지했어요.",
      });
    } finally {
      setWithdrawing(false);
    }
  }

  if (renderSafetyFallback) {
    return (
      <View
        style={styles.safetyFallback}
        accessibilityRole="alert"
        accessibilityLabel={MEDIATION_RENDER_SAFETY_FALLBACK}
      >
        <Text style={styles.safetyFallbackText}>
          {MEDIATION_RENDER_SAFETY_FALLBACK}
        </Text>
      </View>
    );
  }

  // 이 카드에 담긴 말은 요청한 사람이 직접 쓴 요약뿐이다. 상대의 메시지는 서버가
  // 모델에 보내지도 않는다. 그러니 아모라가 양쪽 이야기를 다 듣고 정리한 것처럼 쓰면
  // 사실이 아니고, 그 카드를 읽는 상대는 아모라가 저쪽 편을 들었다고 이해한다.
  // 웹 카드와 같은 문구를 쓴다 — 같은 사실을 두 화면이 다르게 말하면 안 된다.
  const requesterSummaryOnly = block.requesterSummaryOnly === true;

  const sections = [
    {
      key: "empathy",
      title: requesterSummaryOnly ? "요청자가 전한 감정" : "전해진 감정",
      Icon: Heart,
      color: "#8B6B24",
      backgroundColor: "#FEF9E8",
      borderColor: "#E9D59F",
      text: block.empathy,
    },
    {
      key: "translation",
      title: requesterSummaryOnly ? "요청자가 전한 상황" : "상황 정리",
      Icon: MessagesSquare,
      color: colors.noir[800],
      backgroundColor: "#F2F7F5",
      borderColor: colors.sage.pale,
      text: block.translation,
    },
    {
      key: "data",
      title: requesterSummaryOnly ? "상대방에게 확인할 점" : "확인할 내용",
      Icon: BarChart3,
      color: colors.textSecondary,
      backgroundColor: colors.ivory[100],
      borderColor: colors.border,
      text: block.data,
    },
    {
      key: "resolution",
      title: "같이 검토할 선택안",
      Icon: Scale,
      color: colors.rose[600],
      backgroundColor: colors.surface,
      borderColor: colors.rose.light,
      text: block.resolution,
    },
  ].filter((section) => Boolean(section.text));

  if (sections.length === 0) return null;

  return (
    <View
      style={styles.container}
      accessibilityLabel={requesterSummaryOnly
        ? "요청자 요약 기반 조율 초안"
        : "확인 출처가 없는 이전 조율 초안"}
    >
      <View style={styles.intro}>
        <Scale size={16} color={colors.noir[800]} />
        <View style={styles.introTextWrap}>
          <Text style={styles.introTitle}>
            {requesterSummaryOnly ? "요청자 요약 기반 조율 초안" : "확인 출처가 없는 이전 조율 초안"}
          </Text>
          <Text style={styles.introCopy}>
            {requesterSummaryOnly
              ? "요청자가 직접 적은 요약을 바탕으로 만든 조율 초안이에요. 상대방의 생각은 아직 확인되지 않았어요."
              : "확인 출처가 없는 이전 조율 초안이에요. 내용은 참고만 하고 새 공동 결정으로 확인하려면 조율 초안을 다시 요청해 주세요."}
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
          <Text style={styles.confirmationTitle}>이 선택안을 함께 확인할까요?</Text>
          <Text style={styles.confirmationCopy}>
            한 사람의 확인만으로 공동 결정이 되지 않아요. 두 분이 각각 확인한 뒤에만 공동 결정으로 저장해요.
          </Text>

          {loadState === "loading" && (
            <View
              style={styles.statusRow}
              accessibilityLiveRegion="polite"
              accessibilityLabel="확인 상태를 불러오는 중이에요"
            >
              <ActivityIndicator size="small" color={colors.noir[800]} />
              <Text style={styles.loadingText}>확인 상태를 불러오는 중이에요</Text>
            </View>
          )}

          {loadState === "error" && (
            <View style={styles.errorBlock} accessibilityLiveRegion="polite">
              <Text style={styles.errorText} accessibilityRole="alert">
                확인 상태를 불러오지 못했어요. 상태 확인 전에는 버튼을 열지 않았어요.
              </Text>
              <Pressable
                style={({ pressed }) => [styles.retryButton, pressed && styles.buttonPressed]}
                onPress={() => setLoadAttempt((attempt) => attempt + 1)}
                accessibilityRole="button"
                accessibilityLabel="확인 상태 다시 불러오기"
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
                  ? "두 분이 각각 확인해 공동 결정으로 저장했어요"
                  : "내가 확인한 결정으로 저장했어요"}
              </Text>
            </View>
          )}

          {loadState === "ready" && acceptance?.accepted && !acceptance.completed && (
            <View style={styles.waitingBlock}>
              <View style={styles.waitingStatus} accessibilityLiveRegion="polite">
                <Users size={18} color={colors.rose[600]} />
                <Text style={styles.waitingText}>
                  내가 확인했어요{"\n"}상대방의 확인을 기다리고 있어요
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
                accessibilityLabel="상대방 확인 상태 새로고침"
              >
                <RefreshCw size={16} color={colors.noir[800]} />
                <Text style={styles.retryButtonText}>확인 상태 새로고침</Text>
              </Pressable>
            </View>
          )}

          {loadState === "ready"
            && acceptance
            && acceptance.partnerLinked !== true
            && !acceptance.accepted
            && !acceptance.completed
            && (
              <View style={styles.waitingStatus} accessibilityLiveRegion="polite">
                <Users size={18} color={colors.textSecondary} />
                <Text style={styles.waitingText}>
                  파트너가 연결된 뒤 두 분이 각각 확인할 수 있어요
                </Text>
              </View>
            )}

          {loadState === "ready"
            && canAcceptMediationResolution(acceptance)
            && actionError?.kind !== "accept"
            && (
            <Pressable
              style={({ pressed }) => [
                styles.confirmButton,
                pressed && styles.buttonPressed,
                accepting && styles.buttonDisabled,
              ]}
              onPress={() => void acceptResolution()}
              disabled={accepting}
              accessibilityRole="button"
              accessibilityLabel="이 선택안을 나는 확인했어요"
              accessibilityState={{ disabled: accepting, busy: accepting }}
            >
              {accepting
                ? <ActivityIndicator size="small" color={colors.surface} />
                : <Check size={18} color={colors.surface} />}
              <Text style={styles.confirmButtonText}>
                {accepting ? "확인을 저장하는 중이에요" : "이 선택안을 나는 확인했어요"}
              </Text>
            </Pressable>
          )}

          {loadState === "ready"
            && acceptance
            && !acceptance.completed
            && acceptance.partnerLinked === true
            && acceptance.requiredCount > 1
            && (
            <Text style={styles.progressText} accessibilityLiveRegion="polite">
              {acceptance.acceptedCount}/{acceptance.requiredCount}명 확인 · 두 분 모두 확인해야 공동 결정으로 저장돼요
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
                    : "확인 저장 다시 시도"
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
                    : "확인 저장 다시 시도"}
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
  safetyFallback: {
    marginTop: 8,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.ivory[100],
  },
  safetyFallbackText: {
    fontSize: 13,
    lineHeight: 20,
    fontFamily: "NotoSansKR_400Regular",
    color: colors.textSecondary,
  },
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
