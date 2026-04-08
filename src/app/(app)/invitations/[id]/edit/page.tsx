"use client";

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useInvitationStore } from "@/stores/invitationStore";
import { EDITOR_STEPS } from "@/types/invitation.types";
import type { EditorStep } from "@/types/invitation.types";
import { ArrowLeft, Check, ChevronRight } from "lucide-react";
import StepTemplate from "@/components/app/invitation/StepTemplate";
import StepInfo from "@/components/app/invitation/StepInfo";
import StepWedding from "@/components/app/invitation/StepWedding";
import StepGallery from "@/components/app/invitation/StepGallery";
import StepAccount from "@/components/app/invitation/StepAccount";
import StepSettings from "@/components/app/invitation/StepSettings";

export default function InvitationEditPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const {
    current,
    currentLoading,
    editorStep,
    editorDirty,
    loadInvitation,
    updateInvitation,
    setEditorStep,
  } = useInvitationStore();

  useEffect(() => {
    if (id) loadInvitation(id);
  }, [id, loadInvitation]);

  const currentStepIndex = EDITOR_STEPS.findIndex((s) => s.key === editorStep);

  const handleSave = async () => {
    if (!current || !editorDirty) return;
    await updateInvitation(current.id, current);
  };

  const handleNext = async () => {
    if (editorDirty && current) {
      await updateInvitation(current.id, current);
    }
    if (currentStepIndex < EDITOR_STEPS.length - 1) {
      setEditorStep(EDITOR_STEPS[currentStepIndex + 1].key);
    }
  };

  const handlePrev = () => {
    if (currentStepIndex > 0) {
      setEditorStep(EDITOR_STEPS[currentStepIndex - 1].key);
    }
  };

  if (currentLoading || !current) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 border-2 border-rose-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const renderStep = () => {
    switch (editorStep) {
      case "template": return <StepTemplate />;
      case "info": return <StepInfo />;
      case "wedding": return <StepWedding />;
      case "gallery": return <StepGallery />;
      case "account": return <StepAccount />;
      case "settings": return <StepSettings />;
    }
  };

  return (
    <div className="max-w-[700px] mx-auto">
      {/* 헤더 */}
      <div className="flex items-center gap-3 mb-6">
        <Link
          href="/invitations"
          className="w-9 h-9 flex items-center justify-center rounded-xl hover:bg-ivory-100 transition-colors"
        >
          <ArrowLeft className="w-5 h-5 text-noir-800" />
        </Link>
        <div className="flex-1">
          <h1 className="text-[18px] font-semibold text-noir-800">청첩장 편집</h1>
        </div>
        {editorDirty && (
          <button
            onClick={handleSave}
            className="px-4 py-2 bg-rose-500 text-white text-[13px] font-medium rounded-xl hover:bg-rose-600 transition-colors"
          >
            저장
          </button>
        )}
      </div>

      {/* 스텝 네비게이션 */}
      <div className="flex items-center gap-1 mb-8 overflow-x-auto scrollbar-hide pb-1">
        {EDITOR_STEPS.map((step, i) => (
          <button
            key={step.key}
            onClick={() => setEditorStep(step.key as EditorStep)}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-[12px] font-medium whitespace-nowrap transition-colors ${
              editorStep === step.key
                ? "bg-noir-800 text-white"
                : i < currentStepIndex
                ? "bg-green-50 text-green-600"
                : "bg-ivory-100 text-taupe-500 hover:bg-ivory-200"
            }`}
          >
            {i < currentStepIndex && <Check className="w-3 h-3" />}
            <span>{i + 1}. {step.label}</span>
          </button>
        ))}
      </div>

      {/* 스텝 콘텐츠 */}
      <div className="bg-white rounded-2xl border border-black/[0.06] p-6">
        {renderStep()}
      </div>

      {/* 하단 네비게이션 */}
      <div className="flex items-center justify-between mt-6">
        <button
          onClick={handlePrev}
          disabled={currentStepIndex === 0}
          className="px-5 py-2.5 text-[13px] font-medium text-taupe-500 hover:text-noir-800 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          이전
        </button>
        {currentStepIndex < EDITOR_STEPS.length - 1 ? (
          <button
            onClick={handleNext}
            className="inline-flex items-center gap-1.5 px-6 py-2.5 bg-noir-800 text-white text-[13px] font-medium rounded-xl hover:bg-noir-900 transition-colors"
          >
            다음
            <ChevronRight className="w-4 h-4" />
          </button>
        ) : (
          <button
            onClick={() => router.push("/invitations")}
            className="px-6 py-2.5 bg-rose-500 text-white text-[13px] font-medium rounded-xl hover:bg-rose-600 transition-colors"
          >
            완료
          </button>
        )}
      </div>
    </div>
  );
}
