// 온보딩 화면 — 5단계 (역할 → 커플 → 결혼 상세 → 웨딩 스타일 → 완료)
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
  COUPLE_INVITE_CODE_EXAMPLE,
  COUPLE_INVITE_CODE_LENGTH,
  isCoupleInviteCode,
  manwonInputToWon,
  normalizeCoupleInviteCode,
} from "@hanbang/shared";
import { apiFetch } from "@/lib/api";
import ErrorRetry from "@/components/ErrorRetry";
import { consumePendingMobileAuthReturnPath } from "@/lib/mobileAuthIntent";
import { supabase } from "@/lib/supabase";

type Role = "bride" | "groom";
type CoupleAction = "create" | "join";
type WeddingStyle = "minimal" | "classic" | "fancy" | "natural";
type PriorityItem = "sdm" | "venue" | "rings" | "honeymoon" | "ceremony" | "housing";
type BudgetTendency = "saving" | "balanced" | "premium";
type GuestCount = "under50" | "50to100" | "100to200" | "200to300" | "over300";

const STYLE_OPTIONS: { value: WeddingStyle; emoji: string; label: string; desc: string }[] = [
  { value: "minimal", emoji: "\u{1F90D}", label: "\uBBF8\uB2C8\uBA40", desc: "\uAE54\uB054\uD558\uACE0 \uC2EC\uD50C\uD558\uAC8C" },
  { value: "classic", emoji: "\u{1F3DB}\uFE0F", label: "\uD074\uB798\uC2DD", desc: "\uC804\uD1B5\uC801\uC774\uACE0 \uACA9\uC2DD\uC788\uAC8C" },
  { value: "fancy", emoji: "\u2728", label: "\uD654\uB824\uD55C", desc: "\uD654\uB824\uD558\uACE0 \uD2B9\uBCC4\uD558\uAC8C" },
  { value: "natural", emoji: "\u{1F33F}", label: "\uC790\uC5F0\uC2A4\uB7EC\uC6B4", desc: "\uD3B8\uC548\uD558\uACE0 \uC790\uC720\uB86D\uAC8C" },
];

const PRIORITY_OPTIONS: { value: PriorityItem; emoji: string; label: string }[] = [
  { value: "sdm", emoji: "\u{1F4F8}", label: "\uC2A4\uB4DC\uBA54" },
  { value: "venue", emoji: "\u{1F3F0}", label: "\uC608\uC2DD\uC7A5" },
  { value: "rings", emoji: "\u{1F48D}", label: "\uC608\uBB3C/\uC608\uB2E8" },
  { value: "honeymoon", emoji: "\u2708\uFE0F", label: "\uC2E0\uD63C\uC5EC\uD589" },
  { value: "ceremony", emoji: "\u{1F38A}", label: "\uBCF8\uC2DD \uC5F0\uCD9C" },
  { value: "housing", emoji: "\u{1F3E0}", label: "\uC2E0\uD63C\uC9D1/\uD63C\uC218" },
];

const BUDGET_OPTIONS: { value: BudgetTendency; emoji: string; label: string; desc: string }[] = [
  { value: "saving", emoji: "\u{1F4B0}", label: "\uC808\uC57D\uD615", desc: "\uCD5C\uC18C\uD55C\uC73C\uB85C \uD569\uB9AC\uC801\uC73C\uB85C" },
  { value: "balanced", emoji: "\u2696\uFE0F", label: "\uAC00\uC131\uBE44", desc: "\uAF2D \uD544\uC694\uD55C \uACF3\uC5D0 \uD22C\uC790" },
  { value: "premium", emoji: "\u{1F48E}", label: "\uD504\uB9AC\uBBF8\uC5C4", desc: "\uCD5C\uACE0\uC758 \uD000\uB9AC\uD2F0\uB97C \uC6D0\uD574\uC694" },
];

