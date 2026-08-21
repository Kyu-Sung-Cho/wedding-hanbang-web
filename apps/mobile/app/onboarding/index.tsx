// 온보딩 화면.
// 중립 준비 공간이 켜지면 한 화면(역할·예식일·예산·스타일을 묻지 않음),
// 꺼져 있으면 6단계(역할 → 커플 → 결혼 상세 → 웨딩 스타일 → 준비 현황 → 완료).
// 판정은 서버가 /api/auth/me 의 capabilities 로 내려준다 — 앱이 정하지 않는다.
import { useState, useEffect, useRef, useCallback } from "react";
import {
  View, Text, Pressable, TextInput, StyleSheet, ScrollView,
  Alert, ActivityIndicator, Animated, Easing, Platform,
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
import * as Clipboard from "expo-clipboard";
import * as SecureStore from "expo-secure-store";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { apiFetch } from "@/lib/api";
import { supabase } from "@/lib/supabase";
import { evaluateOnboardingBudgetManwon } from "@/lib/onboardingBudget.mjs";
import {
  evaluateWeddingDateInput,
  formatWeddingDateInput,
} from "@/lib/onboardingFirstValue.mjs";
import {
  buildOnboardingProgressPayload,
  describeOnboardingSubmitNotice,
  getNextOnboardingStep,
  getOnboardingStepPosition,
  getPreviousOnboardingStep,
  ONBOARDING_DONE_STEP,
  ONBOARDING_PREPARATION_STEP,
  shouldAskPreparationProgress,
} from "@/lib/onboardingFlow.mjs";
import { consumePendingCoupleInviteCode } from "@/lib/pendingCoupleInvite.mjs";
import {
  clearOnboardingDraft,
  loadOnboardingDraft,
  saveOnboardingDraft,
} from "@/lib/onboardingDraft";
import PreparationProgressList, {
  createPreparationStatuses,
} from "@/components/onboarding/PreparationProgressList";
import InviteCodeCard from "@/components/invite/InviteCodeCard";
import {
  COUPLE_INVITE_CODE_MAX_LENGTH,
  COUPLE_INVITE_CODE_PLACEHOLDER,
  PREPARATION_STAGE_OPTIONS,
  describeCoupleInviteCodeProblem,
  findPreparationStageOption,
  isCoupleInviteCode,
  normalizeCoupleInviteCode,
  type PreparationProgressCategoryKey,
  type PreparationProgressStatus,
  type PreparationStageValue,
  buildNeutralPreparationSpaceSubmission,
  describeInviteDeadline,
  parseNeutralPreparationSpaceCapability,
} from "@hanbang/shared";

type Role = "bride" | "groom";
type CoupleAction = "create" | "join";
type WeddingStyle = WeddingStyleValue;
type PriorityItem = WeddingPriorityValue;
type BudgetTendency = WeddingBudgetTendencyValue;
type GuestCount = WeddingGuestCountValue;

/** 입력이 멈춘 뒤 이만큼 기다렸다 기기에 적는다. 글자마다 쓰면 저장소가 계속 깨어 있다. */
const ONBOARDING_DRAFT_SAVE_DELAY_MS = 400;

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

function isOnboardingRecord(
  value: unknown,
): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
  const [resultCodeCopied, setResultCodeCopied] = useState(false);
  // 초대 링크를 눌러서 들어왔는지. 코드가 이미 채워져 있는 이유를 화면이 말해줘야
  // 한다 — 안 그러면 자기가 친 적 없는 글자가 입력칸에 있는 것으로 보인다.
  const [inviteCodeFromLink, setInviteCodeFromLink] = useState(false);
  // 코드를 보내는 그 화면이 기한을 말해야 한다. 서버가 모르면 아무 말도 안 한다.
  const [resultDeadline, setResultDeadline] = useState<string | null>(null);
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
  // 날짜는 제출 전에 이 화면에서 판정한다 — 예전에는 자유 텍스트를 그대로 보내고
  // 마지막 화면에서 400을 받았는데, 그때는 무엇이 틀렸는지 볼 자리가 없었다.
  const weddingDateEvaluation = evaluateWeddingDateInput(weddingDate);
  const weddingDateBlocked =
    !weddingDateUndecided
    && weddingDateEvaluation.status !== "empty"
    && weddingDateEvaluation.status !== "valid";
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

  // Step 5: 준비 현황 — 단계 한 줄도 19항목도 **선택이다**(관문 근거는 `canNext` case 5)
  const [preparationStage, setPreparationStage] =
    useState<PreparationStageValue | null>(null);
  const [categoryStatuses, setCategoryStatuses] = useState(() =>
    createPreparationStatuses(),
  );
  // 스텝 5는 화면 두 개다. 단계 한 줄을 먼저 받고("stage"), 19항목은 "다음"을 눌러야
  // 나온다("detail"). 웹과 같은 순서다 — 한 화면에 다 펼쳐두면 제안값을 스크롤해
  // 보지도 않은 채 저장 버튼이 눌린다. 스텝 번호를 나누지 않는 이유는 서버가 완료 시
  // onboarding_step: 5를 쓰기 때문이다.
  const [stagePhase, setStagePhase] = useState<"stage" | "detail">("stage");
  // 저장된 초안을 아직 못 읽었는데 저장부터 하면, 빈 초기 상태가 초안을 덮는다.
  const draftRestoredRef = useRef(false);
  // 서버에 저장된 뒤에는 다시 적지 않는다. 완료 화면(코드 보여주기)도 상태 변화라,
  // 지운 직후에 저장 타이머가 한 번 더 돌면 이미 끝난 온보딩의 초안이 되살아난다.
  const draftDoneRef = useRef(false);

  function handleStagePress(value: PreparationStageValue) {
    // 이미 고른 단계를 한 번 더 누른 것이라면 아무것도 하지 않는다. 19항목 화면에서
    // 손으로 고쳐둔 상태가 있는데 여기서 다시 채우면, 사용자가 직접 말한 것이
    // 제안값으로 덮인다. 2국면이 되면서 이 경로는 더 흔해졌다 — 국면 B에서 뒤로
    // 가면 고른 단계가 선택된 채 보이고, 그 카드를 다시 누르기 쉽다.
    if (preparationStage === value) return;
    setPreparationStage(value);
    // 단계를 바꾸면 아래 19항목도 그 단계의 제안값으로 다시 채운다. 앞 단계에서
    // 켜졌던 "완료"가 남아 있으면 사용자가 고르지 않은 상태가 화면에 눌러앉는다.
    setCategoryStatuses(
      createPreparationStatuses(findPreparationStageOption(value)?.suggested),
    );
  }

  /**
   * 이미 온보딩을 마친 사람은 여기 서 있으면 안 된다.
   *
   * 라운지의 제일 큰 버튼이 날짜를 고치라며 이 화면을 열던 시절, 그 사람이 역할이나
   * 커플 연결을 처음과 다르게 고르면 서버가 커플 구성이 어긋났다고 돌려주고 화면은
   * "고객 지원에 문의해주세요"로 끝났다. 그 경로는 목적지를 설정 화면으로 옮겨 막았고,
   * 이건 그 뒤에 남는 뒷문(딥링크·예전 화면·뒤로가기)을 막는 빗장이다.
   *
   * 판정은 앱 루트 게이트(`app/index.tsx`)와 같은 값 하나만 본다 — 판정을 복제하면
   * 두 곳이 서로 다른 답을 하는 날이 온다.
   *
   * 확인하는 동안 화면을 가리지 않는다. 여기서 스피너를 세우면 연결이 느린 사람은
   * 가입 자체를 못 하고, 이 빗장이 막는 건 이미 계정이 있는 사람의 잘못된 재입장뿐이다.
   */
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (!active || !session) return;
        const { data: profile, error } = await supabase
          .from("profiles")
          .select("onboarding_completed")
          .eq("id", session.user.id)
          .maybeSingle();
        if (!active || error) return;
        if (profile?.onboarding_completed === true) {
          router.replace("/(tabs)/lounge");
        }
      } catch {
        // 물어보지 못했으면 그대로 온보딩을 걷게 둔다. 못 물어봤다는 이유로 가입을
        // 막는 것이 이 화면에서 할 수 있는 가장 나쁜 일이다.
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  /**
   * 저장해 둔 초안을 되살리고, 그다음에 초대 링크로 들어온 코드를 받아 "코드로 합류"
   * 경로에 앉힌다.
   *
   * 순서가 이유가 있다: 링크로 정해진 join은 초안의 예전 선택보다 세다. 반대로 하면
   * 링크를 눌러 들어온 사람이 예전에 고르던 "새로 만들기"로 되돌아간다.
   *
   * 스텝을 건너뛰지는 않는다. 역할(신부/신랑)은 합류하는 사람도 반드시 골라야 하고,
   * 그 화면이 스텝 1이다. 링크가 대신 골라주면 서버에는 역할 없는 프로필이 남는다.
   * 그래서 여기서는 "무엇을 할지"(join)와 "어떤 코드로"(inviteCode)만 채워두고,
   * 사람은 평소대로 스텝 1부터 걷는다 — 스텝 2에 오면 코드가 이미 들어 있다.
   */
  useEffect(() => {
    let active = true;
    void (async () => {
      const draft = await loadOnboardingDraft(AsyncStorage);
      if (!active) return;
      if (draft) {
        setStep(draft.step);
        setRole(draft.role);
        setCoupleAction(draft.coupleAction);
        setWeddingDate(draft.weddingDate);
        setWeddingDateUndecided(draft.weddingDateUndecided);
        setVenue(draft.venue);
        setBudget(draft.budget);
        setWeddingStyle(draft.weddingStyle);
        setPriorities(draft.priorities);
        setBudgetTendency(draft.budgetTendency);
        setGuestCount(draft.guestCount);
        setPreparationStage(draft.preparationStage);
        setCategoryStatuses(createPreparationStatuses(draft.categoryStatuses));
        setStagePhase(draft.stagePhase);
      }
      // 복원이 끝나야 저장을 시작한다. 먼저 저장하면 빈 초기 상태가 저장된 초안을 덮는다.
      draftRestoredRef.current = true;

      const linkedCode = await consumePendingCoupleInviteCode({
        storage: SecureStore,
      });
      if (!active || !linkedCode) return;
      setCoupleAction("join");
      setInviteCode(linkedCode);
      setInviteCodeFromLink(true);
    })();
    return () => {
      active = false;
    };
  }, []);

  /**
   * 적은 것을 기기에 남긴다. 초대 코드는 넘기지 않는다 — 커플 공간의 열쇠라 기기에
   * 눌러앉으면 안 되고, 링크로 받은 코드는 이미 한 번만 쓰이도록 따로 관리된다.
   *
   * 글자 하나마다 쓰지 않도록 잠깐 묵혔다 쓴다. 화면을 떠나면 타이머는 정리된다.
   */
  useEffect(() => {
    if (!draftRestoredRef.current || draftDoneRef.current) return;
    const timer = setTimeout(() => {
      void saveOnboardingDraft(AsyncStorage, {
        step,
        role,
        coupleAction,
        weddingDate,
        weddingDateUndecided,
        venue,
        budget,
        weddingStyle,
        priorities,
        budgetTendency,
        guestCount,
        preparationStage,
        categoryStatuses,
        stagePhase,
      });
    }, ONBOARDING_DRAFT_SAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [
    step,
    role,
    coupleAction,
    weddingDate,
    weddingDateUndecided,
    venue,
    budget,
    weddingStyle,
    priorities,
    budgetTendency,
    guestCount,
    preparationStage,
    categoryStatuses,
    stagePhase,
  ]);

  function handleCategoryStatusChange(
    key: PreparationProgressCategoryKey,
    status: PreparationProgressStatus,
  ) {
    setCategoryStatuses((prev) => ({ ...prev, [key]: status }));
  }

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

  // 1 역할 · 2 커플 연결 · 3 결혼 정보 · 4 웨딩 스타일 · 5 준비 현황 · 6 완료
  // 합류하는 사람은 5를 걷지 않는다(준비 현황은 커플 공유 데이터라 다시 물으면
  // 파트너가 적어둔 것을 덮는다). 그래서 진행 표시의 분모도 그 사람이 실제로 보는
  // 화면 수로 계산한다 — 6단계라고 써놓고 4단계에서 끝나면 사람은 앱이 고장 난 줄 안다.
  const DONE_STEP = ONBOARDING_DONE_STEP;
  const asksPreparation = shouldAskPreparationProgress(coupleAction);
  const { position: stepPosition, total: totalSteps } =
    getOnboardingStepPosition(step, coupleAction);

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
      case 3: return budgetEvaluation.status !== "invalid" && !weddingDateBlocked;
      case 4: return true; // 선호도는 선택사항
      // 단계 한 줄도 선택이다 — **웹과 같은 규칙이다.**
      //
      // 원래 여기만 필수였다. 그런데 같은 질문을 웹은 선택으로, 앱은 필수로 물으면
      // 한 커플이 두 화면에서 서로 다른 관문을 만난다. 웹 쪽 판단 근거는
      // `apps/web/src/app/(auth)/onboarding/page.tsx`의 `canProceed` case 5에 적어 뒀다
      // (요지: 이 값의 소비처 둘 다 null 폴백이 있어 없어도 아무것도 안 죽는다).
      // 한쪽만 바꿀 이유가 없어서 같이 연다.
      case 5: return true;
      default: return false;
    }
  }

  /**
   * `saveCategories`가 false면 19항목은 한 줄도 보내지 않는다. 단계 선택지에 붙은
   * 제안값은 화면 초깃값일 뿐이고, 사용자가 확인하지 않은 "완료"를 준비 사실로
   * 기록하면 체크리스트 완료율과 예산이 사실이 아닌 쪽으로 움직인다.
   *
   * 합류한 사람은 이 값과 무관하게 단계도 19항목도 보내지 않는다 —
   * `buildOnboardingProgressPayload`가 커플 공유 데이터를 덮는 경로를 한 곳에서 막는다.
   */
  async function handleSubmit(saveCategories: boolean) {
    // 중립 경로는 예산을 묻지 않는다 — 물어보지 않은 값을 검사하면 통과할 수 없다.
    if (!neutralEnabled && budgetEvaluation.status === "invalid") {
      Alert.alert("예산을 확인해주세요", budgetEvaluation.message);
      return;
    }
    if (weddingDateBlocked) {
      Alert.alert("결혼 예정일을 확인해주세요", weddingDateEvaluation.message);
      return;
    }

    setSubmitting(true);
    try {
      const progress = buildOnboardingProgressPayload({
        coupleAction,
        stage: preparationStage,
        preferences: {
          weddingStyle,
          priorities,
          budgetTendency,
          guestCount,
        },
        categoryStatuses: saveCategories ? categoryStatuses : null,
      });

      const res = await apiFetch("/api/onboarding", {
        method: "POST",
        body: JSON.stringify(
          neutralEnabled
            ? buildNeutralPreparationSpaceSubmission({
                coupleAction,
                partnerInviteCode: inviteCode,
                weddingDate: weddingDateUndecided
                  ? null
                  : weddingDateEvaluation.requestDate,
                focusPriority: neutralFocus,
              })
            : {
                role,
                coupleAction,
                partnerInviteCode:
                  coupleAction === "join" ? inviteCode : undefined,
                weddingDate: weddingDateUndecided
                  ? null
                  : weddingDateEvaluation.requestDate,
                venue: venue || null,
                totalBudget: budgetEvaluation.requestBudget,
                progress,
              },
        ),
      });

      const data = await res.json();
      if (!res.ok) {
        Alert.alert("오류", data.error ?? "저장에 실패했어요");
        return;
      }

      const goOn = () => {
        // 서버에 저장됐으면 기기의 초안은 역할이 끝났다. 남겨두면 다음에 이 화면을
        // 열었을 때 이미 저장된 입력이 되살아난다.
        draftDoneRef.current = true;
        void clearOnboardingDraft(AsyncStorage);
        if (data.inviteCode && coupleAction === "create") {
          setResultCode(data.inviteCode);
          void (async () => {
            // 기한은 /api/couple/code 에서 읽는다 — 온보딩 라우트는 couples 를
            // 직접 만지지 않는 경계를 지킨다. 못 읽으면 아무 말도 하지 않는다.
            try {
              const codeRes = await apiFetch("/api/couple/code");
              if (!codeRes.ok) return;
              const codePayload = (await codeRes.json().catch(() => null)) as
                | { inviteCodeExpiresAt?: unknown }
                | null;
              setResultDeadline(describeInviteDeadline(codePayload?.inviteCodeExpiresAt));
            } catch {
              // 조용히 넘어간다.
            }
          })();
          animateStepTransition(DONE_STEP);
        } else {
          // main 쪽은 여기서 `/(tabs)/dashboard` 로 보내는데 이 브랜치에는 그 라우트가
          // 없다(웨딩 라운지로 이름과 파일이 바뀌었다). 그대로 뒀으면 중립 경로를 켠
          // 순간 신규 사용자가 존재하지 않는 화면으로 갔다.
          router.replace("/(tabs)/lounge");
        }
      };

      // 서버는 200을 주면서도 입력을 미뤄둘 수 있다. 준비 현황이 보류되거나
      // (routineProgress) 결혼 예정일 같은 값이 파트너 확인을 기다린다(planChange).
      // res.ok만 보고 넘기면 사람은 저장된 줄 알고 나간다 — 웹과 같은 문구로 먼저 알린다.
      const notice = describeOnboardingSubmitNotice(data);
      if (notice) {
        Alert.alert(
          notice.title,
          notice.message,
          [{ text: "확인하고 계속하기", onPress: goOn }],
          { cancelable: false },
        );
        return;
      }
      goOn();
    } catch (err) {
      Alert.alert("오류", err instanceof Error ? err.message : "저장에 실패했어요");
    } finally {
      setSubmitting(false);
    }
  }

  /**
   * 완료 화면의 코드 복사. 이 화면의 코드는 방금 이 사람에게 발급된 것이라 다른
   * 사람의 코드가 섞일 자리가 없다 — 그래서 설정 화면처럼 소유자를 다시 확인하는
   * 단계 없이 바로 클립보드에 넣는다.
   */
  async function copyResultCode() {
    if (!resultCode) return;
    try {
      await Clipboard.setStringAsync(resultCode);
      setResultCodeCopied(true);
      setTimeout(() => setResultCodeCopied(false), 2000);
    } catch {
      Alert.alert("오류", "코드 복사에 실패했어요.");
    }
  }

  function handleNext() {
    // 중립 준비 공간은 화면이 하나다. 첫 화면의 CTA가 곧 제출이고, 19항목은 묻지
    // 않으므로 저장할 카테고리도 없다.
    if (neutralEnabled && step === 1) {
      void handleSubmit(false);
      return;
    }
    if (step === DONE_STEP) {
      router.replace("/(tabs)/lounge");
      return;
    }
    if (step === ONBOARDING_PREPARATION_STEP) {
      // 단계를 고른 다음에야 19항목을 본다. 같은 화면에 펼쳐 두면 제안값을 확인하지
      // 않은 채로 저장이 눌린다.
      if (stagePhase === "stage") {
        setStagePhase("detail");
        return;
      }
      handleSubmit(true);
      return;
    }
    const next = getNextOnboardingStep(step, coupleAction);
    // 다음 화면이 없으면 여기가 제출 지점이다 — 합류한 사람에게는 스텝 4가 마지막이다.
    if (next === null) {
      handleSubmit(true);
      return;
    }
    animateStepTransition(next);
  }

  function handleBack() {
    // 19항목에서 뒤로 가면 스텝 4가 아니라 단계 선택으로 돌아간다. 두 화면이 한 스텝
    // 안에 있으므로 되돌아갈 곳도 그 안이다.
    if (step === ONBOARDING_PREPARATION_STEP && stagePhase === "detail") {
      setStagePhase("stage");
      return;
    }
    const previous = getPreviousOnboardingStep(step, coupleAction);
    if (previous !== null) {
      animateStepTransition(previous);
    }
  }

  const nextDisabled = (!capabilitiesResolved && step === 1)
    || (!canNext() && step < DONE_STEP)
    || submitting;
  // 하단 CTA가 저장 버튼이 되는 자리. 준비 현황은 19항목 화면(국면 B)에서만이고,
  // 그 화면을 걷지 않는 사람은 마지막 입력 화면이 곧 저장 지점이다.
  const submitsOnNext = step === ONBOARDING_PREPARATION_STEP
    ? stagePhase === "detail"
    : step !== DONE_STEP && getNextOnboardingStep(step, coupleAction) === null;

  return (
    <SafeAreaView style={styles.container}>
      <DismissKeyboard>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {/* 헤더 */}
        <View style={styles.header}>
          {step > 1 && step < DONE_STEP ? (
            <Pressable onPress={handleBack} hitSlop={12}>
              <ArrowLeft size={24} color={colors.noir[800]} />
            </Pressable>
          ) : <View style={{ width: 24 }} />}
          <Text style={styles.stepText}>
            {neutralEnabled ? "" : `${stepPosition}/${totalSteps}`}
          </Text>
          <View style={{ width: 24 }} />
        </View>

        {/* 진행 바 — 한 화면이면 여러 단계 진행 표시가 거짓말이 된다 */}
        {!neutralEnabled && (
          <View style={styles.progressBar}>
            <View
              style={[
                styles.progressFill,
                { width: `${(stepPosition / totalSteps) * 100}%` },
              ]}
            />
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
                  {inviteCodeFromLink && (
                    <Text style={styles.inviteCodeFromLink}>
                      초대 링크에서 받은 코드를 넣어 뒀어요.
                    </Text>
                  )}
                  <TextInput
                    style={styles.inviteCodeInput}
                    value={inviteCode}
                    onChangeText={(value) => {
                      // 사람이 직접 고치기 시작하면 링크 안내는 사실이 아니게 된다.
                      setInviteCodeFromLink(false);
                      setInviteCode(normalizeCoupleInviteCode(value));
                    }}
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
                    style={[styles.input, weddingDateBlocked && styles.inputInvalid]}
                    value={weddingDate}
                    // 하이픈은 사람이 아니라 앱이 넣는다. 자유 텍스트일 때 "2026/10/15"가
                    // 들어와도 제출 전까지 아무도 몰랐고, 서버 400은 이 화면을 떠난 뒤에 왔다.
                    onChangeText={(value) => setWeddingDate(formatWeddingDateInput(value))}
                    placeholder="YYYY-MM-DD"
                    placeholderTextColor={colors.taupe[400]}
                    keyboardType="number-pad"
                    maxLength={10}
                    accessibilityLabel="결혼 예정일, 숫자 여덟 자리"
                    accessibilityHint="2026년 10월 15일이면 20261015를 입력합니다. 하이픈은 자동으로 들어갑니다."
                  />
                  <Text
                    style={[styles.fieldHint, weddingDateBlocked && styles.fieldHintInvalid]}
                    accessibilityRole={weddingDateBlocked ? "alert" : undefined}
                  >
                    {weddingDateBlocked ? "확인 필요 · " : ""}{weddingDateEvaluation.message}
                  </Text>
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

          {/* Step 5-A: 준비 단계 한 줄 */}
          {step === ONBOARDING_PREPARATION_STEP && asksPreparation && stagePhase === "stage" && (
            <View style={styles.stepContent}>
              <Text style={styles.stepTitle}>준비 현황</Text>
              <Text style={styles.stepDesc}>지금 어디까지 왔는지 한 줄만 알려주세요</Text>

              <View style={styles.stageList}>
                {PREPARATION_STAGE_OPTIONS.map((option) => {
                  const selected = preparationStage === option.value;
                  return (
                    <Pressable
                      key={option.value}
                      style={[styles.stageCard, selected && styles.stageCardActive]}
                      onPress={() => handleStagePress(option.value)}
                      accessibilityRole="button"
                      accessibilityLabel={`${option.label} 선택`}
                      accessibilityState={{ selected }}
                    >
                      <Text style={[styles.stageLabel, selected && styles.stageLabelActive]}>
                        {option.label}
                      </Text>
                      <Text style={styles.stageHint}>{option.hint}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          )}

          {/* Step 5-B: 항목별 현황(선택) */}
          {step === ONBOARDING_PREPARATION_STEP && asksPreparation && stagePhase === "detail" && (
            <View style={styles.stepContent}>
              <Text style={styles.stepTitle}>항목별 현황</Text>
              <Text style={styles.stepDesc}>항목별로 더 알려주실 수 있나요? (선택)</Text>

              <View style={styles.stageDetail}>
                <PreparationProgressList
                  statuses={categoryStatuses}
                  onChange={handleCategoryStatusChange}
                  disabled={submitting}
                />
              </View>
            </View>
          )}

          {/* Step 6: 완료 */}
          {step === DONE_STEP && (
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

              <InviteCodeCard
                code={resultCode}
                tone="dark"
                label="파트너 초대 코드"
                copied={resultCodeCopied}
                onCopy={copyResultCode}
                style={styles.doneInviteCard}
              />
              {/* 기한은 코드를 보내는 이 자리에서 말한다(#136). 서버가 모르면 침묵한다. */}
              {resultDeadline ? (
                <Text style={styles.codeHint}>{resultDeadline}</Text>
              ) : null}
            </View>
          )}
        </Animated.View>
      </ScrollView>
      </DismissKeyboard>

      {/* 하단 버튼 */}
      <View style={styles.footer}>
        <Pressable
          style={[styles.nextBtn, !canNext() && step < DONE_STEP && styles.nextBtnDisabled]}
          onPress={handleNext}
          disabled={nextDisabled}
          accessibilityRole="button"
          accessibilityLabel={
            neutralEnabled
              ? "시작하기"
              : step === DONE_STEP
                ? "웨딩 라운지로 이동"
                : step === ONBOARDING_PREPARATION_STEP && stagePhase === "detail"
                  ? "준비 현황 저장하고 시작하기"
                  : submitsOnNext
                    ? "저장하고 시작하기"
                    : "다음 단계"
          }
          accessibilityState={{ disabled: nextDisabled, busy: submitting }}
        >
          {submitting ? (
            <ActivityIndicator color="#FFF" />
          ) : (
            <>
              <Text style={styles.nextText}>
                {neutralEnabled
                  ? "시작하기"
                  : step === DONE_STEP
                    ? "웨딩 라운지로 이동"
                    : submitsOnNext
                      ? "저장하고 시작하기"
                      : "다음"}
              </Text>
              {!neutralEnabled && step < DONE_STEP && (
                <ArrowRight size={20} color="#FFF" />
              )}
            </>
          )}
        </Pressable>

        {step === 4 && !submitsOnNext && (
          <Pressable
            onPress={handleNext}
            style={styles.skipBtn}
            disabled={submitting}
            accessibilityRole="button"
            accessibilityLabel="웨딩 스타일 건너뛰기"
            accessibilityState={{ disabled: submitting, busy: submitting }}
          >
            <Text style={styles.skipText}>건너뛰기</Text>
          </Pressable>
        )}

        {step === ONBOARDING_PREPARATION_STEP && stagePhase === "detail" && (
          <Pressable
            onPress={() => handleSubmit(false)}
            style={styles.skipBtn}
            disabled={submitting}
            accessibilityRole="button"
            accessibilityLabel="항목별 현황 건너뛰고 시작하기"
            // 단계를 안 골랐으면 "고른 단계만 저장한다"고 말하면 안 된다 — 고른 적이
            // 없다. 화면을 읽어주는 사람에게 특히 그렇다.
            //
            // "아무것도 저장 안 해요"라고도 하지 않는다. 이 버튼은 `handleSubmit(false)`라
            // 앞 화면에서 받은 예식일·예산은 그대로 저장된다. 범위를 이 화면으로 좁혀 말한다.
            accessibilityHint={
              preparationStage === null
                ? "이 화면에서는 아무것도 저장하지 않아요."
                : "고른 단계만 저장하고 항목별 상태는 저장하지 않아요."
            }
            accessibilityState={{ disabled: submitting, busy: submitting }}
          >
            <Text style={styles.skipText}>건너뛰고 시작하기</Text>
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
  inviteCodeFromLink: {
    marginTop: 16,
    fontSize: 12,
    fontFamily: "NotoSansKR_400Regular",
    color: colors.textSecondary,
    lineHeight: 18,
    textAlign: "center",
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
  fieldHintInvalid: { color: colors.noir[800] },
  inputInvalid: { borderColor: colors.danger },
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
  doneInviteCard: {
    marginTop: 24,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 16,
    elevation: 4,
  },

  // Step 5: 준비 현황
  stageList: { gap: 10 },
  stageCard: {
    paddingHorizontal: 18,
    paddingVertical: 16,
    borderRadius: 18,
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: colors.border,
    gap: 4,
  },
  stageCardActive: {
    borderColor: colors.rose[500],
    backgroundColor: colors.rose.pale + "20",
  },
  stageLabel: {
    fontSize: 15,
    fontFamily: "NotoSansKR_600SemiBold",
    color: colors.noir[800],
  },
  stageLabelActive: { color: colors.rose[500] },
  stageHint: {
    fontSize: 12,
    fontFamily: "NotoSansKR_400Regular",
    color: colors.textSecondary,
    lineHeight: 18,
  },
  stageDetail: { marginTop: 4 },

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
  // 완료 화면의 기한 한 줄(#136)이 쓰는 스타일. 병합 중 유실됐다가 되살렸다.
  codeHint: {
    fontSize: 12,
    fontFamily: "NotoSansKR_400Regular",
    color: colors.taupe[400],
  },
  skipText: {
    fontSize: 14,
    fontFamily: "NotoSansKR_400Regular",
    color: colors.textTertiary,
  },
});
