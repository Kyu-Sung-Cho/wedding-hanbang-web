// 온보딩 화면.
// 중립 준비 공간이 켜지면 한 화면(역할·예식일·예산·스타일을 묻지 않음),
// 꺼져 있으면 기존 5단계(역할 → 커플 → 결혼 상세 → 웨딩 스타일 → 완료).
// 판정은 서버가 /api/auth/me 의 capabilities 로 내려준다.
import { useState, useEffect, useRef, useCallback } from "react";
import {
  View, Text, Pressable, TextInput, StyleSheet, ScrollView,
  Alert, ActivityIndicator, Platform, Animated, Easing,
} from "react-native";
import DismissKeyboard from "@/components/DismissKeyboard";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { ArrowLeft, ArrowRight, Heart, User, CheckCircle2, Sparkles, Check } from "lucide-react-native";
import { colors } from "@hanbang/design-tokens";
import {
  WEDDING_BUDGET_TENDENCY_OPTIONS,
  WEDDING_GUEST_COUNT_OPTIONS,
  WEDDING_PRIORITY_OPTIONS,
  WEDDING_STYLE_OPTIONS,
  type WeddingBudgetTendencyValue,
  type WeddingGuestCountValue,
  type WeddingPriorityValue,
  type WeddingStyleValue,
} from "@hanbang/shared";
import { apiFetch } from "@/lib/api";
import { evaluateOnboardingBudgetManwon } from "@/lib/onboardingBudget.mjs";
import {
  COUPLE_INVITE_CODE_MAX_LENGTH,
  COUPLE_INVITE_CODE_PLACEHOLDER,
  describeCoupleInviteCodeProblem,
  isCoupleInviteCode,
  normalizeCoupleInviteCode,
  buildNeutralPreparationSpaceSubmission,
  parseNeutralPreparationSpaceCapability,
} from "@hanbang/shared";

type Role = "bride" | "groom";
type CoupleAction = "create" | "join";
type WeddingStyle = WeddingStyleValue;
type PriorityItem = WeddingPriorityValue;
type BudgetTendency = WeddingBudgetTendencyValue;
type GuestCount = WeddingGuestCountValue;

const STYLE_EMOJI: Record<WeddingStyle, string> = {
  minimal: "\u{1F90D}",
  classic: "\u{1F3DB}\uFE0F",
  fancy: "\u2728",
  natural: "\u{1F33F}",
};

const PRIORITY_EMOJI: Record<PriorityItem, string> = {
  sdm: "\u{1F4F8}",
  venue: "\u{1F3F0}",
  rings: "\u{1F48D}",
  honeymoon: "\u2708\uFE0F",
  ceremony: "\u{1F38A}",
  housing: "\u{1F3E0}",
};

const BUDGET_EMOJI: Record<BudgetTendency, string> = {
  saving: "\u{1F4B0}",
  balanced: "\u2696\uFE0F",
  premium: "\u{1F48E}",
};

const STYLE_OPTIONS = WEDDING_STYLE_OPTIONS.map((option) => ({
  ...option,
  emoji: STYLE_EMOJI[option.value],
  desc: option.description,
}));
const PRIORITY_OPTIONS = WEDDING_PRIORITY_OPTIONS.map((option) => ({
  ...option,
  emoji: PRIORITY_EMOJI[option.value],
}));
const BUDGET_OPTIONS = WEDDING_BUDGET_TENDENCY_OPTIONS.map((option) => ({
  ...option,
  emoji: BUDGET_EMOJI[option.value],
  desc: option.description,
}));
const GUEST_OPTIONS = WEDDING_GUEST_COUNT_OPTIONS;

// 축하 파티클 컴포넌트
function CelebrationDots() {
  const dots = useRef(
    Array.from({ length: 12 }, (_, i) => ({
      x: new Animated.Value(0),
      y: new Animated.Value(0),
      opacity: new Animated.Value(0),
      scale: new Animated.Value(0),
      color: i % 3 === 0 ? colors.rose[500] : i % 3 === 1 ? colors.gold.DEFAULT : colors.rose.light,
      angle: (i / 12) * Math.PI * 2,
    }))
  ).current;

  useEffect(() => {
    const animations = dots.map((dot, i) => {
      const radius = 80 + Math.random() * 40;
      const targetX = Math.cos(dot.angle) * radius;
      const targetY = Math.sin(dot.angle) * radius;

      return Animated.sequence([
        Animated.delay(i * 50),
        Animated.parallel([
          Animated.timing(dot.opacity, {
            toValue: 1,
            duration: 300,
            useNativeDriver: true,
          }),
          Animated.timing(dot.scale, {
            toValue: 1,
            duration: 400,
            easing: Easing.out(Easing.back(2)),
            useNativeDriver: true,
          }),
          Animated.timing(dot.x, {
            toValue: targetX,
            duration: 600,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
          }),
          Animated.timing(dot.y, {
            toValue: targetY,
            duration: 600,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
          }),
        ]),
        Animated.timing(dot.opacity, {
          toValue: 0,
          duration: 800,
          delay: 400,
          useNativeDriver: true,
        }),
      ]);
    });

    Animated.parallel(animations).start();
  }, [dots]);

  return (
    <View style={styles.dotsContainer}>
      {dots.map((dot, i) => (
        <Animated.View
          key={i}
          style={[
            styles.dot,
            {
              backgroundColor: dot.color,
              width: 6 + (i % 3) * 3,
              height: 6 + (i % 3) * 3,
              borderRadius: 6,
              opacity: dot.opacity,
              transform: [
                { translateX: dot.x },
                { translateY: dot.y },
                { scale: dot.scale },
              ],
            },
          ]}
        />
      ))}
    </View>
  );
}

