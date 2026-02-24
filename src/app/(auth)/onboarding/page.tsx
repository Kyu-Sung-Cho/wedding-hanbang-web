"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useOnboardingStore } from "@/stores/onboardingStore";
import Logo from "@/components/ui/Logo";
import StepIndicator from "@/components/onboarding/StepIndicator";
import RoleSelection from "@/components/onboarding/RoleSelection";
import CoupleLink from "@/components/onboarding/CoupleLink";
import WeddingDetails from "@/components/onboarding/WeddingDetails";
import ProgressChecklist from "@/components/onboarding/ProgressChecklist";

export default function OnboardingPage() {
  const store = useOnboardingStore();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [inviteCodeResult, setInviteCodeResult] = useState("");

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
          // 쿠키도 세팅해두기
          document.cookie = "onboarding_complete=true; path=/; max-age=31536000";
          window.location.href = "/dashboard";
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
          return /^WH-[A-Z0-9]{6}$/.test(store.partnerInviteCode);
        }
        return store.coupleAction !== null;
      case 3:
        return true;
      case 4:
        return true;
      default:
        return false;
    }
  };

  const handleSubmit = async () => {
    setLoading(true);
    setError("");

    try {
      const progress: Record<string, { status: string }> = {};
      store.progressChecklist.forEach((item) => {
        progress[item.key] = {
          status: item.done ? "completed" : "not_started",
        };
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
          totalBudget: store.approximateBudget,
          progress,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? "온보딩 저장에 실패했습니다.");
        return;
      }

      if (data.inviteCode) {
        setInviteCodeResult(data.inviteCode);
      }

      // 온보딩 완료 쿠키 설정
      document.cookie = "onboarding_complete=true; path=/; max-age=31536000";
      window.location.href = "/dashboard";
    } catch {
      setError("오류가 발생했습니다. 다시 시도해주세요.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-ivory-50 via-ivory-warm to-ivory-deep flex items-center justify-center px-5 py-10">
      <div className="w-full max-w-[480px]">
        {/* 로고 */}
        <div className="text-center mb-8">
          <Logo size="md" />
          <p className="text-[13px] text-taupe-400 mt-2">웨딩 준비 시작하기</p>
        </div>

        {/* 스텝 인디케이터 */}
        <StepIndicator currentStep={store.currentStep} />

        {/* 카드 */}
        <div className="bg-white/80 backdrop-blur-[20px] rounded-3xl border border-black/[0.04] p-8 shadow-[0_8px_40px_rgba(0,0,0,0.04)]">
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
                  budget={store.approximateBudget}
                  onDateChange={store.setWeddingDate}
                  onDateUndecidedChange={store.setWeddingDateUndecided}
                  onVenueChange={store.setVenue}
                  onVenueUndecidedChange={store.setVenueUndecided}
                  onBudgetChange={store.setBudget}
                />
              )}
              {store.currentStep === 4 && (
                <ProgressChecklist
                  items={store.progressChecklist}
                  onToggle={store.toggleChecklistItem}
                />
              )}
            </motion.div>
          </AnimatePresence>

          {/* 에러 */}
          {error && (
            <p className="text-[12px] text-rose-600 text-center mt-4">{error}</p>
          )}

          {/* 초대 코드 결과 */}
          {inviteCodeResult && (
            <div className="bg-ivory-100 rounded-2xl p-4 mt-4 text-center">
              <p className="text-[12px] text-taupe-400 mb-1">파트너 초대 코드</p>
              <p className="text-[20px] font-mono font-bold text-noir-800 tracking-wider">
                {inviteCodeResult}
              </p>
            </div>
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
            {store.currentStep < 4 ? (
              <button
                onClick={store.nextStep}
                disabled={!canProceed()}
                className="flex-1 py-3 rounded-2xl text-[14px] font-medium transition-all bg-noir-800 text-white hover:bg-noir-soft disabled:opacity-30 disabled:cursor-not-allowed"
              >
                다음
              </button>
            ) : (
              <button
                onClick={handleSubmit}
                disabled={loading}
                className="flex-1 py-3 rounded-2xl text-[14px] font-medium transition-all bg-rose-500 text-white hover:bg-rose-600 disabled:opacity-50"
              >
                {loading ? "저장 중..." : "시작하기"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
