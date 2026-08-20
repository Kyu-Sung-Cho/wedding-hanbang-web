"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useOnboardingStore } from "@/stores/onboardingStore";
import Logo from "@/components/ui/Logo";
import StepIndicator from "@/components/onboarding/StepIndicator";
import RoleSelection from "@/components/onboarding/RoleSelection";
import CoupleLink from "@/components/onboarding/CoupleLink";
import WeddingDetails from "@/components/onboarding/WeddingDetails";
import WeddingStylePreferences from "@/components/onboarding/WeddingStylePreferences";
import ProgressChecklist from "@/components/onboarding/ProgressChecklist";
import NeutralPreparationStart from "@/components/onboarding/NeutralPreparationStart";
import { buildJoinedDashboardRedirect } from "@/lib/amora/dashboardCompanion";
import { getAuthRedirectPath } from "@/lib/auth/safeRedirect";
import {
  buildNeutralPreparationSpaceSubmission,
  parseNeutralPreparationSpaceCapability,
  resolveNeutralPreparationSpaceRedirect,
} from "@/lib/onboarding/neutralPreparationSpace";

export default function OnboardingPage() {
  const store = useOnboardingStore();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [inviteCodeResult, setInviteCodeResult] = useState("");
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [codeCopied, setCodeCopied] = useState(false);
  const [pendingPlanNotice, setPendingPlanNotice] = useState("");
  const [deferredProgressNotice, setDeferredProgressNotice] = useState("");
  // 중립 준비 공간이 켜지면 역할·상세 스텝을 건너뛰고 한 화면에서 시작한다.
  // 서버가 플래그를 판정해 capabilities로 내려준다 — 클라이언트가 정하지 않는다.
  const [neutralPreparationSpaceEnabled, setNeutralPreparationSpaceEnabled] =
    useState(false);

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
        return true;
      default:
        return false;
    }
  };

  const getCompletionRedirectSearch = () => {
    const requestedPath = getAuthRedirectPath(
      window.location.search,
      window.location.origin,
    );
    // 랜딩에서 시작한 명시적 목적지가 있으면 가입 전 맥락을 우선 보존한다.
    // 별도 목적지 없이 파트너에게 참여한 경우에만 연결 결과를 대시보드에 알린다.
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

  // neutralCoupleAction이 있으면 중립 준비 공간 경로다 — 역할·예식일·예산·스타일을
  // 묻지 않고 바로 시작한다. 나머지는 각자 필요한 화면에서 채운다.
  const handleSubmit = async (neutralCoupleAction?: "create" | "join") => {
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
        });
      } else {
        const progress: Record<string, unknown> = {};
        store.progressChecklist.forEach((item) => {
          // 입력한 실제 지출만 원 단위로 저장한다. 계획 예산은 사용자가 예산
          // 화면에서 별도로 입력하며, 실제 지출을 예산으로 추정하지 않는다.
          const costInWon = item.status === "completed" && item.cost ? item.cost * 10000 : null;
          progress[item.key] = costInWon
            ? { status: item.status, spent: costInWon }
            : { status: item.status };
        });

        // 결혼식 선호도 저장
        progress.__preferences = {
          weddingStyle: store.preferences.weddingStyle,
          priorities: store.preferences.priorities,
          budgetTendency: store.preferences.budgetTendency,
          guestCount: store.preferences.guestCount,
        };

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

      if (neutralCoupleAction) {
        window.location.href = resolveNeutralPreparationSpaceRedirect({
          search: window.location.search,
          origin: window.location.origin,
        });
        return;
      }

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
    // 체크리스트를 모두 not_started로 유지한 채 제출
    await handleSubmit();
  };

  const handleCopyCode = async () => {
    try {
      await navigator.clipboard.writeText(inviteCodeResult);
      setCodeCopied(true);
      setTimeout(() => setCodeCopied(false), 2000);
    } catch {
      // fallback
      const textArea = document.createElement("textarea");
      textArea.value = inviteCodeResult;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand("copy");
      document.body.removeChild(textArea);
      setCodeCopied(true);
      setTimeout(() => setCodeCopied(false), 2000);
    }
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

        {/* 중립 준비 공간은 첫 가치를 막는 역할·상세 스텝을 건너뛴다. */}
        {!neutralPreparationSpaceEnabled && (
          <StepIndicator currentStep={store.currentStep} />
        )}

        {/* 카드 */}
        <div className="bg-white/80 backdrop-blur-[20px] rounded-3xl border border-black/[0.04] p-8 shadow-[0_8px_40px_rgba(0,0,0,0.04)]">
          {neutralPreparationSpaceEnabled ? (
            <NeutralPreparationStart
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
            />
          ) : (
          <>
          <AnimatePresence mode="wait">
            <motion.div
              key={store.currentStep}
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
                  onPartnerCodeChange={store.setPartnerInviteCode}
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
              {store.currentStep === 5 && (
                <ProgressChecklist
                  items={store.progressChecklist}
                  onStatusChange={store.setChecklistItemStatus}
                  onCostChange={store.setChecklistItemCost}
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
                onClick={store.prevStep}
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
            ) : (
              <div className="flex-1 flex flex-col gap-2">
                <button
                  onClick={() => void handleSubmit()}
                  disabled={loading}
                  className="w-full py-3 rounded-2xl text-[14px] font-medium transition-all bg-gradient-to-br from-[#795252] to-[#946a6a] text-white shadow-[0_4px_14px_0_rgba(121,82,82,0.2)] hover:shadow-[0_6px_20px_rgba(121,82,82,0.23)] disabled:opacity-50"
                >
                  {loading ? "저장 중..." : "시작하기"}
                </button>
                <button
                  onClick={handleSkipChecklist}
                  disabled={loading}
                  className="w-full py-2.5 rounded-2xl text-[13px] font-medium text-taupe-400 hover:text-taupe-500 hover:bg-black/[0.02] transition-all"
                >
                  나중에 하기
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
                아래 코드를 파트너에게 공유하세요.
                <br />
                파트너가 이 코드로 가입하면 함께 준비할 수 있어요!
              </p>

              <div className="bg-ivory-100 rounded-2xl p-5 mb-5">
                <p className="text-[28px] font-mono font-bold text-noir-800 tracking-[0.15em]">
                  {inviteCodeResult}
                </p>
              </div>

              <button
                onClick={handleCopyCode}
                className={`w-full py-3 rounded-2xl text-[14px] font-medium transition-all mb-3 ${
                  codeCopied
                    ? "bg-green-500 text-white"
                    : "bg-[#795252] text-white hover:bg-[#946a6a]"
                }`}
              >
                {codeCopied ? "복사 완료!" : "코드 복사하기"}
              </button>

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
