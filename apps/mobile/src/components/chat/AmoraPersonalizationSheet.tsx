import { useCallback, useEffect, useRef, useState } from "react";
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
import { ArrowLeft, Check, RotateCcw, X } from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, radius, spacing } from "@hanbang/design-tokens";

import { apiFetchForExpectedUser } from "@/lib/api";
import {
  buildBlockedOutcomePersonalizationSaveBody,
  buildChangedOutcomePersonalizationSaveBody,
  buildCompletedOutcomePersonalizationSaveBody,
  buildFamilyMomentPersonalizationSaveBody,
  buildProgressivePersonalizationSaveBody,
  buildUncertainOutcomePersonalizationSaveBody,
  parseAmoraPersonalizationConflict,
  parseAmoraPersonalizationEnvelope,
  type AmoraAnswerDetail,
  type AmoraDecisionStart,
  type AmoraFamilyOrder,
  type AmoraPersonalizationProfile,
  type AmoraSupportOrder,
  type AmoraWorkMode,
} from "@/lib/amoraPersonalization.mjs";
import { supabase } from "@/lib/supabase";

interface AmoraPersonalizationSheetProps {
  visible: boolean;
  expectedOwnerUserId: string | null;
  entryPoint?:
    | "general"
    | "blocked_action"
    | "uncertain_action"
    | "changed_action"
    | "completed_action"
    | "family_moment";
  familyMomentContext?: Readonly<{
    momentType: "sanggyeonrye" | "family_greeting";
    attentionWindow: "d3" | "d1";
  }>;
  onClose: () => void;
}

type Step = "support" | "detail" | "success";
type LoadState = "idle" | "loading" | "ready" | "error";

const SUPPORT_OPTIONS: readonly {
  value: AmoraSupportOrder;
  label: string;
  description: string;
}[] = [
  {
    value: "listen_first",
    label: "먼저 들어주기",
    description: "바로 해결하기 전에 상황을 한 번 정리해요.",
  },
  {
    value: "action_first",
    label: "바로 할 일부터",
    description: "지금 움직일 수 있는 한 가지부터 보여줘요.",
  },
  {
    value: "ask_each_time",
    label: "그때마다 물어보기",
    description: "상황에 따라 원하는 도움 순서를 확인해요.",
  },
];

const DECISION_OPTIONS: readonly {
  value: AmoraDecisionStart;
  label: string;
  description: string;
}[] = [
  {
    value: "recommend_first",
    label: "추천안 하나부터",
    description: "지금 상황에 맞는 안 하나와 이유부터 보여줘요.",
  },
  {
    value: "compare_first",
    label: "선택지 비교부터",
    description: "두세 가지 선택 기준과 차이를 먼저 보여줘요.",
  },
  {
    value: "ask_each_time",
    label: "그때마다 물어보기",
    description: "결정마다 원하는 시작 방식을 먼저 확인해요.",
  },
];

const DETAIL_OPTIONS: readonly {
  value: AmoraAnswerDetail;
  label: string;
  description: string;
}[] = [
  {
    value: "brief",
    label: "짧고 핵심만",
    description: "결정과 다음 행동 위주로 간단히 봐요.",
  },
  {
    value: "adaptive",
    label: "필요한 만큼 자세히",
    description: "간단히 시작하고 필요할 때만 더 설명해요.",
  },
  {
    value: "detailed",
    label: "처음부터 자세히",
    description: "근거와 선택 기준까지 충분히 살펴봐요.",
  },
];

const CHANGED_DETAIL_OPTIONS: readonly {
  value: AmoraAnswerDetail;
  label: string;
  description: string;
}[] = [
  {
    value: "brief",
    label: "핵심 영향만",
    description: "바뀐 점과 바로 달라지는 다음 행동만 짧게 봐요.",
  },
  {
    value: "adaptive",
    label: "필요한 만큼",
    description: "핵심부터 보고 중요한 연결이 있을 때만 더 살펴봐요.",
  },
  {
    value: "detailed",
    label: "전체 영향 자세히",
    description: "일정·할 일·결정에 이어지는 영향까지 충분히 살펴봐요.",
  },
];

