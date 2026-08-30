"use client";

import Link from "next/link";
import { Check, SlidersHorizontal, Sparkles } from "lucide-react";

import {
  AMORA_QUICK_START_OPTIONS,
  type AmoraQuickStartOption,
} from "@/lib/amora/personalization";

type QuickStartProps = {
  disabled?: boolean;
  onSelect: (option: AmoraQuickStartOption) => void;
};

export function AmoraQuickStart({
  disabled = false,
  onSelect,
}: QuickStartProps) {
  return (
    <section
      aria-labelledby="amora-quick-start-title"
      className="mx-auto w-full max-w-[53.75rem] rounded-[6px] border border-[#E2D3C8] bg-[var(--hb-surface-page)] p-4 shadow-[var(--shadow-raised)] sm:p-5"
    >
      <div className="mb-4 flex items-start gap-3">
        <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-[6px] bg-[var(--hb-primary)] text-white">
          <Sparkles className="h-5 w-5" />
        </span>
        <div>
          <h2
            id="amora-quick-start-title"
            className="text-base font-semibold text-[var(--hb-text-strong)]"
          >
            지금 어떤 도움부터 받을까요?
          </h2>
          <p className="mt-1 text-sm leading-relaxed text-[#6D806E]">
            하나만 고르면 아모라가 설명보다 실제 도움을 먼저 보여드려요.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {AMORA_QUICK_START_OPTIONS.map((option) => (
          <button
            key={option.mode}
            type="button"
            disabled={disabled}
            onClick={() => onSelect(option)}
            className="min-h-16 rounded-[6px] border border-[#E2D3C8] bg-white px-4 py-3 text-left transition-colors hover:border-[#8F6662]/50 hover:bg-[var(--hb-surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8F6662] disabled:cursor-wait disabled:opacity-50"
          >
            <span className="block text-sm font-semibold text-[var(--hb-text-strong)]">
              {option.label}
            </span>
            <span className="mt-0.5 block text-xs leading-relaxed text-[#6D806E]">
              {option.description}
            </span>
          </button>
        ))}
      </div>
      <p className="mt-3 text-xs leading-relaxed text-[#8A817A]">
        함께 대화에서 고르면 선택 문장과 아모라 답변은 상대방에게도 보여요.
        이 선택만으로 성격을 판단하거나 예산·일정을 바꾸지 않아요.
      </p>
    </section>
  );
}

type ConfirmationProps = {
  option: AmoraQuickStartOption;
  saving?: boolean;
  error?: string | null;
  onConfirm: () => void;
  onDismiss: () => void;
};

export function AmoraPersonalizationConfirmation({
  option,
  saving = false,
  error,
  onConfirm,
  onDismiss,
}: ConfirmationProps) {
  return (
    <section
      aria-labelledby="amora-personalization-confirm-title"
      className="ml-11 mt-2 max-w-[53.75rem] border-l-2 border-[#C7D1C2] py-1 pl-4 sm:ml-14"
    >
      <div className="flex items-start gap-2">
        <Check className="mt-0.5 h-4 w-4 flex-shrink-0 text-[#6D806E]" />
        <div className="min-w-0">
          <h2
            id="amora-personalization-confirm-title"
            className="text-sm font-semibold leading-relaxed text-[var(--hb-text-strong)]"
          >
            {option.confirmation}
          </h2>
          <p className="mt-1 text-xs leading-relaxed text-[#6D806E]">
            지금 고른 문장과 답변은 함께 대화에 보여요. 저장하면 내 아모라의
            답변 방식에만 사용하고, 설정값 자체는 상대방과 공유하지 않아요.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={saving}
              onClick={onConfirm}
              className="min-h-10 rounded-[6px] bg-[var(--hb-primary)] px-3.5 text-sm font-semibold text-white transition-colors hover:bg-[var(--hb-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6D806E] focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-50"
            >
              {saving ? "저장 중..." : "이대로 저장"}
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={onDismiss}
              className="min-h-10 rounded-[6px] border border-[#E2D3C8] bg-white px-3.5 text-sm font-medium text-[var(--hb-text-strong)] transition-colors hover:bg-[var(--hb-surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6D806E] focus-visible:ring-offset-2 disabled:opacity-50"
            >
              이번만
            </button>
            <Link
              href="/settings/amora-style"
              className="inline-flex min-h-10 items-center gap-1.5 rounded-[6px] px-3 text-sm font-medium text-[#8F6662] transition-colors hover:bg-[var(--hb-surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8F6662]"
            >
              <SlidersHorizontal className="h-4 w-4" />
              다른 방식 보기
            </Link>
          </div>
          {error && (
            <p role="alert" className="mt-2 text-xs text-[#A04A4A]">
              {error}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
