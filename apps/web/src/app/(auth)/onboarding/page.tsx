"use client";

import { useState, useEffect } from "react";
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
import { buildJoinedDashboardRedirect } from "@/lib/amora/dashboardCompanion";
import { getAuthRedirectPath } from "@/lib/auth/safeRedirect";

export default function OnboardingPage() {
  const store = useOnboardingStore();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [inviteCodeResult, setInviteCodeResult] = useState("");
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [pendingPlanNotice, setPendingPlanNotice] = useState("");
  const [deferredProgressNotice, setDeferredProgressNotice] = useState("");
  // 스텝 5는 화면 두 개다. 단계 한 줄(필수)을 먼저 받고, 19항목(선택)은 그다음에
  // 보여준다. 스텝 번호를 나누지 않는 이유는 서버가 완료 시 onboarding_step: 5를
  // 쓰고 StepIndicator도 같은 배열을 읽기 때문이다.
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
        // 에러 시 온보딩 계속 진행
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
        // 단계 한 줄은 필수다. 19항목은 이 다음 화면이고 건너뛸 수 있다.
        return store.preparationStage !== null;
      default:
        return false;
    }
  };

  const stageOption = findPreparationStageOption(store.preparationStage);
  const hasStageSuggestion =
    stageOption !== null && Object.keys(stageOption.suggested).length > 0;

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
  const handleSubmit = async (
    { includeChecklist = true }: { includeChecklist?: boolean } = {},
  ) => {
    setLoading(true);
    setError("");

    try {
      const isJoiningPartner = store.coupleAction === "join";
      const progress = buildOnboardingProgress({
        preferences: store.preferences,
        preparationStage: isJoiningPartner ? null : store.preparationStage,
        checklist: store.progressChecklist,
        includeChecklist: includeChecklist && !isJoiningPartner,
      });

      const res = await fetch("/api/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
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
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? "온보딩 저장에 실패했습니다.");
        return;
      }

      // 온보딩 완료 쿠키 설정
      document.cookie = "onboarding_complete=true; path=/; max-age=31536000";

      if (typeof data.inviteCode === "string") {
        setInviteCodeResult(data.inviteCode);
      }

      const isPendingPartner =
        data.planChange?.status === "pending_partner"
        && typeof data.planChange.summary === "string";
      const hasDeferredRoutineProgress =
        data.routineProgress?.status === "deferred"
        && typeof data.routineProgress.message === "string";
      if (isPendingPartner) {
        setPendingPlanNotice(data.planChange.summary);
      }
      if (hasDeferredRoutineProgress) {
        setDeferredProgressNotice(data.routineProgress.message);
      }
      if (isPendingPartner || hasDeferredRoutineProgress) {
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
    } catch {
      setError("오류가 발생했습니다. 다시 시도해주세요.");
    } finally {
      setLoading(false);
    }
  };

  const handleSkipChecklist = async () => {
    // 19항목은 보내지 않는다. 미리 채워둔 제안값도, "전부 아직"이라는 단정도
    // 사용자가 말한 적 없는 내용이다.
    await handleSubmit({ includeChecklist: false });
  };

  const continueAfterPendingPlan = () => {
    setPendingPlanNotice("");
    setDeferredProgressNotice("");
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
    <div className="min-h-screen bg-gradient-to-br from-ivory-50 via-ivory-warm to-ivory-deep flex items-center justify-center px-5 py-10">
      <div className="w-full max-w-[480px]">
        {/* 로고 */}
        <div className="text-center mb-8">
          <Logo size="md" />
          <p className="text-[13px] text-taupe-400 mt-2">결혼 준비 시작하기</p>
        </div>

        {/* 스텝 인디케이터 */}
        <StepIndicator currentStep={store.currentStep} coupleAction={store.coupleAction} />

        {/* 카드 */}
        <div className="bg-white/80 backdrop-blur-[20px] rounded-3xl border border-black/[0.04] p-8 shadow-[0_8px_40px_rgba(0,0,0,0.04)]">
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
                  stageNotice={
                    hasStageSuggestion
                      ? "보통 이 단계면 이 정도예요. 다르면 바꿔주세요. 여기서 확인한 내용만 저장돼요."
                      : "고른 단계에는 미리 채울 항목이 없어서 비워뒀어요. 이미 시작한 게 있으면 알려주세요."
                  }
                />
              )}
            </motion.div>
          </AnimatePresence>

          {/* 에러 */}
          {error && (
            <p className="text-[12px] text-rose-600 text-center mt-4">{error}</p>
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
                className="px-6 py-3 rounded-2xl text-[14px] font-medium border border-black/[0.08] text-taupe-500 hover:bg-black/[0.02] transition-all"
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
                  className="w-full py-3 rounded-2xl text-[14px] font-medium transition-all bg-gradient-to-br from-[#795252] to-[#946a6a] text-white shadow-[0_4px_14px_0_rgba(121,82,82,0.2)] hover:shadow-[0_6px_20px_rgba(121,82,82,0.23)] disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  {store.currentStep === 2 && store.coupleAction === "join"
                    ? loading ? "연결 중..." : "파트너와 연결하기"
                    : "다음"}
                </button>
                {/* 스타일 선호도 스킵 버튼 */}
                {store.currentStep === 4 && (
                  <button
                    onClick={() => store.nextStep()}
                    className="w-full py-2.5 rounded-2xl text-[13px] font-medium text-taupe-400 hover:text-taupe-500 hover:bg-black/[0.02] transition-all"
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
                  className="w-full py-3 rounded-2xl text-[14px] font-medium transition-all bg-gradient-to-br from-[#795252] to-[#946a6a] text-white shadow-[0_4px_14px_0_rgba(121,82,82,0.2)] hover:shadow-[0_6px_20px_rgba(121,82,82,0.23)] disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  다음
                </button>
              </div>
            ) : (
              <div className="flex-1 flex flex-col gap-2">
                <button
                  onClick={() => handleSubmit()}
                  disabled={loading}
                  className="w-full py-3 rounded-2xl text-[14px] font-medium transition-all bg-gradient-to-br from-[#795252] to-[#946a6a] text-white shadow-[0_4px_14px_0_rgba(121,82,82,0.2)] hover:shadow-[0_6px_20px_rgba(121,82,82,0.23)] disabled:opacity-50"
                >
                  {loading ? "저장 중..." : "저장하고 시작하기"}
                </button>
                <button
                  onClick={handleSkipChecklist}
                  disabled={loading}
                  className="w-full py-2.5 rounded-2xl text-[13px] font-medium text-taupe-400 hover:text-taupe-500 hover:bg-black/[0.02] transition-all"
                >
                  건너뛰고 시작하기
                </button>
              </div>
            )}
          </div>
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
              className="w-full max-w-[400px] rounded-3xl bg-white p-8 text-center shadow-[0_20px_60px_rgba(0,0,0,0.15)]"
            >
              <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-[#795252]/10 text-2xl">
                🤝
              </div>
              <h3
                id="pending-plan-title"
                className="mb-2 text-[20px] font-semibold text-noir-800"
              >
                {pendingPlanNotice
                  ? "파트너 확인을 요청했어요"
                  : "저장되지 않은 입력이 있어요"}
              </h3>
              {pendingPlanNotice && (
                <p className="mb-3 text-[13px] leading-relaxed text-taupe-500">
                  {pendingPlanNotice}
                </p>
              )}
              {pendingPlanNotice && (
                <p
                  className={`${deferredProgressNotice ? "mb-3" : "mb-6"} text-[12px] leading-relaxed text-taupe-400`}
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
                className="w-full rounded-2xl bg-[#795252] py-3 text-[14px] font-medium text-white transition-colors hover:bg-[#946a6a]"
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
              className="w-full max-w-[400px] bg-white rounded-3xl p-8 shadow-[0_20px_60px_rgba(0,0,0,0.15)] text-center"
            >
              <div className="w-14 h-14 mx-auto mb-5 rounded-full bg-rose-500/10 flex items-center justify-center">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#795252" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                  <circle cx="9" cy="7" r="4" />
                  <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
                  <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                </svg>
              </div>

              <h3 className="text-[20px] font-semibold text-noir-800 mb-2">
                파트너 초대 코드
              </h3>
              <p className="text-[13px] text-taupe-400 mb-5 leading-relaxed">
                코드·링크를 보내거나, 옆에 있는 파트너에게 QR을 바로 보여주세요.
                <br />
                파트너가 들어오면 두 사람이 같은 화면을 봐요.
              </p>

              {/* 코드 표시·복사·QR·공유 문구는 설정 화면과 같은 패널을 쓴다.
                  두 화면이 각자 복사 로직을 갖고 있으면 한쪽만 고쳐진다. */}
              <InviteCodePanel
                code={inviteCodeResult}
                variant="modal"
                className="mb-5"
              />

              <button
                onClick={() => {
                  window.location.href = getAuthRedirectPath(
                    window.location.search,
                    window.location.origin,
                  );
                }}
                className="w-full py-3 rounded-2xl text-[14px] font-medium text-taupe-500 hover:text-noir-800 hover:bg-black/[0.02] transition-all"
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
