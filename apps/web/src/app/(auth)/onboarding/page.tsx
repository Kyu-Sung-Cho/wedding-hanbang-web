"use client";

import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  findPreparationStageOption,
  parseCoupleInviteFragment,
} from "@hanbang/shared";
import { useOnboardingStore } from "@/stores/onboardingStore";
import Logo from "@/components/ui/Logo";
import StepIndicator from "@/components/onboarding/StepIndicator";
import RoleSelection from "@/components/onboarding/RoleSelection";
import CoupleLink from "@/components/onboarding/CoupleLink";
import WeddingDetails from "@/components/onboarding/WeddingDetails";
import WeddingStylePreferences from "@/components/onboarding/WeddingStylePreferences";
import PreparationStageSelect from "@/components/onboarding/PreparationStageSelect";
import ProgressChecklist from "@/components/onboarding/ProgressChecklist";
import InviteCodePanel from "@/components/invite/InviteCodePanel";
import { consumePendingCoupleInviteCode } from "@/lib/couples/pendingInvite";
import { buildOnboardingProgress } from "@/lib/onboarding/buildOnboardingProgress";
import NeutralPreparationStart from "@/components/onboarding/NeutralPreparationStart";
import { buildJoinedDashboardRedirect } from "@/lib/amora/dashboardCompanion";
import { getAuthRedirectPath } from "@/lib/auth/safeRedirect";
import { describeInviteDeadline } from "@hanbang/shared";
import {
  buildNeutralPreparationPrefill,
  buildNeutralPreparationSpaceSubmission,
  parseNeutralPreparationSpaceCapability,
  resolveNeutralPreparationSpaceRedirect,
} from "@/lib/onboarding/neutralPreparationSpace";
import type { WeddingPriorityValue } from "@hanbang/shared";

