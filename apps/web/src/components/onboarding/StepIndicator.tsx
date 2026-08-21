"use client";

import { ONBOARDING_STEPS } from "@/types/onboarding.types";

interface StepIndicatorProps {
  currentStep: number;
  /**
   * 아직 안 골랐으면 null. 스텝 2에서 정해진다.
   *
   * 합류하는 사람은 역할과 코드까지만 걷고 바로 제출된다 — 예식일·장소·예산·스타일·
   * 준비 현황은 모두 커플이 함께 쓰는 자리라, 나중에 온 사람이 다른 값을 넣으면
   * 서버가 양쪽 승인이 필요한 변경으로 만든다. 그래서 그 화면들을 지나가지 않는다.
   *
   * 그런데 진행 표시는 그 사실을 모른 채 다섯 칸을 그렸다. 합류자는 3·4·5가 회색으로
   * 남은 화면에서 갑자기 끝나는 앱을 본다 — 남은 세 단계를 기다리다가.
   */
  coupleAction?: "create" | "join" | null;
}

/** 합류가 실제로 보는 화면. 앱의 onboardingFlow.mjs JOIN_STEPS와 같아야 한다. */
const JOIN_VISIBLE_STEPS = [1, 2];

export default function StepIndicator({
  currentStep,
  coupleAction = null,
}: StepIndicatorProps) {
  const steps =
    coupleAction === "join"
      ? ONBOARDING_STEPS.filter((step) => JOIN_VISIBLE_STEPS.includes(step.step))
      : ONBOARDING_STEPS;

  return (
    <div className="flex items-center justify-center gap-2 mb-8">
      {steps.map((step, i) => (
        <div key={step.step} className="flex items-center gap-2">
          <div
            className={`w-8 h-8 rounded-full flex items-center justify-center text-[13px] font-medium transition-all ${
              currentStep === step.step
                ? "bg-[#795252] text-white"
                : currentStep > step.step
                  ? "bg-rose-500 text-white"
                  : "bg-black/[0.06] text-taupe-400"
            }`}
          >
            {currentStep > step.step ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            ) : (
              step.step
            )}
          </div>
          {i < steps.length - 1 && (
            <div
              className={`w-8 h-0.5 transition-colors ${
                currentStep > step.step ? "bg-rose-500" : "bg-black/[0.06]"
              }`}
            />
          )}
        </div>
      ))}
    </div>
  );
}