const GUEST_OPTIONS: { value: GuestCount; label: string }[] = [
  { value: "under50", label: "50\uBA85 \uC774\uD558 (\uC2A4\uBAB0\uC6E8\uB529)" },
  { value: "50to100", label: "50~100\uBA85" },
  { value: "100to200", label: "100~200\uBA85" },
  { value: "200to300", label: "200~300\uBA85" },
  { value: "over300", label: "300\uBA85 \uC774\uC0C1" },
];

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
  const [guardStatus, setGuardStatus] = useState<"checking" | "ready" | "error">("checking");
  const guardRequestIdRef = useRef(0);
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

  // Step 4: 웨딩 스타일 선호도
  const [weddingStyle, setWeddingStyle] = useState<WeddingStyle | null>(null);
  const [priorities, setPriorities] = useState<PriorityItem[]>([]);
  const [budgetTendency, setBudgetTendency] = useState<BudgetTendency | null>(null);
  const [guestCount, setGuestCount] = useState<GuestCount | null>(null);

  const navigateAfterOnboarding = useCallback(async () => {
    const pendingPath = await consumePendingMobileAuthReturnPath().catch(() => null);
    router.replace(pendingPath ?? "/(tabs)/dashboard");
  }, []);

  const verifyOnboardingState = useCallback(async () => {
    const requestId = ++guardRequestIdRef.current;
    setGuardStatus("checking");
    try {
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      if (requestId !== guardRequestIdRef.current) return;
      if (sessionError) throw sessionError;
      if (!sessionData.session) {
        router.replace("/(auth)/login");
        return;
      }

      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("onboarding_completed")
        .eq("id", sessionData.session.user.id)
        .maybeSingle();
      if (requestId !== guardRequestIdRef.current) return;
      if (profileError) throw profileError;

      if (profile?.onboarding_completed) {
        await navigateAfterOnboarding();
        return;
      }

      setGuardStatus("ready");
    } catch (error) {
      if (requestId !== guardRequestIdRef.current) return;
      console.error("Mobile onboarding guard failed:", error);
      setGuardStatus("error");
    }
  }, [navigateAfterOnboarding]);

  useEffect(() => {
    void verifyOnboardingState();
    return () => {
      guardRequestIdRef.current += 1;
    };
  }, [verifyOnboardingState]);

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
    switch (step) {
      case 1: return role !== null;
      case 2: return coupleAction === "create" || (coupleAction === "join" && isCoupleInviteCode(inviteCode));
      case 3: return true;
      case 4: return true; // 선호도는 선택사항
      default: return false;
    }
  }

  async function handleSubmit() {
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

      const res = await apiFetch("/api/onboarding", {
        method: "POST",
        body: JSON.stringify({
          role,
          coupleAction,
          partnerInviteCode: coupleAction === "join" ? inviteCode : undefined,
          weddingDate: weddingDateUndecided ? null : weddingDate || null,
          venue: venue || null,
          totalBudget: budget ? manwonInputToWon(budget) : 0,
          progress,
        }),
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
        await navigateAfterOnboarding();
      }
    } catch (err) {
      Alert.alert("오류", err instanceof Error ? err.message : "저장에 실패했어요");
    } finally {
      setSubmitting(false);
    }
  }

  function handleNext() {
    if (step === 4) {
      handleSubmit();
    } else if (step === 5) {
      void navigateAfterOnboarding();
    } else {
      animateStepTransition(step + 1);
    }
  }

  function handleBack() {
    if (step > 1 && step < 5) {
      animateStepTransition(step - 1);
    }
  }

  if (guardStatus === "checking") {
    return (
      <SafeAreaView style={styles.guardState} accessibilityLiveRegion="polite">
        <ActivityIndicator color={colors.rose[500]} size="large" />
      </SafeAreaView>
    );
  }

  if (guardStatus === "error") {
    return (
      <SafeAreaView style={styles.guardState}>
        <ErrorRetry
          message="온보딩 상태를 확인하지 못했어요. 기존 설정은 바꾸지 않고 다시 확인할게요."
          onRetry={() => void verifyOnboardingState()}
        />
      </SafeAreaView>
    );
  }

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
          <Text style={styles.stepText}>{step}/{totalSteps}</Text>
          <View style={{ width: 24 }} />
        </View>

        {/* 진행 바 */}
        <View style={styles.progressBar}>
          <View style={[styles.progressFill, { width: `${(step / totalSteps) * 100}%` }]} />
        </View>

        {/* 애니메이션 래퍼 */}
        <Animated.View
          style={{
            opacity: contentOpacity,
            transform: [{ translateY: contentSlide }],
          }}
        >
          {/* Step 1: 역할 */}
          {step === 1 && (
            <View style={styles.stepContent}>
              <Text style={styles.stepTitle}>반가워요!</Text>
              <Text style={styles.stepDesc}>결혼 준비에서의 역할을 알려주세요</Text>

              <View style={styles.roleRow}>
                <Animated.View style={[{ flex: 1 }, { transform: [{ scale: brideScale }] }]}>
                  <Pressable
                    style={[styles.roleCard, role === "bride" && styles.roleCardActive]}
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
                <TextInput
                  style={styles.inviteCodeInput}
                  value={inviteCode}
                  onChangeText={(value) => setInviteCode(normalizeCoupleInviteCode(value))}
                  placeholder={`초대코드 입력 (예: ${COUPLE_INVITE_CODE_EXAMPLE})`}
                  placeholderTextColor={colors.textTertiary}
                  autoCapitalize="characters"
                  autoCorrect={false}
                  maxLength={COUPLE_INVITE_CODE_LENGTH}
                />
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
                    placeholderTextColor={colors.textTertiary}
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

              <Text style={[styles.fieldLabel, { marginTop: 20 }]}>예식장</Text>
              <TextInput
                style={styles.input}
                value={venue}
                onChangeText={setVenue}
                placeholder="예식장 이름 (선택)"
                placeholderTextColor={colors.textTertiary}
              />

              <Text style={[styles.fieldLabel, { marginTop: 20 }]}>총 예산</Text>
              <View style={styles.budgetRow}>
                <TextInput
                  style={[styles.input, styles.budgetInput]}
                  value={budget}
                  onChangeText={setBudget}
                  placeholder="예: 3000"
                  placeholderTextColor={colors.textTertiary}
                  keyboardType="numeric"
                />
                <View style={styles.budgetUnitBox}>
                  <Text style={styles.budgetUnitText}>만원</Text>
                </View>
              </View>
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
                웨딩한방과 함께{"\n"}완벽한 결혼을 준비하세요
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
          disabled={(!canNext() && step < 5) || submitting}
        >
          {submitting ? (
            <ActivityIndicator color="#FFF" />
          ) : (
            <>
              <Text style={styles.nextText}>
                {step === 4 ? "시작하기" : step === 5 ? "대시보드로 이동" : "다음"}
              </Text>
              {step < 5 && <ArrowRight size={20} color="#FFF" />}
            </>
          )}
        </Pressable>

        {step === 4 && (
          <Pressable onPress={handleSubmit} style={styles.skipBtn}>
            <Text style={styles.skipText}>건너뛰기</Text>
          </Pressable>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  guardState: {
    flex: 1,
    justifyContent: "center",
    backgroundColor: colors.bg,
    paddingHorizontal: 24,
  },
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
  roleLabelActive: { color: colors.noir[800] },

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
  optionTitleActive: { color: colors.noir[800] },
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