const WORK_MODE_OPTIONS: readonly {
  value: AmoraWorkMode;
  label: string;
  description: string;
}[] = [
  {
    value: "together",
    label: "둘이 함께 확인",
    description: "중간 과정부터 두 사람이 같이 확인하는 흐름으로 제안해요.",
  },
  {
    value: "owner_led",
    label: "한 명이 먼저 정리",
    description: "한 사람이 후보를 좁히고 둘이 마지막에 확인하는 흐름으로 제안해요.",
  },
  {
    value: "hybrid",
    label: "중요한 건 함께, 나머지는 나눠서",
    description: "되돌리기 어려운 결정은 함께 보고 나머지는 나누는 흐름으로 제안해요.",
  },
  {
    value: "ask_each_time",
    label: "그때마다 물어보기",
    description: "준비 항목마다 원하는 협업 방식을 먼저 확인해요.",
  },
];

const FAMILY_ORDER_OPTIONS: readonly {
  value: AmoraFamilyOrder;
  label: string;
  description: string;
}[] = [
  {
    value: "couple_first",
    label: "우리 둘 기준 먼저",
    description: "두 사람의 기준을 맞춘 뒤 필요한 가족 의견을 확인해요.",
  },
  {
    value: "family_input_first",
    label: "관련된 의견부터 확인",
    description: "실제로 영향을 받는 가족의 조건부터 모으되 최종 결정으로 단정하지 않아요.",
  },
  {
    value: "case_by_case",
    label: "상황마다 정하기",
    description: "비용과 참석 여부처럼 이번 결정의 영향을 보고 순서를 정해요.",
  },
  {
    value: "ask_each_time",
    label: "그때마다 물어보기",
    description: "가족 조율이 필요한 결정마다 누구부터 확인할지 물어봐요.",
  },
];

async function currentVerifiedUserId(): Promise<string | null> {
  const { data, error } = await supabase.auth.getUser();
  return error ? null : data.user?.id ?? null;
}

function payloadError(payload: unknown, fallback: string): string {
  if (
    payload
    && typeof payload === "object"
    && !Array.isArray(payload)
    && typeof (payload as Record<string, unknown>).error === "string"
  ) {
    const message = (payload as Record<string, unknown>).error as string;
    if (message.length > 0 && message.length <= 240) return message;
  }
  return fallback;
}

function optionLabel<T extends string>(
  options: readonly { value: T; label: string }[],
  value: T,
): string {
  return options.find((option) => option.value === value)?.label ?? "선택한 방식";
}