export default function OnboardingPage() {
  const store = useOnboardingStore();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [inviteCodeResult, setInviteCodeResult] = useState("");
  // 코드를 보내는 그 화면이 기한을 말해야 한다. 서버가 모르면 아무 말도 안 한다.
  const [inviteDeadline, setInviteDeadline] = useState<string | null>(null);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [pendingPlanNotice, setPendingPlanNotice] = useState("");
  const [deferredProgressNotice, setDeferredProgressNotice] = useState("");
  // 안내를 읽고 "확인하고 계속하기"를 눌렀을 때 갈 곳은 경로마다 다르다.
  // 중립 준비 공간은 자기 리다이렉트를 여기 담아두고, 레거시는 기존 분기를 쓴다.
  const pendingContinuationRef = useRef<(() => void) | null>(null);

  // 스텝 5는 화면 두 개다. 단계 한 줄을 먼저 받고, 19항목은 그다음에 보여준다.
  // **둘 다 선택이다** — 관문 판단은 `canProceed`의 case 5에 근거와 함께 적어 뒀다.
  // 스텝 번호를 나누지 않는 이유는 서버가 완료 시 onboarding_step: 5를 쓰고
  // StepIndicator도 같은 배열을 읽기 때문이다.
  const [stagePhase, setStagePhase] = useState<"stage" | "detail">("stage");
  // 초대 링크를 눌러서 들어왔는지. 코드가 이미 채워져 있는 이유를 화면이 말해줘야
  // 한다 — 안 그러면 자기가 친 적 없는 글자가 입력칸에 있는 것으로 보인다.
  const [inviteCodeFromLink, setInviteCodeFromLink] = useState(false);

  // persist를 skipHydration으로 두었기 때문에 마운트 후 직접 복원한다. 새로고침
  // 한 번에 19항목 입력이 통째로 날아가던 문제를 막으면서, 서버가 그린 첫 HTML과
  // 클라이언트 첫 렌더가 어긋나지 않게 하는 순서다.
  useEffect(() => {
    void useOnboardingStore.persist.rehydrate();
  }, []);

  // 초대 링크에서 넘어온 코드를 받는다.
  //
  // 길이 두 개다.
  //   1) 주소의 `#` — 이미 로그인한 사람은 미들웨어에 막히지 않고 여기 그대로 도착한다.
  //   2) 한 번 쓰는 보관 — 아직 로그인하지 않은 사람은 이 화면에 오기 전에 **서버 307**로
  //      `/login`에 보내진다. 화면이 마운트되지 않으니 `#`를 읽을 기회도 없다. 그래서
  //      `/invite`가 코드를 보관에 넣어두고 깨끗한 주소로 보낸다.
  //
  // 이 화면이 그 값을 읽지 않으면, 링크를 눌러 들어온 사람도 결국 WH- + 12자리를 손으로
  // 옮겨 적는다 — 링크와 QR을 만든 이유가 사라진다.
  //
  // rehydrate 뒤에 놓는다. 세션에 남아 있던 옛 선택이 방금 눌러서 들어온 링크를
  // 덮으면 안 된다. 읽은 뒤에는 주소창에서 지운다 — 화면에 이미 채워졌으니 더는
  // 필요 없고, 뒤로 가기나 주소 공유로 열쇠가 따라다닐 이유가 없다.
  useEffect(() => {
    const codeFromHash = parseCoupleInviteFragment(window.location.hash);
    // 보관은 꺼내는 즉시 비운다. 온보딩을 마치고 다시 들어왔을 때 예전 링크의 코드가
    // 되살아나면, 이미 연결된 사람이 남의 코드로 합류를 시도한다.
    const code = codeFromHash ?? consumePendingCoupleInviteCode();
    if (!code) return;

    const store = useOnboardingStore.getState();
    store.setCoupleAction("join");
    store.setPartnerInviteCode(code);
    setInviteCodeFromLink(true);

    if (codeFromHash) {
      window.history.replaceState(
        null,
        "",
        `${window.location.pathname}${window.location.search}`,
      );
    }
  }, []);
  // 중립 준비 공간이 켜지면 역할·상세 스텝을 건너뛰고 한 화면에서 시작한다.
  // 서버가 플래그를 판정해 capabilities로 내려준다 — 클라이언트가 정하지 않는다.
  const [neutralPreparationSpaceEnabled, setNeutralPreparationSpaceEnabled] =
    useState(false);
  // 판정이 끝나기 전에는 어느 쪽도 그리지 않는다. 기본값 false로 그려버리면
  // 첫 페인트에 역할 선택(👰 신부 / 🤵 신랑)이 번쩍이고, /api/auth/me 가
  // 실패하면 그 화면이 영구가 된다 — 플래그가 켜져 있어도.
  const [capabilitiesResolved, setCapabilitiesResolved] = useState(false);
  const [capabilitiesFailed, setCapabilitiesFailed] = useState(false);
  // 중립 경로 전용 입력. 예식일은 스토어의 weddingDate 를 그대로 재사용하고,
  // 관심사는 저장이 아니라 첫 대화 초안을 만드는 데 쓴다.
  const [neutralFocus, setNeutralFocus] = useState<WeddingPriorityValue | null>(null);

  // 이미 온보딩 완료한 유저인지 확인
  useEffect(() => {
    const checkProfile = async () => {
      try {
        const res = await fetch("/api/auth/me");
        if (!res.ok) {
          window.location.href = "/login";
          return;
        }
        const data = await res.json();
        setNeutralPreparationSpaceEnabled(
          parseNeutralPreparationSpaceCapability(data.capabilities),
        );
        setCapabilitiesResolved(true);
        if (!data.profile) {
          return; // 프로필 없으면 온보딩 진행
        }
        if (data.profile.onboarding_completed) {
          document.cookie = "onboarding_complete=true; path=/; max-age=31536000";
          window.location.href = getAuthRedirectPath(
            window.location.search,
            window.location.origin,
          );
        }
      } catch {
        // 판정 실패를 "역할을 물어봐도 된다"로 읽지 않는다. 사용자에게 다시
        // 시도할 길을 주고, 그 전까지는 아무것도 그리지 않는다.
        setCapabilitiesFailed(true);
      }
    };
    checkProfile();
  }, []);

  const canProceed = () => {
    switch (store.currentStep) {
      case 1:
        return store.role !== null;
      case 2:
        if (store.coupleAction === "join") {
          return /^WH-[A-Z0-9]{6,12}$/.test(store.partnerInviteCode);
        }
        return store.coupleAction !== null;
      case 3:
        return true;
      case 4:
        return true; // 스타일 선호도는 선택사항 (스킵 가능)
      case 5:
        // 단계 한 줄도 **선택이다.**
        //
        // 처음에는 필수로 뒀는데, main의 #138이 온보딩 질문을 고른 기준이 명시적이다 —
        // "이 값이 없으면 무엇이 죽는가 × 나중에 받아낼 경로가 살아 있는가". 그 기준으로
        // 장소·예산·체크리스트·스타일을 온보딩에서 뺐다(파운더 계정이 7개월간
        // onboarding_step=1에 멈춰 있었고 완주 사례가 사실상 없었다).
        //
        // 이 값의 소비처를 전수로 보면 라운지 첫 도착 카드와 아모라 첫인사 둘뿐이고,
        // 둘 다 null일 때 폴백이 있다 — `packages/shared/src/contracts/`의
        // `loungeFirstRun.ts`(`FALLBACK_NEXT_STEP`)와 `amoraFirstHello.ts`("지금 어디까지
        // 오셨는지는 편하실 때 알려주세요"). 줄 번호는 적지 않는다 — 썩는다.
        // 즉 없어도 아무것도 죽지 않는다. 반대로 필수로 두면 온보딩에 관문이 하나 더
        // 생기는데, 그게 #138이 없애려던 바로 그것이다.
        return true;
      default:
        return false;
    }
  };

  const stageOption = findPreparationStageOption(store.preparationStage);
  const hasStageSuggestion =
    stageOption !== null && Object.keys(stageOption.suggested).length > 0;

  /**
   * 19항목 위에 붙는 안내문. **세 갈래다** — 두 갈래로 두면 거짓말이 된다.
   *
   * 단계를 선택으로 바꾼 순간(`canProceed` case 5) 아무것도 안 고르고 이 화면에
   * 도착하는 길이 열렸다. 그런데 안내문은 "고른 단계에는 미리 채울 항목이 없어서"
   * 한 갈래뿐이라, 고른 적 없는 선택을 고쳤다고 말하게 된다. 사용자는 자기가
   * 뭘 골랐는지 되짚어보게 되고, 그건 이 화면이 만들 필요가 없는 혼란이다.
   */
  const stageNotice = hasStageSuggestion
    ? "보통 이 단계면 이 정도예요. 다르면 바꿔주세요. 여기서 확인한 내용만 저장돼요."
    : store.preparationStage === null
      ? "단계는 아직 안 고르셨어요. 이미 시작한 게 있으면 여기서 알려주세요."
      : "고른 단계에는 미리 채울 항목이 없어서 비워뒀어요. 이미 시작한 게 있으면 알려주세요.";

  const getCompletionRedirectSearch = () => {
    const requestedPath = getAuthRedirectPath(
      window.location.search,
      window.location.origin,
    );
    // 랜딩에서 시작한 명시적 목적지가 있으면 가입 전 맥락을 우선 보존한다.
    // 별도 목적지 없이 파트너에게 참여한 경우에만 연결 결과를 웨딩 라운지에 알린다.
    if (
      store.coupleAction !== "join"
      || requestedPath !== "/wedding/lounge"
    ) {
      return window.location.search;
    }
    return `?${new URLSearchParams({
      redirect: buildJoinedDashboardRedirect(),
    })}`;
  };

  /**
   * `includeChecklist`가 false면 19항목을 아예 보내지 않는다.
   *
   * 19항목 화면은 고른 단계의 제안값으로 미리 채워져 있다. 그 화면을 건너뛴
   * 사람에게 제안값은 "본 적도 없는 남의 추정"이라, 보내는 순간 사용자가 직접
   * 말하지 않은 것이 준비 완료 사실로 저장된다. 건너뛰면 단계만 남긴다.
   *
   * 초대 코드로 합류하는 사람은 준비 현황을 아예 묻지 않는다. `couples.progress`는
   * 두 사람이 함께 쓰는 자리라, 먼저 시작한 파트너가 적어둔 단계와 19항목을 나중에
   * 온 사람의 세션 값이 덮어쓴다. 합류는 스텝 2에서 바로 제출되므로 그 값은 사용자가
   * 화면에서 본 적도 없는 값이다 — 단계도 항목도 싣지 않는다.
   */
  /**
   * 인자가 문자열이면 중립 준비 공간 경로다(main #138). 객체면 기존 6단계 경로의
   * 옵션이다. 두 경로가 같은 화면 파일 안에서 플래그로 갈리므로 제출 함수도 하나다.
   */
  const handleSubmit = async (
    arg?: "create" | "join" | { includeChecklist?: boolean },
  ) => {
    const neutralCoupleAction = typeof arg === "string" ? arg : undefined;
    const includeChecklist =
      typeof arg === "object" && arg !== null ? arg.includeChecklist !== false : true;
    setLoading(true);
    setError("");

    try {
      let requestBody: Record<string, unknown>;
      if (neutralCoupleAction) {
        if (!neutralPreparationSpaceEnabled) {
          throw new Error("NEUTRAL_PREPARATION_SPACE_NOT_ENABLED");
        }
        requestBody = buildNeutralPreparationSpaceSubmission({
          coupleAction: neutralCoupleAction,
          partnerInviteCode: store.partnerInviteCode,
          weddingDate: store.weddingDate,
          focusPriority: neutralFocus,
        });
      } else {
        // 기존 경로의 progress 조립은 이 브랜치가 공유 계약으로 옮겼다. main 쪽은
        // 화면 안에서 직접 조립하는데, 그러면 카테고리가 늘어난 날 화면과 서버가
        // 갈린다(#135가 greeting·registration을 추가한 것이 그 예다).
        const isJoiningPartner = store.coupleAction === "join";
        const progress = buildOnboardingProgress({
          preferences: store.preferences,
          preparationStage: isJoiningPartner ? null : store.preparationStage,
          checklist: store.progressChecklist,
          includeChecklist: includeChecklist && !isJoiningPartner,
        });

        requestBody = {
          role: store.role,
          coupleAction: store.coupleAction,
          partnerInviteCode:
            store.coupleAction === "join" ? store.partnerInviteCode : undefined,
          weddingDate: store.weddingDateUndecided ? null : store.weddingDate,
          venue: store.venueUndecided ? null : store.venue,
          sanggyeonryeDate: store.sanggyeonryeUndecided ? null : store.sanggyeonryeDate,
          totalBudget: store.approximateBudget > 0
            ? { amount: store.approximateBudget, unit: "won" }
            : null,
          progress,
        };
      }

      const res = await fetch("/api/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? "온보딩 저장에 실패했습니다.");
        return;
      }

      // 온보딩 완료 쿠키 설정
      document.cookie = "onboarding_complete=true; path=/; max-age=31536000";

      // 승인 대기·보류 판정을 **경로를 고르기 전에** 한다.
      //
      // 예전에는 이 계산이 아래 레거시 분기에만 있었고 중립 준비 공간 분기가
      // 그보다 먼저 무조건 return 했다. 그래서 나중에 합류한 사람은 결혼 날짜를
      // 입력하고도 아무 말을 못 듣고 채팅으로 넘어갔다 — 날짜는 두 사람 승인
      // 대기에 걸려 있는데 홈은 계속 "결혼식 날짜를 알려주세요"라고 말한다.
      // 합류는 두 슬롯이 다 차 있어 날짜 변경이 항상 고영향이므로, 이건 드문
      // 경우가 아니라 **두 번째 사람의 정상 경로**다.
      //
      // 같은 결함을 모바일에서 먼저 고쳤다(apps/mobile/app/onboarding/index.tsx).
      // 두 표면이 같은 상태를 다르게 말하면 커플이 서로 다른 것을 본다.
      const isPendingPartner =
        data.planChange?.status === "pending_partner"
        && typeof data.planChange.summary === "string";
      const hasDeferredRoutineProgress =
        data.routineProgress?.status === "deferred"
        && typeof data.routineProgress.message === "string";
      const showPendingNotice = () => {
        if (isPendingPartner) {
          setPendingPlanNotice(data.planChange.summary);
        }
        if (hasDeferredRoutineProgress) {
          setDeferredProgressNotice(data.routineProgress.message);
        }
      };

      if (neutralCoupleAction) {
        // 새로 만든 경우 초대 코드를 보여준다. 안 보여주면 상대를 부르려고
        // 설정 화면을 뒤져야 한다 — 함께 준비하는 게 이 제품의 요지인데.
        if (neutralCoupleAction === "create" && typeof data.inviteCode === "string") {
          setInviteCodeResult(data.inviteCode);
          void loadInviteDeadline();
          setShowInviteModal(true);
          return;
        }
        const goToNeutralDestination = () => {
          window.location.href = resolveNeutralPreparationSpaceRedirect({
            search: window.location.search,
            origin: window.location.origin,
            prefill: buildNeutralPreparationPrefill({
              weddingDate: typeof data.journey?.wedding_date === "string"
                ? data.journey.wedding_date
                : null,
              focusPriority: neutralFocus,
            }),
          });
        };
        if (isPendingPartner || hasDeferredRoutineProgress) {
          pendingContinuationRef.current = goToNeutralDestination;
          showPendingNotice();
          return;
        }
        goToNeutralDestination();
        return;
      }

      if (typeof data.inviteCode === "string") {
        setInviteCodeResult(data.inviteCode);
        void loadInviteDeadline();
      }

      if (isPendingPartner || hasDeferredRoutineProgress) {
        showPendingNotice();
        return;
      }

      // 초대코드가 있고 "새로 시작하기"인 경우 모달 표시
      if (data.inviteCode && store.coupleAction === "create") {
        setShowInviteModal(true);
        // 리다이렉트 하지 않음 → 모달에서 사용자가 직접 이동
      } else {
        window.location.href = getAuthRedirectPath(
          getCompletionRedirectSearch(),
          window.location.origin,
        );
      }
    } catch (submitError) {
      setError(
        submitError instanceof Error
          && submitError.message === "INVALID_NEUTRAL_PREPARATION_INVITE_CODE"
          ? "초대 코드 형식을 다시 확인해 주세요."
          : "오류가 발생했습니다. 다시 시도해주세요.",
      );
    } finally {
      setLoading(false);
    }
  };

  const handleSkipChecklist = async () => {
    // 19항목은 보내지 않는다. 미리 채워둔 제안값도, "전부 아직"이라는 단정도
    // 사용자가 말한 적 없는 내용이다.
    await handleSubmit({ includeChecklist: false });
  };

  /**
   * 기한은 /api/couple/code 에서 읽는다. 온보딩 라우트는 couples 를 직접 만지지
   * 않는 경계를 지켜야 해서(그 경계는 테스트로 고정돼 있다) 여기서 따로 묻는다.
   * 못 읽으면 아무 말도 하지 않는다 — 없는 기한을 지어내지 않고, 코드 표시를
   * 막지도 않는다.
   */
  const loadInviteDeadline = async () => {
    try {
      const res = await fetch("/api/couple/code");
      if (!res.ok) return;
      const payload: unknown = await res.json().catch(() => null);
      const expiresAt = typeof payload === "object" && payload !== null
        ? (payload as { inviteCodeExpiresAt?: unknown }).inviteCodeExpiresAt
        : null;
      setInviteDeadline(describeInviteDeadline(expiresAt));
    } catch {
      // 조용히 넘어간다.
    }
  };

  // main의 handleCopyCode 는 여기서 지웠다. 이 화면의 코드 표시가
  // InviteCodePanel 로 바뀌면서 복사·링크·QR·문구를 패널이 직접 하고,
  // 화면에는 그 함수를 부르는 자리가 하나도 남지 않았다(참조 0건).

  const continueAfterPendingPlan = () => {
    setPendingPlanNotice("");
    setDeferredProgressNotice("");
    // 중립 준비 공간이 담아둔 목적지가 있으면 그리로 간다. 없으면 레거시 경로.
    const continuation = pendingContinuationRef.current;
    pendingContinuationRef.current = null;
    if (continuation) {
      continuation();
      return;
    }
    if (inviteCodeResult && store.coupleAction === "create") {
      setShowInviteModal(true);
      return;
    }
    window.location.href = getAuthRedirectPath(
      getCompletionRedirectSearch(),
      window.location.origin,
    );
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-[var(--hb-surface-page)] via-[var(--hb-surface-hover)] to-ivory-deep flex items-center justify-center px-5 py-10">
      <div className="w-full max-w-[480px]">
        {/* 로고 */}
        <div className="text-center mb-8">
          <Logo size="md" />
          <p className="text-[13px] text-[var(--hb-text-muted)] mt-2">결혼 준비 시작하기</p>
        </div>

        {/* 스텝 인디케이터 */}
        {/*
          진행 표시는 **한 벌만** 그린다. 여기 두 벌이 형제로 나란히 있어서,
          초대 코드로 합류하는 사람에게 "2단계 중 2번째"(coupleAction 판)와
          "5단계 중 2번째"(조건부 판)가 동시에 보였다. 제품에서 처음 보는
          화면에서 남은 단계가 몇 개인지 알 수 없었고, 실제로는 2단계에서
          끝나므로 세 단계를 더 기다리다 갑자기 끝난 것처럼 느낀다.

          남긴 쪽은 coupleAction 을 받는 판이다 — 합류 흐름의 실제 단계 수를
          아는 것은 이쪽뿐이다(JOIN_VISIBLE_STEPS).
        */}
        <StepIndicator currentStep={store.currentStep} coupleAction={store.coupleAction} />

        {/* 카드 */}
        <div className="bg-white/80 backdrop-blur-[20px] rounded-[6px] border border-black/[0.04] p-8 shadow-[var(--shadow-raised)]">
          {capabilitiesFailed ? (
            <div className="py-10 text-center" role="alert">
              <p className="text-[15px] text-[var(--hb-text-strong)]">
                준비 화면을 불러오지 못했어요.
              </p>
              <p className="mt-2 text-[13px] text-[var(--hb-text-muted)]">
                연결을 확인하고 다시 시도해 주세요.
              </p>
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="mt-5 min-h-11 rounded-[6px] bg-[var(--hb-primary)] px-5 text-sm font-medium text-white"
              >
                다시 시도
              </button>
            </div>
          ) : !capabilitiesResolved ? (
            <div className="py-16 text-center" aria-busy="true">
              <p className="text-[13px] text-[var(--hb-text-muted)]">불러오는 중…</p>
            </div>
          ) : neutralPreparationSpaceEnabled ? (
            <NeutralPreparationStart
              error={error}
              coupleAction={store.coupleAction === "join" ? "join" : null}
              partnerCode={store.partnerInviteCode}
              loading={loading}
              onCreate={() => {
                store.setCoupleAction("create");
                void handleSubmit("create");
              }}
              onSelectJoin={() => {
                setError("");
                store.setCoupleAction("join");
              }}
              onPartnerCodeChange={store.setPartnerInviteCode}
              onJoin={() => void handleSubmit("join")}
              weddingDate={store.weddingDate ?? ""}
              onWeddingDateChange={store.setWeddingDate}
              focusPriority={neutralFocus}
              onFocusPriorityChange={setNeutralFocus}
            />
          ) : (
          <>
          <AnimatePresence mode="wait">
            <motion.div
              key={store.currentStep === 5 ? `5-${stagePhase}` : store.currentStep}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.3 }}
            >
              {store.currentStep === 1 && (
                <RoleSelection
                  selected={store.role}
                  onSelect={store.setRole}
                />
              )}
              {store.currentStep === 2 && (
                <CoupleLink
                  coupleAction={store.coupleAction}
                  onSelectAction={store.setCoupleAction}
                  partnerCode={store.partnerInviteCode}
                  onPartnerCodeChange={(code) => {
                    // 직접 고치기 시작하면 "링크에서 받았다"는 안내를 끈다.
                    // 사용자가 지운 값을 두고 계속 채워뒀다고 말하면 안 된다.
                    setInviteCodeFromLink(false);
                    store.setPartnerInviteCode(code);
                  }}
                  prefilledNotice={
                    inviteCodeFromLink
                      ? "초대 링크에서 받은 코드를 넣어 뒀어요."
                      : undefined
                  }
                />
              )}
              {store.currentStep === 3 && (
                <WeddingDetails
                  weddingDate={store.weddingDate}
                  weddingDateUndecided={store.weddingDateUndecided}
                  venue={store.venue}
                  venueUndecided={store.venueUndecided}
                  sanggyeonryeDate={store.sanggyeonryeDate}
                  sanggyeonryeUndecided={store.sanggyeonryeUndecided}
                  budget={store.approximateBudget}
                  onDateChange={store.setWeddingDate}
                  onDateUndecidedChange={store.setWeddingDateUndecided}
                  onVenueChange={store.setVenue}
                  onVenueUndecidedChange={store.setVenueUndecided}
                  onSanggyeonryeDateChange={store.setSanggyeonryeDate}
                  onSanggyeonryeUndecidedChange={store.setSanggyeonryeUndecided}
                  onBudgetChange={store.setBudget}
                />
              )}
              {store.currentStep === 4 && (
                <WeddingStylePreferences
                  preferences={store.preferences}
                  onStyleChange={store.setWeddingStyle}
                  onTogglePriority={store.togglePriority}
                  onBudgetTendencyChange={store.setBudgetTendency}
                  onGuestCountChange={store.setGuestCount}
                />
              )}
              {store.currentStep === 5 && stagePhase === "stage" && (
                <PreparationStageSelect
                  selected={store.preparationStage}
                  onSelect={store.setPreparationStage}
                />
              )}
              {store.currentStep === 5 && stagePhase === "detail" && (
                <ProgressChecklist
                  items={store.progressChecklist}
                  onStatusChange={store.setChecklistItemStatus}
                  onCostChange={store.setChecklistItemCost}
                  stageNotice={stageNotice}
                />
              )}
            </motion.div>
          </AnimatePresence>

          {/* 에러 */}
          {error && (
            <p className="text-[12px] text-[var(--hb-accent-hover)] text-center mt-4">{error}</p>
          )}

          {/* 버튼 */}
          <div className="flex gap-3 mt-6">
            {store.currentStep > 1 && (
              <button
                onClick={() => {
                  // 19항목에서 뒤로 가면 스텝 4가 아니라 단계 선택으로 돌아간다.
                  // 두 화면이 한 스텝 안에 있으므로 되돌아갈 곳도 그 안이다.
                  if (store.currentStep === 5 && stagePhase === "detail") {
                    setStagePhase("stage");
                    return;
                  }
                  store.prevStep();
                }}
                className="px-6 py-3 rounded-[6px] text-[14px] font-medium border border-black/[0.08] text-[var(--hb-text-body)] hover:bg-black/[0.02] transition-all"
              >
                이전
              </button>
            )}
            {store.currentStep < 5 ? (
              <div className="flex-1 flex flex-col gap-2">
                <button
                  onClick={() => {
                    // 파트너 코드로 참여 시, step 2 다음에 바로 제출 (3,4,5 스킵)
                    if (store.currentStep === 2 && store.coupleAction === "join") {
                      handleSubmit();
                      return;
                    }
                    store.nextStep();
                  }}
                  disabled={!canProceed() || (store.currentStep === 2 && store.coupleAction === "join" && loading)}
                  className="w-full py-3 rounded-[6px] text-[14px] font-medium transition-all bg-[var(--hb-primary)] hover:bg-[var(--hb-primary-hover)] text-white shadow-[var(--shadow-raised)] hover:shadow-[var(--shadow-raised)] disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  {store.currentStep === 2 && store.coupleAction === "join"
                    ? loading ? "연결 중..." : "파트너와 연결하기"
                    : "다음"}
                </button>
                {/* 스타일 선호도 스킵 버튼 */}
                {store.currentStep === 4 && (
                  <button
                    onClick={() => store.nextStep()}
                    className="w-full py-2.5 rounded-[6px] text-[13px] font-medium text-[var(--hb-text-muted)] hover:text-[var(--hb-text-body)] hover:bg-black/[0.02] transition-all"
                  >
                    나중에 설정할게요
                  </button>
                )}
              </div>
            ) : stagePhase === "stage" ? (
              <div className="flex-1">
                <button
                  onClick={() => setStagePhase("detail")}
                  disabled={!canProceed()}
                  className="w-full py-3 rounded-[6px] text-[14px] font-medium transition-all bg-[var(--hb-primary)] hover:bg-[var(--hb-primary-hover)] text-white shadow-[var(--shadow-raised)] hover:shadow-[var(--shadow-raised)] disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  다음
                </button>
              </div>
            ) : (
              <div className="flex-1 flex flex-col gap-2">
                <button
                  onClick={() => void handleSubmit()}
                  disabled={loading}
                  className="w-full py-3 rounded-[6px] text-[14px] font-medium transition-all bg-[var(--hb-primary)] hover:bg-[var(--hb-primary-hover)] text-white shadow-[var(--shadow-raised)] hover:shadow-[var(--shadow-raised)] disabled:opacity-50"
                >
                  {loading ? "저장 중..." : "저장하고 시작하기"}
                </button>
                <button
                  onClick={handleSkipChecklist}
                  disabled={loading}
                  className="w-full py-2.5 rounded-[6px] text-[13px] font-medium text-[var(--hb-text-muted)] hover:text-[var(--hb-text-body)] hover:bg-black/[0.02] transition-all"
                >
                  건너뛰고 시작하기
                </button>
              </div>
            )}
          </div>
          </>
          )}
        </div>
      </div>

      {/* 초대코드 모달 */}
      <AnimatePresence>
        {(pendingPlanNotice || deferredProgressNotice) && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 backdrop-blur-sm px-5"
            role="dialog"
            aria-modal="true"
            aria-labelledby="pending-plan-title"
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className="w-full max-w-[400px] rounded-[6px] bg-white p-8 text-center shadow-[var(--shadow-overlay)]"
            >
              <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-[var(--hb-surface-hover)] text-2xl">
                🤝
              </div>
              <h3
                id="pending-plan-title"
                className="mb-2 text-[20px] font-semibold text-[var(--hb-text-strong)]"
              >
                {pendingPlanNotice
                  ? "파트너 확인을 요청했어요"
                  : "저장되지 않은 입력이 있어요"}
              </h3>
              {pendingPlanNotice && (
                <p className="mb-3 text-[13px] leading-relaxed text-[var(--hb-text-body)]">
                  {pendingPlanNotice}
                </p>
              )}
              {pendingPlanNotice && (
                <p
                  className={`${deferredProgressNotice ? "mb-3" : "mb-6"} text-[12px] leading-relaxed text-[var(--hb-text-muted)]`}
                >
                  아직 계획에는 반영되지 않았어요. 두 사람이 모두 확인하면 자동으로 반영됩니다.
                </p>
              )}
              {deferredProgressNotice && (
                <p className="mb-6 text-[12px] leading-relaxed text-rose-700">
                  {deferredProgressNotice}
                </p>
              )}
              <button
                type="button"
                onClick={continueAfterPendingPlan}
                className="w-full rounded-[6px] bg-[var(--hb-primary)] py-3 text-[14px] font-medium text-white transition-colors hover:bg-[var(--hb-primary-hover)]"
              >
                확인하고 계속하기
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showInviteModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm px-5"
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              transition={{ duration: 0.3 }}
              className="w-full max-w-[400px] max-h-[calc(100dvh-3rem)] overflow-y-auto overscroll-contain bg-white rounded-[6px] p-6 sm:p-8 shadow-[var(--shadow-overlay)] text-center"
            >
              <div className="w-14 h-14 mx-auto mb-5 rounded-full bg-rose-500/10 flex items-center justify-center">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#26251F" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                  <circle cx="9" cy="7" r="4" />
                  <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
                  <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                </svg>
              </div>

              <h3 className="text-[20px] font-semibold text-[var(--hb-text-strong)] mb-2">
                파트너 초대 코드
              </h3>
              <p className="text-[13px] text-[var(--hb-text-muted)] mb-5 leading-relaxed">
                코드·링크를 보내거나, 옆에 있는 파트너에게 QR을 바로 보여주세요.
                <br />
                파트너가 들어오면 두 사람이 같은 화면을 봐요.
              </p>

              {/* 코드 표시·복사·QR·공유 문구는 설정 화면과 같은 패널을 쓴다.
                  두 화면이 각자 복사 로직을 갖고 있으면 한쪽만 고쳐진다. */}
              {/* 기한은 코드를 보내는 이 자리에서 말한다(#136). 패널로 바꾸면서
                  `inviteDeadline`을 계산만 하고 화면에 쓰지 않아 안내가 사라졌었다 —
                  그러면 실사용 코드가 경고 없이 만료된다. */}
              <InviteCodePanel
                code={inviteCodeResult}
                variant="modal"
                notice={
                  inviteDeadline ? { message: inviteDeadline, tone: "active" } : null
                }
                className="mb-5"
              />

              <button
                onClick={() => {
                  // 중립 경로는 아모라를 첫 화면으로 삼는다 — 온보딩에서 아무것도
                  // 묻지 않았으니 대화가 곧 시작점이다.
                  window.location.href = neutralPreparationSpaceEnabled
                    ? resolveNeutralPreparationSpaceRedirect({
                        search: window.location.search,
                        origin: window.location.origin,
                        prefill: buildNeutralPreparationPrefill({
                          weddingDate: store.weddingDate || null,
                          focusPriority: neutralFocus,
                        }),
                      })
                    : getAuthRedirectPath(
                        window.location.search,
                        window.location.origin,
                      );
                }}
                className="w-full py-3 rounded-[6px] text-[14px] font-medium text-[var(--hb-text-body)] hover:text-[var(--hb-text-strong)] hover:bg-black/[0.02] transition-all"
              >
                결혼 준비 계속하기
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