export default function OnboardingScreen() {
  const [step, setStep] = useState(1);
  const [role, setRole] = useState<Role | null>(null);
  const [coupleAction, setCoupleAction] = useState<CoupleAction>("create");
  const [inviteCode, setInviteCode] = useState("");
  const [weddingDate, setWeddingDate] = useState("");
  const [weddingDateUndecided, setWeddingDateUndecided] = useState(false);
  const [venue, setVenue] = useState("");
  const [budget, setBudget] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [resultCode, setResultCode] = useState("");
  // 서버가 판정한다 — 앱이 자기 환경변수로 정하지 않는다.
  const [neutralEnabled, setNeutralEnabled] = useState(false);
  // 판정 전에는 어느 쪽도 그리지 않는다. 기본값으로 그리면 첫 프레임에 역할
  // 카드(신부/신랑)가 뜨고, 판정이 실패하면 그 화면이 영구가 된다.
  const [capabilitiesResolved, setCapabilitiesResolved] = useState(false);
  const [capabilitiesFailed, setCapabilitiesFailed] = useState(false);
  const [capabilityReloadKey, setCapabilityReloadKey] = useState(0);
  // 중립 경로에서 받는 유일한 선택 입력. 저장보다 첫 대화를 여는 게 목적이다.
  const [neutralFocus, setNeutralFocus] = useState<WeddingPriorityValue | null>(null);
  const budgetEvaluation = evaluateOnboardingBudgetManwon(budget);
  // 아직 다 치지 않은 상태를 틀렸다고 하지 않는다 — 타이핑 중에 빨간 글씨가 뜨면
  // 사람은 자기가 잘못한 줄 안다. 파트너 코드는 붙여넣는 경우가 많아 길이가 한 번에 찬다.
  const inviteCodeProblem = coupleAction === "join" && inviteCode.length >= 4
    ? describeCoupleInviteCodeProblem(inviteCode)
    : null;

  // Step 4: 웨딩 스타일 선호도
  const [weddingStyle, setWeddingStyle] = useState<WeddingStyle | null>(null);
  const [priorities, setPriorities] = useState<PriorityItem[]>([]);
  const [budgetTendency, setBudgetTendency] = useState<BudgetTendency | null>(null);
  const [guestCount, setGuestCount] = useState<GuestCount | null>(null);

  function togglePriority(item: PriorityItem) {
    setPriorities((prev) => {
      if (prev.includes(item)) return prev.filter((p) => p !== item);
      if (prev.length >= 3) return prev;
      return [...prev, item];
    });
  }

  // 스텝 전환 애니메이션
  const contentOpacity = useRef(new Animated.Value(1)).current;
  const contentSlide = useRef(new Animated.Value(0)).current;

  // 역할 카드 애니메이션
  const brideScale = useRef(new Animated.Value(1)).current;
  const groomScale = useRef(new Animated.Value(1)).current;

  const totalSteps = 5;

  const animateStepTransition = useCallback((nextStep: number) => {
    Animated.parallel([
      Animated.timing(contentOpacity, { toValue: 0, duration: 150, useNativeDriver: true }),
      Animated.timing(contentSlide, { toValue: -20, duration: 150, useNativeDriver: true }),
    ]).start(() => {
      setStep(nextStep);
      contentSlide.setValue(20);
      Animated.parallel([
        Animated.timing(contentOpacity, { toValue: 1, duration: 250, useNativeDriver: true }),
        Animated.timing(contentSlide, { toValue: 0, duration: 250, useNativeDriver: true }),
      ]).start();
    });
  }, [contentOpacity, contentSlide]);

  // 서버가 중립 준비 공간을 열어줬는지 확인한다. 못 읽으면 기존 5단계로 둔다 —
  // 판정 실패를 "켜짐"으로 읽으면 마이그레이션 전 기기에서 온보딩이 죽는다.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await apiFetch("/api/auth/me");
        if (!res.ok) throw new Error(`auth/me ${res.status}`);
        const data = await res.json();
        if (!cancelled) {
          setNeutralEnabled(parseNeutralPreparationSpaceCapability(data?.capabilities));
          setCapabilitiesResolved(true);
        }
      } catch {
        // 판정 실패를 "역할을 물어봐도 된다"로 읽지 않는다.
        if (!cancelled) setCapabilitiesFailed(true);
      }
    })();
    return () => { cancelled = true; };
  }, [capabilityReloadKey]);

  function handleRolePress(r: Role) {
    setRole(r);
    const anim = r === "bride" ? brideScale : groomScale;
    const other = r === "bride" ? groomScale : brideScale;
    other.setValue(1);
    Animated.sequence([
      Animated.timing(anim, { toValue: 0.95, duration: 80, useNativeDriver: true }),
      Animated.spring(anim, { toValue: 1, friction: 3, tension: 200, useNativeDriver: true }),
    ]).start();
  }

  function canNext(): boolean {
    if (neutralEnabled) {
      // 중립 경로는 한 화면이다. 초대 코드로 합류할 때만 코드가 필요하다.
      return coupleAction === "create" || isCoupleInviteCode(inviteCode);
    }
    switch (step) {
      case 1: return role !== null;
      case 2: return coupleAction === "create" || (coupleAction === "join" && isCoupleInviteCode(inviteCode));
      case 3: return budgetEvaluation.status !== "invalid";
      case 4: return true; // 선호도는 선택사항
      default: return false;
    }
  }

  async function handleSubmit() {
    if (!neutralEnabled && budgetEvaluation.status === "invalid") {
      Alert.alert("예산을 확인해주세요", budgetEvaluation.message);
      return;
    }

    setSubmitting(true);
    try {
      // 선호도 데이터를 progress.__preferences에 저장
      const progress: Record<string, unknown> = {
        __preferences: {
          weddingStyle,
          priorities,
          budgetTendency,
          guestCount,
        },
      };

      const body = neutralEnabled
        ? buildNeutralPreparationSpaceSubmission({
            coupleAction,
            partnerInviteCode: inviteCode,
            weddingDate: weddingDateUndecided ? null : weddingDate || null,
            focusPriority: neutralFocus,
          })
        : {
            role,
            coupleAction,
            partnerInviteCode: coupleAction === "join" ? inviteCode : undefined,
            weddingDate: weddingDateUndecided ? null : weddingDate || null,
            venue: venue || null,
            totalBudget: budgetEvaluation.requestBudget,
            progress,
          };

      const res = await apiFetch("/api/onboarding", {
        method: "POST",
        body: JSON.stringify(body),
      });

      const data = await res.json();
      if (!res.ok) {
        Alert.alert("오류", data.error ?? "저장에 실패했어요");
        return;
      }

      if (data.inviteCode && coupleAction === "create") {
        setResultCode(data.inviteCode);
        animateStepTransition(5);
      } else {
        router.replace("/(tabs)/dashboard");
      }
    } catch (err) {
      Alert.alert("오류", err instanceof Error ? err.message : "저장에 실패했어요");
    } finally {
      setSubmitting(false);
    }
  }

  function handleNext() {
    if (neutralEnabled && step === 1) {
      handleSubmit();
      return;
    }
    if (step === 4) {
      handleSubmit();
    } else if (step === 5) {
      router.replace("/(tabs)/dashboard");
    } else {
      animateStepTransition(step + 1);
    }
  }

  function handleBack() {
    if (step > 1 && step < 5) {
      animateStepTransition(step - 1);
    }
  }

  const nextDisabled = (!capabilitiesResolved && step === 1)
    || (!canNext() && step < 5)
    || submitting;

  return (
    <SafeAreaView style={styles.container}>
      <DismissKeyboard>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {/* 헤더 */}
        <View style={styles.header}>
          {step > 1 && step < 5 ? (
            <Pressable onPress={handleBack} hitSlop={12}>
              <ArrowLeft size={24} color={colors.noir[800]} />
            </Pressable>
          ) : <View style={{ width: 24 }} />}
          <Text style={styles.stepText}>{neutralEnabled ? "" : `${step}/${totalSteps}`}</Text>
          <View style={{ width: 24 }} />
        </View>

        {/* 진행 바 — 한 화면이면 5단계 진행 표시가 거짓말이 된다 */}
        {!neutralEnabled && (
          <View style={styles.progressBar}>
            <View style={[styles.progressFill, { width: `${(step / totalSteps) * 100}%` }]} />
          </View>
        )}

        {/* 애니메이션 래퍼 */}
        <Animated.View
          style={{
            opacity: contentOpacity,
            transform: [{ translateY: contentSlide }],
          }}
        >
          {/* Step 1(중립): 역할을 묻지 않고 한 화면에서 시작 */}
          {!capabilitiesResolved && step === 1 && (
            <View style={styles.stepContent}>
              {capabilitiesFailed ? (
                <>
                  <Text style={styles.stepTitle}>불러오지 못했어요</Text>
                  <Text style={styles.stepDesc}>
                    연결을 확인하고 다시 시도해 주세요.
                  </Text>
                  <Pressable
                    style={styles.roleCard}
                    accessibilityRole="button"
                    accessibilityLabel="다시 시도"
                    onPress={() => {
                      setCapabilitiesFailed(false);
                      setCapabilityReloadKey((n) => n + 1);
                    }}
                  >
                    <Text style={styles.roleLabel}>다시 시도</Text>
                  </Pressable>
                </>
              ) : (
                <ActivityIndicator color={colors.noir[800]} />
              )}
            </View>
          )}

          {capabilitiesResolved && step === 1 && neutralEnabled && (
            <View style={styles.stepContent}>
              <Text style={styles.stepTitle}>반가워요!</Text>
              <Text style={[styles.stepDesc, styles.roleStepDesc]}>
                역할을 정하지 않아도 시작할 수 있어요
              </Text>

              <View style={styles.roleSupportNotice}>
                <Text style={styles.roleSupportText}>
                  지금 아는 것만 알려주세요. 장소·예산은 나중에 채워도 돼요.
                </Text>
              </View>

              {/* 예식일 — 아모라가 대신 받아낼 수 없는 유일한 값이라 여기서 묻는다.
                  비워 두고 시작해도 막지 않는다. */}
              <Text style={styles.fieldLabel}>결혼식 날짜, 정하셨어요?</Text>
              <TextInput
                style={styles.input}
                value={weddingDate}
                onChangeText={setWeddingDate}
                placeholder="YYYY-MM-DD"
                placeholderTextColor={colors.taupe[400]}
                keyboardType={Platform.OS === "ios" ? "numbers-and-punctuation" : "default"}
                maxLength={10}
                accessibilityLabel="결혼식 날짜"
              />
              <Text style={styles.fieldHint}>
                아직이면 비워 두세요. 나중에 언제든 바꿀 수 있어요.
              </Text>

              {/* 지금 신경 쓰이는 것 — 첫 대화를 여는 게 목적이다. */}
              <Text style={styles.fieldLabel}>
                지금 제일 신경 쓰이는 건 뭐예요? (선택)
              </Text>
              <View style={styles.neutralFocusRow}>
                {WEDDING_PRIORITY_OPTIONS.map((option) => {
                  const selected = neutralFocus === option.value;
                  return (
                    <Pressable
                      key={option.value}
                      style={[styles.neutralFocusChip, selected && styles.neutralFocusChipActive]}
                      accessibilityRole="button"
                      accessibilityLabel={option.label}
                      accessibilityState={{ selected }}
                      onPress={() => setNeutralFocus(selected ? null : option.value)}
                    >
                      <Text
                        style={[
                          styles.neutralFocusChipText,
                          selected && styles.neutralFocusChipTextActive,
                        ]}
                      >
                        {option.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              <Pressable
                style={[styles.roleCard, coupleAction === "create" && styles.roleCardActive]}
                accessibilityRole="button"
                accessibilityLabel="아모라와 지금 시작하기"
                accessibilityState={{ selected: coupleAction === "create" }}
                onPress={() => setCoupleAction("create")}
              >
                <View style={[styles.roleIconCircle, coupleAction === "create" && styles.roleIconCircleActive]}>
                  <Sparkles size={28} color={coupleAction === "create" ? colors.rose[500] : colors.taupe[400]} />
                </View>
                <Text style={[styles.roleLabel, coupleAction === "create" && styles.roleLabelActive]}>
                  아모라와 지금 시작하기
                </Text>
              </Pressable>

              <Pressable
                style={[styles.roleCard, coupleAction === "join" && styles.roleCardActive]}
                accessibilityRole="button"
                accessibilityLabel="초대 코드로 함께 시작하기"
                accessibilityState={{ selected: coupleAction === "join" }}
                onPress={() => setCoupleAction("join")}
              >
                <View style={[styles.roleIconCircle, coupleAction === "join" && styles.roleIconCircleActive]}>
                  <Heart size={28} color={coupleAction === "join" ? colors.rose[500] : colors.taupe[400]} />
                </View>
                <Text style={[styles.roleLabel, coupleAction === "join" && styles.roleLabelActive]}>
                  초대 코드로 함께 시작하기
                </Text>
              </Pressable>

              {coupleAction === "join" && (
                <View>
                  <TextInput
                    style={styles.input}
                    value={inviteCode}
                    onChangeText={(text) => setInviteCode(normalizeCoupleInviteCode(text))}
                    placeholder={COUPLE_INVITE_CODE_PLACEHOLDER}
                    placeholderTextColor={colors.taupe[400]}
                    maxLength={COUPLE_INVITE_CODE_MAX_LENGTH}
                    autoCapitalize="characters"
                    accessibilityLabel="파트너 초대 코드"
                  />
                  {inviteCodeProblem ? (
                    <Text style={styles.inviteCodeProblem}>{inviteCodeProblem}</Text>
                  ) : null}
                </View>
              )}
            </View>
          )}

          {/* Step 1(기존): 역할 */}
          {capabilitiesResolved && step === 1 && !neutralEnabled && (
            <View style={styles.stepContent}>
              <Text style={styles.stepTitle}>반가워요!</Text>
              <Text style={[styles.stepDesc, styles.roleStepDesc]}>결혼 준비에서의 역할을 알려주세요</Text>

              <View style={styles.roleSupportNotice}>
                <Text style={styles.roleSupportText}>
                  현재 베타 커플 연결은 신부 1명·신랑 1명 구성부터 지원해요.
                </Text>
                <Text style={styles.roleSupportText}>
                  다양한 커플 형태도 개인정보와 대화 기록을 안전하게 지킬 수 있는 구조로 준비하고 있어요.
                </Text>
              </View>

              <View style={styles.roleRow}>
                <Animated.View style={[{ flex: 1 }, { transform: [{ scale: brideScale }] }]}>
                  <Pressable
                    style={[styles.roleCard, role === "bride" && styles.roleCardActive]}
                    accessibilityRole="button"
                    accessibilityLabel="신부 역할 선택"
                    accessibilityState={{ selected: role === "bride" }}
                    onPress={() => handleRolePress("bride")}
                  >
                    <View style={[styles.roleIconCircle, role === "bride" && styles.roleIconCircleActive]}>
                      <Heart size={28} color={role === "bride" ? colors.rose[500] : colors.taupe[400]} />
                    </View>
                    <Text style={[styles.roleLabel, role === "bride" && styles.roleLabelActive]}>신부</Text>
                  </Pressable>
                </Animated.View>
                <Animated.View style={[{ flex: 1 }, { transform: [{ scale: groomScale }] }]}>
                  <Pressable
                    style={[styles.roleCard, role === "groom" && styles.roleCardActive]}
                    accessibilityRole="button"
                    accessibilityLabel="신랑 역할 선택"
                    accessibilityState={{ selected: role === "groom" }}
                    onPress={() => handleRolePress("groom")}
                  >
                    <View style={[styles.roleIconCircle, role === "groom" && styles.roleIconCircleActive]}>
                      <User size={28} color={role === "groom" ? colors.rose[500] : colors.taupe[400]} />
                    </View>
                    <Text style={[styles.roleLabel, role === "groom" && styles.roleLabelActive]}>신랑</Text>
                  </Pressable>
                </Animated.View>
              </View>
            </View>
          )}

          {/* Step 2: 커플 연결 */}
          {step === 2 && (
            <View style={styles.stepContent}>
              <Text style={styles.stepTitle}>커플 연결</Text>
              <Text style={styles.stepDesc}>파트너와 함께 준비할 수 있어요</Text>

              <Pressable
                style={[styles.optionCard, coupleAction === "create" && styles.optionActive]}
                onPress={() => setCoupleAction("create")}
              >
                <Text style={[styles.optionTitle, coupleAction === "create" && styles.optionTitleActive]}>
                  새로 시작하기
                </Text>
                <Text style={styles.optionDesc}>초대코드를 받아 파트너에게 공유</Text>
              </Pressable>

              <Pressable
                style={[styles.optionCard, coupleAction === "join" && styles.optionActive]}
                onPress={() => setCoupleAction("join")}
              >
                <Text style={[styles.optionTitle, coupleAction === "join" && styles.optionTitleActive]}>
                  초대코드로 합류
                </Text>
                <Text style={styles.optionDesc}>파트너가 보낸 코드를 입력</Text>
              </Pressable>

              {coupleAction === "join" && (
                <>
                  <TextInput
                    style={styles.inviteCodeInput}
                    value={inviteCode}
                    onChangeText={(value) => setInviteCode(normalizeCoupleInviteCode(value))}
                    placeholder={`초대코드 입력 (예: ${COUPLE_INVITE_CODE_PLACEHOLDER})`}
                    placeholderTextColor={colors.taupe[400]}
                    autoCapitalize="characters"
                    autoCorrect={false}
                    maxLength={COUPLE_INVITE_CODE_MAX_LENGTH}
                  />
                  {inviteCodeProblem && (
                    <Text style={styles.inviteCodeProblem}>{inviteCodeProblem}</Text>
                  )}
                </>
              )}
            </View>
          )}

          {/* Step 3: 결혼 상세 */}
          {step === 3 && (
            <View style={styles.stepContent}>
              <Text style={styles.stepTitle}>결혼 정보</Text>
              <Text style={styles.stepDesc}>나중에 변경할 수 있어요</Text>

              <Text style={styles.fieldLabel}>결혼 예정일</Text>
              {!weddingDateUndecided && (
                <View>
                  <TextInput
                    style={styles.input}
                    value={weddingDate}
                    onChangeText={setWeddingDate}
                    placeholder="YYYY-MM-DD"
                    placeholderTextColor={colors.taupe[400]}
                    keyboardType={Platform.OS === "ios" ? "numbers-and-punctuation" : "default"}
                    maxLength={10}
                  />
                  <Text style={styles.fieldHint}>예: 2026-10-15</Text>
                </View>
              )}
              <Pressable
                style={styles.checkRow}
                onPress={() => setWeddingDateUndecided(!weddingDateUndecided)}
              >
                {weddingDateUndecided
                  ? <CheckCircle2 size={20} color={colors.rose[500]} />
                  : <View style={styles.checkbox} />
                }
                <Text style={styles.checkLabel}>아직 정하지 않았어요</Text>
              </Pressable>

              <Text style={[styles.fieldLabel, { marginTop: 20 }]}>결혼식장</Text>
              <TextInput
                style={styles.input}
                value={venue}
                onChangeText={setVenue}
                placeholder="결혼식장 이름 (선택)"
                placeholderTextColor={colors.taupe[400]}
              />

              <Text style={[styles.fieldLabel, { marginTop: 20 }]}>총 예산 (선택)</Text>
              <View style={styles.budgetRow}>
                <TextInput
                  style={[
                    styles.input,
                    styles.budgetInput,
                    budgetEvaluation.status === "invalid" && styles.budgetInputInvalid,
                  ]}
                  value={budget}
                  onChangeText={setBudget}
                  placeholder="예: 3000"
                  placeholderTextColor={colors.taupe[400]}
                  keyboardType="number-pad"
                  accessibilityLabel="총 예산, 만원 단위, 선택 입력"
                  accessibilityHint="삼천만원이면 숫자 삼천을 입력합니다. 아직 정하지 않았다면 비워두세요."
                />
                <View style={styles.budgetUnitBox}>
                  <Text style={styles.budgetUnitText}>만원</Text>
                </View>
              </View>
              <Text
                style={[
                  styles.budgetFeedback,
                  budgetEvaluation.status === "invalid" && styles.budgetFeedbackInvalid,
                ]}
                accessibilityRole={budgetEvaluation.status === "invalid" ? "alert" : undefined}
              >
                {budgetEvaluation.status === "invalid" ? "확인 필요 · " : ""}
                {budgetEvaluation.message}
              </Text>
            </View>
          )}

          {/* Step 4: 웨딩 스타일 선호도 */}
          {step === 4 && (
            <View style={styles.stepContent}>
              <Text style={styles.stepTitle}>웨딩 스타일</Text>
              <Text style={styles.stepDesc}>취향에 맞는 추천을 위해 알려주세요</Text>

              {/* Q1: 웨딩 스타일 */}
              <Text style={styles.prefQuestion}>원하는 웨딩 스타일은?</Text>
              <View style={styles.prefGrid}>
                {STYLE_OPTIONS.map((opt) => (
                  <Pressable
                    key={opt.value}
                    style={[styles.prefCard, weddingStyle === opt.value && styles.prefCardActive]}
                    onPress={() => setWeddingStyle(opt.value)}
                  >
                    <Text style={styles.prefEmoji}>{opt.emoji}</Text>
                    <Text style={[styles.prefLabel, weddingStyle === opt.value && styles.prefLabelActive]}>{opt.label}</Text>
                    <Text style={styles.prefDesc}>{opt.desc}</Text>
                  </Pressable>
                ))}
              </View>

              {/* Q2: 우선순위 */}
              <View style={styles.prefQuestionRow}>
                <Text style={styles.prefQuestion}>가장 중요한 항목은?</Text>
                <Text style={styles.prefHint}>최대 3개</Text>
              </View>
              <View style={styles.prefGrid3}>
                {PRIORITY_OPTIONS.map((opt) => {
                  const selected = priorities.includes(opt.value);
                  const disabled = !selected && priorities.length >= 3;
                  return (
                    <Pressable
                      key={opt.value}
                      style={[
                        styles.prefChip,
                        selected && styles.prefChipActive,
                        disabled && styles.prefChipDisabled,
                      ]}
                      onPress={() => !disabled && togglePriority(opt.value)}
                    >
                      {selected && (
                        <View style={styles.prefCheckBadge}>
                          <Check size={10} color="#FFF" strokeWidth={3} />
                        </View>
                      )}
                      <Text style={styles.prefChipEmoji}>{opt.emoji}</Text>
                      <Text style={[styles.prefChipLabel, selected && styles.prefLabelActive]}>{opt.label}</Text>
                    </Pressable>
                  );
                })}
              </View>

              {/* Q3: 예산 성향 */}
              <Text style={styles.prefQuestion}>예산 성향은?</Text>
              <View style={styles.prefGrid3}>
                {BUDGET_OPTIONS.map((opt) => (
                  <Pressable
                    key={opt.value}
                    style={[styles.prefChip, budgetTendency === opt.value && styles.prefChipActive]}
                    onPress={() => setBudgetTendency(opt.value)}
                  >
                    <Text style={styles.prefChipEmoji}>{opt.emoji}</Text>
                    <Text style={[styles.prefChipLabel, budgetTendency === opt.value && styles.prefLabelActive]}>{opt.label}</Text>
                    <Text style={styles.prefChipDesc}>{opt.desc}</Text>
                  </Pressable>
                ))}
              </View>

              {/* Q4: 예상 하객 수 */}
              <Text style={styles.prefQuestion}>예상 하객 수는?</Text>
              <View style={styles.prefGuestList}>
                {GUEST_OPTIONS.map((opt) => (
                  <Pressable
                    key={opt.value}
                    style={[styles.prefGuestItem, guestCount === opt.value && styles.prefGuestItemActive]}
                    onPress={() => setGuestCount(opt.value)}
                  >
                    <Text style={[styles.prefGuestLabel, guestCount === opt.value && styles.prefGuestLabelActive]}>
                      {opt.label}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>
          )}

          {/* Step 5: 완료 */}
          {step === 5 && (
            <View style={styles.stepContent}>
              <View style={styles.doneSection}>
                <CelebrationDots />
                <View style={styles.doneIconCircle}>
                  <Sparkles size={36} color={colors.gold.DEFAULT} />
                </View>
              </View>
              <Text style={[styles.stepTitle, { textAlign: "center" }]}>준비 완료!</Text>
              <Text style={[styles.stepDesc, { textAlign: "center" }]}>
                웨딩한방과 함께{"\n"}우리답게 결혼을 준비하세요
              </Text>

              {resultCode ? (
                <View style={styles.codeCard}>
                  <Text style={styles.codeLabel}>파트너 초대코드</Text>
                  <Text style={styles.codeValue}>{resultCode}</Text>
                  <Text style={styles.codeHint}>이 코드를 파트너에게 보내주세요</Text>
                </View>
              ) : null}
            </View>
          )}
        </Animated.View>
      </ScrollView>
      </DismissKeyboard>

      {/* 하단 버튼 */}
      <View style={styles.footer}>
        <Pressable
          style={[styles.nextBtn, !canNext() && step < 5 && styles.nextBtnDisabled]}
          onPress={handleNext}
          disabled={nextDisabled}
          accessibilityRole="button"
          accessibilityLabel={neutralEnabled ? "시작하기" : step === 4 ? "온보딩 시작하기" : step === 5 ? "대시보드로 이동" : "다음 단계"}
          accessibilityState={{ disabled: nextDisabled, busy: submitting }}
        >
          {submitting ? (
            <ActivityIndicator color="#FFF" />
          ) : (
            <>
              <Text style={styles.nextText}>
                {neutralEnabled || step === 4 ? "시작하기" : step === 5 ? "대시보드로 이동" : "다음"}
              </Text>
              {!neutralEnabled && step < 5 && <ArrowRight size={20} color="#FFF" />}
            </>
          )}
        </Pressable>

        {step === 4 && (
          <Pressable
            onPress={handleSubmit}
            style={styles.skipBtn}
            disabled={submitting}
            accessibilityRole="button"
            accessibilityLabel="웨딩 스타일 건너뛰기"
            accessibilityState={{ disabled: submitting, busy: submitting }}
          >
            <Text style={styles.skipText}>건너뛰기</Text>
          </Pressable>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: 24, paddingBottom: 120 },

  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 16,
  },
  stepText: {
    fontSize: 14,
    fontFamily: "NotoSansKR_500Medium",
    color: colors.textTertiary,
  },

  progressBar: {
    height: 4,
    backgroundColor: colors.ivory[200],
    borderRadius: 2,
    marginBottom: 32,
  },
  progressFill: {
    height: "100%",
    backgroundColor: colors.rose[500],
    borderRadius: 2,
  },

  stepContent: { paddingTop: 8 },
  stepTitle: {
    fontSize: 28,
    fontFamily: "NotoSerifKR_500Medium",
    color: colors.noir[800],
    marginBottom: 8,
  },
  stepDesc: {
    fontSize: 15,
    fontFamily: "NotoSansKR_400Regular",
    color: colors.textSecondary,
    marginBottom: 32,
    lineHeight: 22,
  },

  // Step 1: 역할
  roleStepDesc: { marginBottom: 16 },
  roleSupportNotice: {
    gap: 4,
    marginBottom: 20,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 14,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  neutralFocusRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4 },
  neutralFocusChip: {
    minHeight: 44,
    justifyContent: "center",
    flexBasis: "48%",
    flexGrow: 1,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: "#FFF",
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  neutralFocusChipActive: { borderColor: colors.rose[500], backgroundColor: colors.ivory.warm },
  neutralFocusChipText: { fontSize: 13, lineHeight: 18, color: colors.taupe[400] },
  neutralFocusChipTextActive: { color: colors.noir[800], fontWeight: "600" },
  roleSupportText: {
    fontSize: 12,
    fontFamily: "NotoSansKR_400Regular",
    color: colors.textSecondary,
    lineHeight: 18,
  },
  roleRow: { flexDirection: "row", gap: 16 },
  roleCard: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 32,
    borderRadius: 24,
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: colors.border,
    gap: 14,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 12,
    elevation: 1,
  },
  roleCardActive: {
    borderColor: colors.rose[500],
    backgroundColor: colors.rose.pale + "30",
  },
  roleIconCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.ivory[200],
    alignItems: "center",
    justifyContent: "center",
  },
  roleIconCircleActive: {
    backgroundColor: colors.rose.pale + "50",
  },
  roleLabel: {
    fontSize: 16,
    fontFamily: "NotoSansKR_600SemiBold",
    color: colors.textSecondary,
  },
  roleLabelActive: { color: colors.rose[500] },

  // Step 2: 커플
  optionCard: {
    padding: 20,
    borderRadius: 20,
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: colors.border,
    marginBottom: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 12,
    elevation: 1,
  },
  optionActive: { borderColor: colors.rose[500] },
  optionTitle: {
    fontSize: 16,
    fontFamily: "NotoSansKR_600SemiBold",
    color: colors.noir[800],
    marginBottom: 4,
  },
  optionTitleActive: { color: colors.rose[500] },
  optionDesc: {
    fontSize: 13,
    fontFamily: "NotoSansKR_400Regular",
    color: colors.textSecondary,
  },
  inviteCodeInput: {
    padding: 14,
    borderRadius: 14,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    fontSize: 16,
    fontFamily: "CormorantGaramond_600SemiBold",
    color: colors.noir[800],
    letterSpacing: 0,
    textAlign: "center",
    marginTop: 4,
  },

  // Step 3: 상세
  fieldLabel: {
    fontSize: 14,
    fontFamily: "NotoSansKR_600SemiBold",
    color: colors.noir[800],
    marginBottom: 8,
  },
  fieldHint: {
    fontSize: 12,
    fontFamily: "NotoSansKR_400Regular",
    color: colors.textTertiary,
    marginTop: 4,
    marginLeft: 4,
  },
  input: {
    padding: 14,
    borderRadius: 14,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    fontSize: 15,
    fontFamily: "NotoSansKR_400Regular",
    color: colors.noir[800],
    marginBottom: 8,
  },
  budgetRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  budgetInput: {
    flex: 1,
    marginBottom: 0,
  },
  budgetInputInvalid: {
    borderColor: colors.danger,
  },
  budgetUnitBox: {
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderRadius: 14,
    backgroundColor: colors.ivory[200],
  },
  budgetUnitText: {
    fontSize: 15,
    fontFamily: "NotoSansKR_500Medium",
    color: colors.textSecondary,
  },
  inviteCodeProblem: {
    marginTop: 8,
    fontSize: 12,
    fontFamily: "NotoSansKR_400Regular",
    color: colors.noir[800],
    lineHeight: 18,
    textAlign: "center",
  },
  budgetFeedback: {
    marginTop: 8,
    fontSize: 12,
    fontFamily: "NotoSansKR_400Regular",
    color: colors.textTertiary,
    lineHeight: 18,
  },
  budgetFeedbackInvalid: {
    color: colors.noir[800],
  },
  checkRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8 },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: colors.taupe[400],
  },
  checkLabel: {
    fontSize: 14,
    fontFamily: "NotoSansKR_400Regular",
    color: colors.textSecondary,
  },

  // Step 4: 웨딩 스타일 선호도
  prefQuestion: {
    fontSize: 14,
    fontFamily: "NotoSansKR_600SemiBold",
    color: colors.noir[800],
    marginBottom: 12,
    marginTop: 20,
  },
  prefQuestionRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
    marginTop: 20,
  },
  prefHint: {
    fontSize: 11,
    fontFamily: "NotoSansKR_400Regular",
    color: colors.textTertiary,
  },
  prefGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  prefCard: {
    width: "48%" as unknown as number,
    alignItems: "center",
    paddingVertical: 16,
    borderRadius: 18,
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: colors.border,
  },
  prefCardActive: {
    borderColor: colors.rose[500],
    backgroundColor: colors.rose.pale + "20",
  },
  prefEmoji: {
    fontSize: 28,
    marginBottom: 4,
  },
  prefLabel: {
    fontSize: 15,
    fontFamily: "NotoSansKR_600SemiBold",
    color: colors.noir[800],
  },
  prefLabelActive: {
    color: colors.rose[500],
  },
  prefDesc: {
    fontSize: 11,
    fontFamily: "NotoSansKR_400Regular",
    color: colors.textTertiary,
    marginTop: 2,
  },
  prefGrid3: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  prefChip: {
    width: "31%" as unknown as number,
    alignItems: "center",
    paddingVertical: 12,
    borderRadius: 14,
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: colors.border,
  },
  prefChipActive: {
    borderColor: colors.rose[500],
    backgroundColor: colors.rose.pale + "20",
  },
  prefChipDisabled: {
    opacity: 0.4,
  },
  prefCheckBadge: {
    position: "absolute",
    top: 4,
    right: 4,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: colors.rose[500],
    alignItems: "center",
    justifyContent: "center",
  },
  prefChipEmoji: {
    fontSize: 22,
    marginBottom: 2,
  },
  prefChipLabel: {
    fontSize: 12,
    fontFamily: "NotoSansKR_500Medium",
    color: colors.noir[800],
  },
  prefChipDesc: {
    fontSize: 10,
    fontFamily: "NotoSansKR_400Regular",
    color: colors.textTertiary,
    marginTop: 1,
  },
  prefGuestList: {
    gap: 8,
  },
  prefGuestItem: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 14,
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: colors.border,
  },
  prefGuestItemActive: {
    borderColor: colors.rose[500],
    backgroundColor: colors.rose.pale + "20",
  },
  prefGuestLabel: {
    fontSize: 13,
    fontFamily: "NotoSansKR_500Medium",
    color: colors.taupe[500],
  },
  prefGuestLabelActive: {
    color: colors.noir[800],
  },

  // Step 5: 완료
  doneSection: {
    alignItems: "center",
    marginTop: 40,
    marginBottom: 28,
  },
  dotsContainer: {
    position: "absolute",
    width: 200,
    height: 200,
    alignItems: "center",
    justifyContent: "center",
  },
  dot: {
    position: "absolute",
  },
  doneIconCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: colors.ivory[200],
    alignItems: "center",
    justifyContent: "center",
    shadowColor: colors.gold.DEFAULT,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 16,
    elevation: 3,
  },
  codeCard: {
    backgroundColor: colors.noir[800],
    borderRadius: 20,
    padding: 24,
    alignItems: "center",
    marginTop: 24,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 16,
    elevation: 4,
  },
  codeLabel: {
    fontSize: 13,
    fontFamily: "NotoSansKR_400Regular",
    color: colors.taupe[400],
    marginBottom: 8,
  },
  codeValue: {
    fontSize: 28,
    fontFamily: "CormorantGaramond_600SemiBold",
    color: "#FFFFFF",
    letterSpacing: 0,
    marginBottom: 8,
  },
  codeHint: {
    fontSize: 12,
    fontFamily: "NotoSansKR_400Regular",
    color: colors.taupe[400],
  },

  // Footer
  footer: { padding: 24, gap: 12 },
  nextBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    height: 56,
    borderRadius: 16,
    backgroundColor: colors.noir[800],
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 3,
  },
  nextBtnDisabled: { opacity: 0.4 },
  nextText: {
    fontSize: 16,
    fontFamily: "NotoSansKR_600SemiBold",
    color: "#FFFFFF",
  },
  skipBtn: { alignItems: "center", paddingVertical: 8 },
  skipText: {
    fontSize: 14,
    fontFamily: "NotoSansKR_400Regular",
    color: colors.textTertiary,
  },
});