export default function AmoraPersonalizationSheet({
  visible,
  expectedOwnerUserId,
  entryPoint = "general",
  familyMomentContext,
  onClose,
}: AmoraPersonalizationSheetProps) {
  const blockedOutcomeEntry = entryPoint === "blocked_action";
  const uncertainOutcomeEntry = entryPoint === "uncertain_action";
  const changedOutcomeEntry = entryPoint === "changed_action";
  const completedOutcomeEntry = entryPoint === "completed_action";
  const familyMomentEntry = entryPoint === "family_moment";
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [loadError, setLoadError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [saving, setSaving] = useState(false);
  const [step, setStep] = useState<Step>("support");
  const [profile, setProfile] = useState<AmoraPersonalizationProfile | null>(null);
  const [supportOrder, setSupportOrder] = useState<AmoraSupportOrder>("ask_each_time");
  const [decisionStart, setDecisionStart] = useState<AmoraDecisionStart>("ask_each_time");
  const [answerDetail, setAnswerDetail] = useState<AmoraAnswerDetail>("adaptive");
  const [workMode, setWorkMode] = useState<AmoraWorkMode>("ask_each_time");
  const [familyOrder, setFamilyOrder] = useState<AmoraFamilyOrder>("ask_each_time");
  const operationGeneration = useRef(0);
  const requestController = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    const ownerUserId = expectedOwnerUserId;
    const operation = ++operationGeneration.current;
    requestController.current?.abort();
    const controller = new AbortController();
    requestController.current = controller;
    setLoadState("loading");
    setLoadError("");
    setSaveError("");
    setStep("support");
    setProfile(null);

    try {
      if (!ownerUserId || await currentVerifiedUserId() !== ownerUserId) {
        throw new Error("현재 계정을 다시 확인해 주세요.");
      }
      const response = await apiFetchForExpectedUser(
        ownerUserId,
        "/api/amora/personalization",
        {
          method: "GET",
          headers: { Accept: "application/json" },
          signal: controller.signal,
        },
      );
      const payload: unknown = await response.json().catch(() => null);
      if (
        controller.signal.aborted
        || operation !== operationGeneration.current
        || await currentVerifiedUserId() !== ownerUserId
      ) return;
      const parsed = parseAmoraPersonalizationEnvelope(payload);
      if (!response.ok || !parsed) {
        throw new Error(payloadError(payload, "도움 방식을 불러오지 못했어요."));
      }
      setProfile(parsed.profile);
      setSupportOrder(parsed.profile?.preferences.supportOrder ?? "ask_each_time");
      setDecisionStart(parsed.profile?.preferences.decisionStart ?? "ask_each_time");
      setAnswerDetail(parsed.profile?.preferences.answerDetail ?? "adaptive");
      setWorkMode(parsed.profile?.preferences.workMode ?? "ask_each_time");
      setFamilyOrder(parsed.profile?.preferences.familyOrder ?? "ask_each_time");
      setLoadState("ready");
    } catch (error) {
      if (controller.signal.aborted || operation !== operationGeneration.current) return;
      setProfile(null);
      setLoadState("error");
      setLoadError(
        error instanceof Error && error.message
          ? error.message
          : "도움 방식을 불러오지 못했어요.",
      );
    }
  }, [expectedOwnerUserId]);

  useEffect(() => {
    if (!visible) {
      operationGeneration.current += 1;
      requestController.current?.abort();
      requestController.current = null;
      setLoadState("idle");
      return;
    }
    void load();
    return () => {
      operationGeneration.current += 1;
      requestController.current?.abort();
      requestController.current = null;
    };
  }, [load, visible]);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!visible || session?.user.id === expectedOwnerUserId) return;
      operationGeneration.current += 1;
      requestController.current?.abort();
      requestController.current = null;
      setProfile(null);
      setSaving(false);
      setLoadState("error");
      setLoadError("계정이 바뀌어 도움 방식 설정을 닫아야 해요.");
    });
    return () => subscription.unsubscribe();
  }, [expectedOwnerUserId, visible]);

  async function save() {
    if (loadState !== "ready" || saving || !expectedOwnerUserId) return;
    const body = familyMomentEntry
      ? familyMomentContext
        ? buildFamilyMomentPersonalizationSaveBody(profile, {
            momentType: familyMomentContext.momentType,
            attentionWindow: familyMomentContext.attentionWindow,
            familyOrder,
          })
        : null
      : blockedOutcomeEntry
      ? buildBlockedOutcomePersonalizationSaveBody(profile, {
          outcome: "blocked",
          supportOrder,
        })
      : uncertainOutcomeEntry
        ? buildUncertainOutcomePersonalizationSaveBody(profile, {
            outcome: "not_sure",
            decisionStart,
          })
        : changedOutcomeEntry
          ? buildChangedOutcomePersonalizationSaveBody(profile, {
              outcome: "changed",
              answerDetail,
            })
          : completedOutcomeEntry
            ? buildCompletedOutcomePersonalizationSaveBody(profile, {
                outcome: "completed",
                workMode,
              })
            : buildProgressivePersonalizationSaveBody(profile, {
                supportOrder,
                answerDetail,
              });
    if (!body) {
      setSaveError("선택한 도움 방식을 다시 확인해 주세요.");
      return;
    }

    const ownerUserId = expectedOwnerUserId;
    const operation = ++operationGeneration.current;
    requestController.current?.abort();
    const controller = new AbortController();
    requestController.current = controller;
    setSaving(true);
    setSaveError("");
    try {
      if (await currentVerifiedUserId() !== ownerUserId) {
        throw new Error("계정이 바뀌어 저장하지 않았어요.");
      }
      const response = await apiFetchForExpectedUser(
        ownerUserId,
        "/api/amora/personalization",
        {
          method: "PUT",
          headers: { Accept: "application/json" },
          body: JSON.stringify(body),
          signal: controller.signal,
        },
      );
      const payload: unknown = await response.json().catch(() => null);
      if (
        controller.signal.aborted
        || operation !== operationGeneration.current
        || await currentVerifiedUserId() !== ownerUserId
      ) return;
      if (response.status === 409) {
        const conflict = parseAmoraPersonalizationConflict(payload);
        if (conflict?.current) {
          setProfile(conflict.current);
          setSaveError("다른 화면에서 설정이 바뀌었어요. 내 선택을 다시 저장해 주세요.");
          return;
        }
      }
      const parsed = parseAmoraPersonalizationEnvelope(payload);
      if (!response.ok || !parsed?.profile) {
        throw new Error(payloadError(payload, "도움 방식을 저장하지 못했어요."));
      }
      setProfile(parsed.profile);
      setStep("success");
    } catch (error) {
      if (controller.signal.aborted || operation !== operationGeneration.current) return;
      setSaveError(
        error instanceof Error && error.message
          ? error.message
          : "도움 방식을 저장하지 못했어요. 기존 설정은 그대로예요.",
      );
    } finally {
      if (operation === operationGeneration.current) {
        requestController.current = null;
        setSaving(false);
      }
    }
  }

  function close() {
    if (saving) return;
    operationGeneration.current += 1;
    requestController.current?.abort();
    requestController.current = null;
    onClose();
  }

  const supportLabel = optionLabel(SUPPORT_OPTIONS, supportOrder);
  const decisionStartLabel = optionLabel(DECISION_OPTIONS, decisionStart);
  const detailLabel = optionLabel(DETAIL_OPTIONS, answerDetail);
  const changedDetailLabel = optionLabel(CHANGED_DETAIL_OPTIONS, answerDetail);
  const workModeLabel = optionLabel(WORK_MODE_OPTIONS, workMode);
  const familyOrderLabel = optionLabel(FAMILY_ORDER_OPTIONS, familyOrder);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={close}
    >
      <View
        style={styles.overlay}
        accessibilityViewIsModal
        accessibilityLabel="아모라 도움 방식 설정"
        importantForAccessibility="yes"
      >
        <View
          style={[
            styles.sheet,
            {
              maxHeight: Math.min(height * 0.84, 720),
              paddingBottom: Math.max(insets.bottom, spacing[4]),
            },
          ]}
        >
          <View style={styles.header}>
            {step === "detail" && loadState === "ready" ? (
              <Pressable
                style={styles.iconButton}
                onPress={() => {
                  setSaveError("");
                  setStep("support");
                }}
                disabled={saving}
                accessibilityRole="button"
                accessibilityLabel="이전 질문으로"
              >
                <ArrowLeft size={20} color={colors.noir[800]} />
              </Pressable>
            ) : (
              <View style={styles.iconPlaceholder} />
            )}
            <View style={styles.headerCopy}>
              <Text style={styles.eyebrow}>나만의 아모라</Text>
              <Text style={styles.headerTitle}>도움 방식 맞추기</Text>
            </View>
            <Pressable
              style={styles.iconButton}
              onPress={close}
              disabled={saving}
              accessibilityRole="button"
              accessibilityLabel="도움 방식 설정 닫기"
              accessibilityState={{ disabled: saving }}
            >
              <X size={20} color={colors.noir[800]} />
            </Pressable>
          </View>

          {loadState === "loading" || loadState === "idle" ? (
            <View style={styles.centerState} accessibilityRole="progressbar">
              <ActivityIndicator color={colors.rose[500]} />
              <Text style={styles.stateText}>지금 도움 방식을 확인하는 중이에요</Text>
            </View>
          ) : loadState === "error" ? (
            <View style={styles.centerState} accessibilityRole="alert">
              <RotateCcw size={24} color={colors.rose[600]} />
              <Text style={styles.stateTitle}>설정을 열지 못했어요</Text>
              <Text style={styles.stateText}>{loadError}</Text>
              <Pressable
                style={({ pressed }) => [styles.retryButton, pressed && styles.pressed]}
                onPress={() => void load()}
                accessibilityRole="button"
                accessibilityLabel="도움 방식 다시 불러오기"
              >
                <Text style={styles.retryText}>다시 불러오기</Text>
              </Pressable>
            </View>
          ) : (
            <ScrollView
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={styles.content}
            >
              {step === "support" ? (
                familyMomentEntry ? (
                  <>
                    <Text style={styles.question}>이 일정은 누구의 기준부터 맞출까요?</Text>
                    <Text style={styles.description}>
                      정답이나 의무를 만들지 않아요. 내가 고른 순서로만 가족 관련 질문과 다음 행동을 정리해요.
                    </Text>
                    <View style={styles.options} accessibilityRole="radiogroup">
                      {FAMILY_ORDER_OPTIONS.map((option) => {
                        const selected = familyOrder === option.value;
                        return (
                          <Pressable
                            key={option.value}
                            style={({ pressed }) => [
                              styles.option,
                              selected && styles.optionSelected,
                              pressed && styles.pressed,
                            ]}
                            onPress={() => {
                              setFamilyOrder(option.value);
                              setSaveError("");
                            }}
                            disabled={saving}
                            accessibilityRole="radio"
                            accessibilityState={{ checked: selected, disabled: saving }}
                            accessibilityLabel={`${option.label}. ${option.description}`}
                          >
                            <View style={styles.optionCopy}>
                              <Text style={[styles.optionLabel, selected && styles.optionLabelSelected]}>
                                {option.label}
                              </Text>
                              <Text style={styles.optionDescription}>{option.description}</Text>
                            </View>
                            {selected ? <Check size={18} color={colors.sage[500]} /> : null}
                          </Pressable>
                        );
                      })}
                    </View>
                    {saveError ? (
                      <Text style={styles.errorText} accessibilityRole="alert">
                        {saveError}
                      </Text>
                    ) : null}
                    <Pressable
                      style={({ pressed }) => [
                        styles.primaryButton,
                        pressed && !saving && styles.pressed,
                        saving && styles.disabled,
                      ]}
                      onPress={() => void save()}
                      disabled={saving}
                      accessibilityRole="button"
                      accessibilityLabel="가족 조율 순서 저장하기"
                      accessibilityState={{ disabled: saving }}
                    >
                      {saving ? <ActivityIndicator size="small" color="#FFFFFF" /> : null}
                      <Text style={styles.primaryButtonText}>이렇게 맞추기</Text>
                    </Pressable>
                  </>
                ) : uncertainOutcomeEntry ? (
                  <>
                    <Text style={styles.question}>아직 모르겠을 때, 무엇부터 볼까요?</Text>
                    <Text style={styles.description}>
                      결정을 대신하지 않아요. 내가 고른 시작 방식으로만 정리해요.
                    </Text>
                    <View style={styles.options} accessibilityRole="radiogroup">
                      {DECISION_OPTIONS.map((option) => {
                        const selected = decisionStart === option.value;
                        return (
                          <Pressable
                            key={option.value}
                            style={({ pressed }) => [
                              styles.option,
                              selected && styles.optionSelected,
                              pressed && styles.pressed,
                            ]}
                            onPress={() => {
                              setDecisionStart(option.value);
                              setSaveError("");
                            }}
                            disabled={saving}
                            accessibilityRole="radio"
                            accessibilityState={{ checked: selected, disabled: saving }}
                            accessibilityLabel={`${option.label}. ${option.description}`}
                          >
                            <View style={styles.optionCopy}>
                              <Text style={[styles.optionLabel, selected && styles.optionLabelSelected]}>
                                {option.label}
                              </Text>
                              <Text style={styles.optionDescription}>{option.description}</Text>
                            </View>
                            {selected ? <Check size={18} color={colors.sage[500]} /> : null}
                          </Pressable>
                        );
                      })}
                    </View>
                    {saveError ? (
                      <Text style={styles.errorText} accessibilityRole="alert">
                        {saveError}
                      </Text>
                    ) : null}
                    <Pressable
                      style={({ pressed }) => [
                        styles.primaryButton,
                        pressed && !saving && styles.pressed,
                        saving && styles.disabled,
                      ]}
                      onPress={() => void save()}
                      disabled={saving}
                      accessibilityRole="button"
                      accessibilityLabel="결정 시작 방식 저장하기"
                      accessibilityState={{ disabled: saving }}
                    >
                      {saving ? <ActivityIndicator size="small" color="#FFFFFF" /> : null}
                      <Text style={styles.primaryButtonText}>이렇게 맞추기</Text>
                    </Pressable>
                  </>
                ) : completedOutcomeEntry ? (
                  <>
                    <Text style={styles.question}>다음 준비는 어떻게 나눌까요?</Text>
                    <Text style={styles.description}>
                      담당자를 자동으로 정하지 않아요. 내가 고른 방식으로만 다음 행동을 제안해요.
                    </Text>
                    <View style={styles.options} accessibilityRole="radiogroup">
                      {WORK_MODE_OPTIONS.map((option) => {
                        const selected = workMode === option.value;
                        return (
                          <Pressable
                            key={option.value}
                            style={({ pressed }) => [
                              styles.option,
                              selected && styles.optionSelected,
                              pressed && styles.pressed,
                            ]}
                            onPress={() => {
                              setWorkMode(option.value);
                              setSaveError("");
                            }}
                            disabled={saving}
                            accessibilityRole="radio"
                            accessibilityState={{ checked: selected, disabled: saving }}
                            accessibilityLabel={`${option.label}. ${option.description}`}
                          >
                            <View style={styles.optionCopy}>
                              <Text style={[styles.optionLabel, selected && styles.optionLabelSelected]}>
                                {option.label}
                              </Text>
                              <Text style={styles.optionDescription}>{option.description}</Text>
                            </View>
                            {selected ? <Check size={18} color={colors.sage[500]} /> : null}
                          </Pressable>
                        );
                      })}
                    </View>
                    {saveError ? (
                      <Text style={styles.errorText} accessibilityRole="alert">
                        {saveError}
                      </Text>
                    ) : null}
                    <Pressable
                      style={({ pressed }) => [
                        styles.primaryButton,
                        pressed && !saving && styles.pressed,
                        saving && styles.disabled,
                      ]}
                      onPress={() => void save()}
                      disabled={saving}
                      accessibilityRole="button"
                      accessibilityLabel="협업 방식 저장하기"
                      accessibilityState={{ disabled: saving }}
                    >
                      {saving ? <ActivityIndicator size="small" color="#FFFFFF" /> : null}
                      <Text style={styles.primaryButtonText}>이렇게 맞추기</Text>
                    </Pressable>
                  </>
                ) : changedOutcomeEntry ? (
                  <>
                    <Text style={styles.question}>바뀐 뒤, 어디까지 다시 볼까요?</Text>
                    <Text style={styles.description}>
                      확정된 건 그대로 두고, 내가 고른 범위로 바뀐 영향만 다시 살펴봐요.
                    </Text>
                    <View style={styles.options} accessibilityRole="radiogroup">
                      {CHANGED_DETAIL_OPTIONS.map((option) => {
                        const selected = answerDetail === option.value;
                        return (
                          <Pressable
                            key={option.value}
                            style={({ pressed }) => [
                              styles.option,
                              selected && styles.optionSelected,
                              pressed && styles.pressed,
                            ]}
                            onPress={() => {
                              setAnswerDetail(option.value);
                              setSaveError("");
                            }}
                            disabled={saving}
                            accessibilityRole="radio"
                            accessibilityState={{ checked: selected, disabled: saving }}
                            accessibilityLabel={`${option.label}. ${option.description}`}
                          >
                            <View style={styles.optionCopy}>
                              <Text style={[styles.optionLabel, selected && styles.optionLabelSelected]}>
                                {option.label}
                              </Text>
                              <Text style={styles.optionDescription}>{option.description}</Text>
                            </View>
                            {selected ? <Check size={18} color={colors.sage[500]} /> : null}
                          </Pressable>
                        );
                      })}
                    </View>
                    {saveError ? (
                      <Text style={styles.errorText} accessibilityRole="alert">
                        {saveError}
                      </Text>
                    ) : null}
                    <Pressable
                      style={({ pressed }) => [
                        styles.primaryButton,
                        pressed && !saving && styles.pressed,
                        saving && styles.disabled,
                      ]}
                      onPress={() => void save()}
                      disabled={saving}
                      accessibilityRole="button"
                      accessibilityLabel="변경 영향 보기 방식 저장하기"
                      accessibilityState={{ disabled: saving }}
                    >
                      {saving ? <ActivityIndicator size="small" color="#FFFFFF" /> : null}
                      <Text style={styles.primaryButtonText}>이렇게 맞추기</Text>
                    </Pressable>
                  </>
                ) : (
                  <>
                  {blockedOutcomeEntry ? null : <Text style={styles.step}>1 / 2</Text>}
                  <Text style={styles.question}>
                    {blockedOutcomeEntry
                      ? "막혔을 때, 어떻게 먼저 도울까요?"
                      : "지금은 어떻게 도와주면 편해요?"}
                  </Text>
                  <Text style={styles.description}>
                    {blockedOutcomeEntry
                      ? "이번 결과만으로 성향을 단정하거나 자동으로 바꾸지 않아요. 내가 확인한 순서만 다음 도움에 반영해요."
                      : "성격을 추측하지 않아요. 내가 고른 순서로만 답해요."}
                  </Text>
                  <View style={styles.options} accessibilityRole="radiogroup">
                    {SUPPORT_OPTIONS.map((option) => {
                      const selected = supportOrder === option.value;
                      return (
                        <Pressable
                          key={option.value}
                          style={({ pressed }) => [
                            styles.option,
                            selected && styles.optionSelected,
                            pressed && styles.pressed,
                          ]}
                          onPress={() => {
                            setSupportOrder(option.value);
                            setSaveError("");
                            if (!blockedOutcomeEntry) setStep("detail");
                          }}
                          accessibilityRole="radio"
                          accessibilityState={{ checked: selected }}
                          accessibilityLabel={`${option.label}. ${option.description}`}
                        >
                          <View style={styles.optionCopy}>
                            <Text style={[styles.optionLabel, selected && styles.optionLabelSelected]}>
                              {option.label}
                            </Text>
                            <Text style={styles.optionDescription}>{option.description}</Text>
                          </View>
                          {selected ? <Check size={18} color={colors.sage[500]} /> : null}
                        </Pressable>
                      );
                    })}
                  </View>
                  {blockedOutcomeEntry ? (
                    <>
                      {saveError ? (
                        <Text style={styles.errorText} accessibilityRole="alert">
                          {saveError}
                        </Text>
                      ) : null}
                      <Pressable
                        style={({ pressed }) => [
                          styles.primaryButton,
                          pressed && !saving && styles.pressed,
                          saving && styles.disabled,
                        ]}
                        onPress={() => void save()}
                        disabled={saving}
                        accessibilityRole="button"
                        accessibilityLabel="막혔을 때 도움 순서 저장하기"
                        accessibilityState={{ disabled: saving }}
                      >
                        {saving ? <ActivityIndicator size="small" color="#FFFFFF" /> : null}
                        <Text style={styles.primaryButtonText}>이렇게 맞추기</Text>
                      </Pressable>
                    </>
                  ) : null}
                  </>
                )
              ) : step === "detail" ? (
                <>
                  <Text style={styles.step}>2 / 2</Text>
                  <Text style={styles.question}>답변은 어느 정도가 좋아요?</Text>
                  <Text style={styles.description}>
                    언제든 다시 바꿀 수 있고, 필요한 질문은 한 번에 하나만 해요.
                  </Text>
                  <View style={styles.options} accessibilityRole="radiogroup">
                    {DETAIL_OPTIONS.map((option) => {
                      const selected = answerDetail === option.value;
                      return (
                        <Pressable
                          key={option.value}
                          style={({ pressed }) => [
                            styles.option,
                            selected && styles.optionSelected,
                            pressed && styles.pressed,
                          ]}
                          onPress={() => {
                            setAnswerDetail(option.value);
                            setSaveError("");
                          }}
                          disabled={saving}
                          accessibilityRole="radio"
                          accessibilityState={{ checked: selected, disabled: saving }}
                          accessibilityLabel={`${option.label}. ${option.description}`}
                        >
                          <View style={styles.optionCopy}>
                            <Text style={[styles.optionLabel, selected && styles.optionLabelSelected]}>
                              {option.label}
                            </Text>
                            <Text style={styles.optionDescription}>{option.description}</Text>
                          </View>
                          {selected ? <Check size={18} color={colors.sage[500]} /> : null}
                        </Pressable>
                      );
                    })}
                  </View>
                  {saveError ? (
                    <Text style={styles.errorText} accessibilityRole="alert">
                      {saveError}
                    </Text>
                  ) : null}
                  <Pressable
                    style={({ pressed }) => [
                      styles.primaryButton,
                      pressed && !saving && styles.pressed,
                      saving && styles.disabled,
                    ]}
                    onPress={() => void save()}
                    disabled={saving}
                    accessibilityRole="button"
                    accessibilityLabel="선택한 도움 방식 저장하기"
                    accessibilityState={{ disabled: saving }}
                  >
                    {saving ? <ActivityIndicator size="small" color="#FFFFFF" /> : null}
                    <Text style={styles.primaryButtonText}>이대로 맞추기</Text>
                  </Pressable>
                </>
              ) : (
                <View style={styles.success} accessibilityLiveRegion="polite">
                  <View style={styles.successIcon}>
                    <Check size={26} color={colors.sage[500]} />
                  </View>
                  <Text style={styles.stateTitle}>아모라가 이렇게 도울게요</Text>
                  <Text style={styles.successSummary}>
                    {familyMomentEntry
                      ? familyOrderLabel
                      : blockedOutcomeEntry
                        ? supportLabel
                      : uncertainOutcomeEntry
                        ? decisionStartLabel
                        : changedOutcomeEntry
                          ? changedDetailLabel
                          : completedOutcomeEntry
                            ? workModeLabel
                            : `${supportLabel} · ${detailLabel}`}
                  </Text>
                  <Text style={styles.stateText}>
                    다음 대화부터 반영돼요. 다른 준비 기록이나 공유 권한은 바뀌지 않았어요.
                  </Text>
                  <Pressable
                    style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}
                    onPress={close}
                    accessibilityRole="button"
                    accessibilityLabel={familyMomentEntry ? "가족 조율 방식 설정 완료" : "도움 방식 설정 완료"}
                  >
                    <Text style={styles.primaryButtonText}>
                      {familyMomentEntry ? "일정 준비로 돌아가기" : "대화 시작하기"}
                    </Text>
                  </Pressable>
                </View>
              )}
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(36, 56, 50, 0.42)",
  },
  sheet: {
    width: "100%",
    borderTopLeftRadius: radius["2xl"],
    borderTopRightRadius: radius["2xl"],
    backgroundColor: colors.ivory[50],
    paddingTop: spacing[4],
    paddingHorizontal: spacing[5],
  },
  header: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing[2],
  },
  headerCopy: { flex: 1, alignItems: "center" },
  eyebrow: {
    fontSize: 11,
    lineHeight: 16,
    fontFamily: "NotoSansKR_600SemiBold",
    color: colors.rose[600],
  },
  headerTitle: {
    fontSize: 16,
    lineHeight: 23,
    fontFamily: "NotoSansKR_700Bold",
    color: colors.noir[800],
  },
  iconButton: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.full,
  },
  iconPlaceholder: { width: 44, height: 44 },
  content: { paddingTop: spacing[4], paddingBottom: spacing[2] },
  step: {
    fontSize: 12,
    lineHeight: 18,
    fontFamily: "NotoSansKR_600SemiBold",
    color: colors.rose[600],
  },
  question: {
    marginTop: spacing[1],
    fontSize: 21,
    lineHeight: 31,
    fontFamily: "NotoSansKR_700Bold",
    color: colors.textPrimary,
  },
  description: {
    marginTop: spacing[2],
    fontSize: 13,
    lineHeight: 20,
    fontFamily: "NotoSansKR_400Regular",
    color: colors.textSecondary,
  },
  options: { marginTop: spacing[4], gap: spacing[2] },
  option: {
    minHeight: 64,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.xl,
    backgroundColor: colors.surface,
  },
  optionSelected: {
    borderColor: colors.sage[500],
    backgroundColor: colors.ivory[100],
  },
  optionCopy: { flex: 1, gap: spacing[1] },
  optionLabel: {
    fontSize: 14,
    lineHeight: 21,
    fontFamily: "NotoSansKR_600SemiBold",
    color: colors.textPrimary,
  },
  optionLabelSelected: { color: colors.noir[800] },
  optionDescription: {
    fontSize: 12,
    lineHeight: 18,
    fontFamily: "NotoSansKR_400Regular",
    color: colors.textSecondary,
  },
  primaryButton: {
    minHeight: 48,
    marginTop: spacing[4],
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing[2],
    borderRadius: radius.lg,
    backgroundColor: colors.noir[800],
    paddingHorizontal: spacing[4],
  },
  primaryButtonText: {
    fontSize: 14,
    lineHeight: 21,
    fontFamily: "NotoSansKR_700Bold",
    color: "#FFFFFF",
  },
  errorText: {
    marginTop: spacing[3],
    fontSize: 12,
    lineHeight: 18,
    fontFamily: "NotoSansKR_400Regular",
    color: colors.danger,
  },
  centerState: {
    minHeight: 260,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing[3],
    paddingVertical: spacing[8],
  },
  stateTitle: {
    textAlign: "center",
    fontSize: 18,
    lineHeight: 27,
    fontFamily: "NotoSansKR_700Bold",
    color: colors.textPrimary,
  },
  stateText: {
    textAlign: "center",
    fontSize: 13,
    lineHeight: 20,
    fontFamily: "NotoSansKR_400Regular",
    color: colors.textSecondary,
  },
  retryButton: {
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing[4],
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
  },
  retryText: {
    fontSize: 13,
    lineHeight: 20,
    fontFamily: "NotoSansKR_600SemiBold",
    color: colors.rose[600],
  },
  success: { alignItems: "center", paddingTop: spacing[6], paddingBottom: spacing[4] },
  successIcon: {
    width: 56,
    height: 56,
    marginBottom: spacing[4],
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.full,
    backgroundColor: colors.sage.pale,
  },
  successSummary: {
    marginTop: spacing[2],
    marginBottom: spacing[3],
    fontSize: 14,
    lineHeight: 21,
    fontFamily: "NotoSansKR_600SemiBold",
    color: colors.noir[800],
  },
  pressed: { opacity: 0.72 },
  disabled: { opacity: 0.55 },
});
