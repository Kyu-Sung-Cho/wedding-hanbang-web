"use client";

import { ONBOARDING_STEPS } from "@/types/onboarding.types";

interface StepIndicatorProps {
  currentStep: number;
}

export default function StepIndicator({ currentStep }: StepIndicatorProps) {
  return (
    <div className="flex items-center justify-center gap-2 mb-8">
      {ONBOARDING_STEPS.map((step, i) => (
        <div key={step.step} className="flex items-center gap-2">
          <div
            className={`w-8 h-8 rounded-full flex items-center justify-center text-[13px] font-medium transition-all ${
              currentStep === step.step
                ? "bg-noir-800 text-white"
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
          {i < ONBOARDING_STEPS.length - 1 && (
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
